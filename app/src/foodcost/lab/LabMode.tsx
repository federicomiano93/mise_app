import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Timer, X } from 'lucide-react';
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components';
import type { Product } from '@mise/shared/foodcost-model';
import { useT } from '../../i18n/useT';
import { markBusy } from '../../session/busy';
import { useSession } from '../../session/SessionContext';
import { announceAction } from '../../telemetry/usage';
import { Button } from '../../ui/Button';
import { useStatusMessage } from '../../ui/StatusMessage';
import { useConfirm } from '../../ui/useConfirm';
import { acquireWakeLock, releaseWakeLock } from '../../ui/wakeLock';
import { useFoodcost, useFoodcostStore } from '../FoodcostContext';
import { openingUnit } from '../lineUnits';
import { PickDialog } from '../PickDialog';
import type { Choice } from '../PickDialog';
import { Keypad } from './Keypad';
import { clearDraft, labDraftKey, readDraft, writeDraft } from './labDraft';
import { elapsedMs, formatClock, timerMinutes } from './labClock';
import { groupedNumber, gramsText, peopleText } from './labFormat';
import { fcNumber } from '@mise/shared/fc-number';
import { useMoney } from '../../session/useMoney';
import {
  addLine, baseProduct, cookedKept, goToStep, isStale, labNumbers, labourMs, ovenVisitMs, lineField, newDraft, nextUnticked, resolveStep, soldByPieces, startDraft,
  stepPeople, stepsFor, toggleTick, typeInto,
} from './labModel';
import type { FieldId, LabDraft, LabStepId, Presets } from './labModel';
import { planLabSave } from './labSave';
import { padKeyOf, typedText } from './keypadRules';
import { StepBody } from './LabSteps';
import { useNow } from './useNow';
import styles from './LabMode.module.css';

const WAKE_OWNER = 'foodcost-lab';

type Props = {
  productId: string;
  // Closes the lab and gives the card back. The draft, if any, is already stored.
  onClose: () => void;
};

const STEP_TITLE = {
  ingredients: 'lab.step.ingredients',
  raw: 'lab.step.raw',
  oven: 'lab.step.oven',
  cooked: 'lab.step.cooked',
  pieces: 'lab.step.pieces',
  time: 'lab.step.time',
  result: 'lab.step.result',
} as const;

// The field the keypad types into when a step opens: the first line still to do, or the step's only box.
function defaultField(step: LabStepId, draft: LabDraft): FieldId | null {
  if (step === 'ingredients') {
    const first = draft.lines.find(line => draft.ticked[line.key] !== true) ?? draft.lines[0];
    return first ? lineField(first.key) : null;
  }
  if (step === 'raw') return 'raw';
  if (step === 'cooked') return 'cooked';
  if (step === 'pieces') return 'pieces';
  if (step === 'time') return 'minutes';
  return null;
}

// Lab mode («Modalità laboratorio», Food cost plan step 5): a full-screen, one-step-at-a-time flow for producing a batch, which at
// the end saves the real weights, the cooked weight, the pieces, the time and the people into the product's card.
//
// ⚠️ OPENED FROM THE SAVED PRODUCT ONLY (the card's read view): there are never unsaved card edits to lose or to mix in. The form has
// no door to it.
// ⚠️ EVERY FIGURE IS THE CARD'S (labModel.labNumbers → the shared cost model on a copy with today's weights); the clock is the stored
// start instant (labClock); the draft lives on this tablet (labDraft) and is written at every change once the clock runs.
// ⚠️ THE SAVE GOES THROUGH THE CARD'S OWN WRITE (store.saveProduct: local-first, the same margin point) onto the LATEST saved product
// (labSave). A cloud failure is the store's business, as for the card: it takes the product back and says so.
export function LabMode({ productId, onClose }: Props) {
  const { t, locale } = useT();
  const say = useStatusMessage();
  const store = useFoodcostStore();
  const snap = useFoodcost();
  const { locationId } = useSession();
  const money = useMoney();
  const [confirm, confirmDialog] = useConfirm();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const key = labDraftKey(locationId ?? '', productId);

  // The product as the card reads it, live — and the last version seen, so a product deleted elsewhere does not blank the screen.
  const stored = snap.products.find(candidate => candidate.id === productId) ?? null;
  const lastStored = useRef<Product | null>(stored);
  if (stored !== null) lastStored.current = stored;
  const shownProduct = stored ?? lastStored.current;
  // Stable between clock ticks: the cost model runs only when the product or the prices change.
  const base = useMemo(() => baseProduct(shownProduct, snap.tables), [shownProduct, snap.tables]);

  const [draft, setDraft] = useState<LabDraft | null>(() => readDraft(key) ?? (base === null ? null : newDraft(base)));
  const [phase, setPhase] = useState<'flow' | 'saved'>('flow');
  // ⚠️ DERIVED FROM THE RESOLVED STEP: a resumed draft may name a step this product no longer has.
  const [field, setField] = useState<FieldId | null>(() => (draft === null || base === null
    ? null
    : defaultField(resolveStep(stepsFor(base), draft.step), draft)));
  const [picking, setPicking] = useState(false);
  const [savedName, setSavedName] = useState('');
  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const started = draft !== null && draft.startedAt !== null;
  const now = useNow(started && phase === 'flow');

  // The screen stays lit while the lab is open, and a reload the app starts by itself waits for it (like the Recipe book's mix).
  useEffect(() => {
    if (phase !== 'flow') return undefined;
    acquireWakeLock(WAKE_OWNER);
    const release = markBusy();
    return () => {
      releaseWakeLock(WAKE_OWNER);
      release();
    };
  }, [phase]);

  // Written at every change once the clock runs; never before «Inizia», never after the save cleared it.
  useEffect(() => {
    if (draft !== null && phase === 'flow') writeDraft(key, draft);
  }, [draft, phase, key]);

  useEffect(() => {
    if (base === null || draft === null) onClose();
  }, [base, draft, onClose]);

  const steps = useMemo(() => (base === null ? [] : stepsFor(base)), [base]);
  // A resumed draft may name a step this product no longer has («Pezzi ottenuti» after the way of selling changed): the next one.
  const step: LabStepId = draft === null ? 'start' : resolveStep(steps, draft.step);
  const index = steps.indexOf(step);

  // The figures change with the clock only where the minutes follow the timer (the time step and the result): elsewhere the cost model
  // is not run again every second on a slow tablet.
  const followsTimer = draft !== null && draft.minutes === null && draft.minutesFrozen === null && (step === 'time' || step === 'result');
  const clockKey = followsTimer ? now : 0;
  const numbers = useMemo(
    () => (base === null || draft === null ? null : labNumbers(base, draft, snap.tables, clockKey === 0 ? Date.now() : clockKey)),
    [base, draft, snap.tables, clockKey],
  );

  // After a step change the heading takes the focus, so a screen reader says where it is. Not on opening: the dialog does its own.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    titleRef.current?.focus();
  }, [step, phase]);

  const presets: Presets = {
    raw: numbers === null ? '' : typedText(Math.round(numbers.totalGrams * 10) / 10),
    pieces: base?.piecesPerBatch ? typedText(base.piecesPerBatch) : '',
    minutes: numbers === null ? '' : String(numbers.minutes),
  };

  const press = (padKey: string) => {
    if (draft === null || field === null) return;
    setDraft(typeInto(draft, field, padKey, presets));
  };

  // A physical keyboard types into the selected box too. A native listener (a React one would also hear the search box of the
  // ingredient chooser, which bubbles through the portal), off while a dialog is open or the focus is in a text field.
  const pressRef = useRef(press);
  pressRef.current = press;
  const listening = phase === 'flow' && !picking && field !== null && step !== 'start' && step !== 'oven' && step !== 'result';
  useEffect(() => {
    if (!listening) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target !== null && (target.closest('input, textarea, select, [contenteditable="true"]') !== null || target.closest('[role="alertdialog"]') !== null)) return;
      const padKey = padKeyOf(event);
      if (padKey === null || event.defaultPrevented) return;
      event.preventDefault();
      pressRef.current(padKey);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [listening]);

  if (base === null || draft === null || numbers === null) return null;

  const go = (target: LabStepId) => {
    // From the RESOLVED step, so leaving «Tempo e persone» freezes the minutes even when the stored step was a vanished one.
    const next = goToStep({ ...draft, step }, target, Date.now());
    setDraft(next);
    setField(defaultField(target, next));
  };

  const begin = () => {
    const next = startDraft(draft, Date.now());
    setDraft(next);
    setField(defaultField('ingredients', next));
  };

  // «Esci» in the middle of a production keeps everything: the draft is stored now, not at the next effect.
  const leave = () => {
    if (started) {
      writeDraft(key, draft);
      say(t('lab.exitToast'));
    }
    onClose();
  };

  const tick = (lineKey: string) => {
    const next = toggleTick(draft, lineKey);
    setDraft(next);
    if (next.ticked[lineKey] === true) {
      const following = nextUnticked(next, lineKey);
      setField(following === null ? lineField(lineKey) : lineField(following));
    } else {
      setField(lineField(lineKey));
    }
  };

  const addIngredient = (choice: Choice) => {
    setPicking(false);
    if (choice.kind !== 'ingredient') return;
    const ingredient = snap.ingredients[choice.id];
    const unit = ingredient !== undefined && openingUnit(ingredient) === 'pcs' ? 'pcs' : 'g';
    const added = addLine(draft, { kind: 'ingredient', ingredientId: choice.id, unit });
    setDraft(added.draft);
    setField(lineField(added.key));
  };

  const useTotal = () => { setDraft({ ...draft, raw: null }); };
  // «Dal cronometro»: the timer's reading. A production older than a day has none by default, so the reading is typed in explicitly.
  const fromTimer = () => {
    const stale = isStale(draft.startedAt, Date.now());
    setDraft({
      ...draft,
      minutes: stale ? String(Math.min(999999, timerMinutes(labourMs(draft, Date.now())))) : null,
      minutesFrozen: null,
    });
  };

  // ── Save ────────────────────────────────────────────────────────────────────────────────────
  const refusal = (reason: 'gone' | 'invalid' | 'tooMany' | 'badRaw' | 'badCooked'): string => (
    reason === 'gone' ? t('fc.productDeleted')
      : reason === 'tooMany' ? t('lab.save.tooMany')
        : reason === 'badCooked' ? t('lab.save.badCooked')
          : reason === 'badRaw' ? t('lab.save.badRaw')
            : t('lab.save.invalid')
  );

  async function save() {
    if (asking.current || base === null || draft === null) return;
    asking.current = true;
    try {
      const nowMs = Date.now();
      const first = planLabSave(store.getSnapshot().products.find(candidate => candidate.id === productId), store.getSnapshot().tables, draft, nowMs, new Date(nowMs).toISOString());
      if (!first.ok) {
        say(refusal(first.reason));
        return;
      }
      const product = first.product;
      const lines: string[] = [
        first.changedLines === 0 ? t('lab.save.madeSame') : t('lab.save.madeChanges', { n: first.changedLines }),
        product.cookedGrams === null
          ? t('lab.save.cookingNone', { raw: gramsText(numbers?.rawGrams ?? 0, locale) })
          : cookedKept(first.before, draft) && numbers?.lossPct != null
            // No cooked weight typed: the card's loss stays, and the question says so.
            ? t('lab.save.cookingKept', { raw: gramsText(numbers.rawGrams, locale), cooked: gramsText(product.cookedGrams, locale), pct: fcNumber(numbers.lossPct, money) })
            : t('lab.save.cooking', { raw: gramsText(numbers?.rawGrams ?? 0, locale), cooked: gramsText(product.cookedGrams, locale) }),
      ];
      if (soldByPieces(product) && product.piecesPerBatch !== null) lines.push(t('lab.save.pieces', { n: groupedNumber(product.piecesPerBatch, locale) }));
      lines.push(t('lab.save.labour', {
        minutes: t('lab.n.minutes', { n: product.labourMinutes ?? 1 }),
        people: peopleText(t, product.labourPeople ?? 1, locale),
      }));
      const ok = await confirm({
        title: t('lab.save.title', { name: product.name }),
        message: numbers?.heavier === true ? t('fc.cooking.saveAnyway').split('\n') : undefined,
        body: (
          <>
            <ul className={styles.sumList}>{lines.map(line => <li key={line}>{line}</li>)}</ul>
            {/* Only when a margin point will really be recorded. */}
            {first.snapshot === null ? null : <p className={styles.sumNote}>{t('lab.save.note')}</p>}
          </>
        ),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
      // ⚠️ PLANNED AGAIN AFTER THE QUESTION, on the product as it is NOW: the card may have changed while the dialog was open.
      const after = Date.now();
      const final = planLabSave(store.getSnapshot().products.find(candidate => candidate.id === productId), store.getSnapshot().tables, draft, after, new Date(after).toISOString());
      if (!final.ok) {
        say(refusal(final.reason));
        return;
      }
      // ⚠️ THE DRAFT IS CLEARED ONLY ONCE THE SAVE IS ACCEPTED LOCALLY, as the card does: saveProduct is local-first (a later refusal
      // by the server is the store's own message and rollback), but if it throws here the production stays open.
      try {
        store.saveProduct({ product: final.product, snapshot: final.snapshot, lossPatches: {} });
      } catch {
        say(t('lab.save.failed'));
        return;
      }
      announceAction('foodcost-saved');
      clearDraft(key);
      setSavedName(final.product.name);
      setPhase('saved');
    } finally {
      asking.current = false;
    }
  }

  const again = () => {
    const fresh = newDraft(base);
    setDraft(fresh);
    setField(defaultField('start', fresh));
    setPhase('flow');
  };

  // ── What is drawn ───────────────────────────────────────────────────────────────────────────
  // The top clock is the LABOUR clock: frozen, and muted like before the start, while the flow is in the oven.
  const inOven = step === 'oven';
  const labour = labourMs(draft, now);
  const wall = elapsedMs(draft.startedAt, now);
  const last = index === steps.length - 1;
  const whole = field === 'pieces' || field === 'minutes'
    || (field !== null && draft.lines.some(line => lineField(line.key) === field && line.ref.kind === 'ingredient' && line.ref.unit === 'pcs'));

  return (
    <ModalOverlay isOpen isKeyboardDismissDisabled className={styles.overlay}>
      <Modal className={styles.modal}>
        <AriaDialog aria-label={t('lab.enter')} className={styles.lab}>
          {phase === 'saved' ? (
            <div className={styles.saved}>
              <span className={styles.savedIcon} aria-hidden="true"><Check /></span>
              <h2 ref={titleRef} tabIndex={-1} className={styles.savedTitle}>{t('lab.saved.title')}</h2>
              <p className={styles.savedBody}>{t('lab.saved.body', { name: savedName })}</p>
              <div className={styles.savedActions}>
                <Button variant="bare" className={styles.secondaryBig} onPress={again}>{t('lab.saved.again')}</Button>
                <Button variant="bare" className={styles.primaryBig} autoFocus onPress={onClose}>{t('lab.saved.back')}</Button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.top}>
                <Button variant="bare" className={styles.exit} onPress={leave}>
                  <X aria-hidden="true" />
                  <span>{t('lab.exit')}</span>
                </Button>
                <div className={styles.center}>
                  {started ? (
                    <>
                    {/* Under 360px seven 44px buttons do not fit: the dots give way to the name of the step you are on. */}
                    <p className={styles.stepName} aria-hidden="true">
                      {t(STEP_TITLE[step as keyof typeof STEP_TITLE])} · {t('lab.counter', { done: index, total: steps.length - 1 })}
                    </p>
                    <nav aria-label={t('lab.steps')} className={styles.dotsNav}>
                      <ol className={styles.dots}>
                        {steps.filter(candidate => candidate !== 'start').map(candidate => {
                          const position = steps.indexOf(candidate);
                          const state = position === index ? 'current' : position < index ? 'past' : 'future';
                          return (
                            <li key={candidate} className={styles.dotItem} data-state={state}>
                              <button
                                type="button"
                                className={styles.dot}
                                data-state={state}
                                aria-label={t(STEP_TITLE[candidate as keyof typeof STEP_TITLE])}
                                aria-current={state === 'current' ? 'step' : undefined}
                                onClick={() => { go(candidate); }}
                              >
                                <span aria-hidden="true" />
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </nav>
                    </>
                  ) : <p className={styles.productName}>{base.name}</p>}
                </div>
                <div className={styles.clock} role="timer" aria-label={t(inOven ? 'lab.clockPaused' : 'lab.clock')} data-idle={!started || inOven}>
                  <Timer aria-hidden="true" />
                  <span>{formatClock(started ? labour : 0)}</span>
                </div>
              </div>

              <div className={styles.body}>
                <StepBody
                  step={step}
                  draft={draft}
                  base={base}
                  numbers={numbers}
                  field={field}
                  presets={presets}
                  elapsedMs={wall}
                  ovenMs={ovenVisitMs(draft, now)}
                  titleRef={titleRef}
                  titleId={titleId}
                  onSelect={setField}
                  onTick={tick}
                  onAdd={() => { setPicking(true); }}
                  onStart={begin}
                  onKey={press}
                  allowComma={!whole}
                  onUseTotal={useTotal}
                  onFromTimer={fromTimer}
                  onPeople={delta => { setDraft(stepPeople(draft, base.labourPeople, delta)); }}
                />
              </div>

              {step === 'start' ? null : (
                <div className={styles.bottom}>
                  {index >= 2 ? (
                    <Button variant="bare" className={styles.secondaryBig} onPress={() => { go(steps[index - 1] ?? 'ingredients'); }}>
                      {t('ui.back')}
                    </Button>
                  ) : <span />}
                  {last ? (
                    <Button variant="bare" className={styles.primaryBig} onPress={() => { void save(); }}>{t('lab.saveToCard')}</Button>
                  ) : (
                    <Button variant="bare" className={styles.primaryBig} onPress={() => { go(steps[index + 1] ?? 'result'); }}>{t('lab.next')}</Button>
                  )}
                </div>
              )}
            </>
          )}
          {confirmDialog}
          {picking ? <PickDialog mode="ingredient" onChoose={addIngredient} onClose={() => { setPicking(false); }} /> : null}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
