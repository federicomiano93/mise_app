import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';
import { Pencil } from 'lucide-react';
import {
  doughExtraGrams, formatGrams, getTabProducts, isExtraDoughEnabled, settledTraysText,
  traysGrams, usesOrders, usesTrays, usesTypedTotal,
} from '@mise/shared/calculator-config';
import type { Recipe } from '@mise/shared/calculator-config';
import { runConfirm } from '@mise/shared/confirm-flow';
import type { ForDay } from '@mise/shared/log-model';
import {
  extraKey, extraUnitKey, lockKey, paramKey, parseLock, qtyKey, revealedKey, serializeLock, totalKey, traysKey,
} from '@mise/shared/calculator-tab-keys';
import { useT } from '../i18n/useT';
import { ScrollAreaContext } from '../shell/scrollArea';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { numberOf, knobRange } from './calculatorInput';
import { problemSentence } from './calculatorMessages';
import { buildDoughVersion } from './calculatorSave';
import { calculateTab, showsKnob, sourceRecipe } from './calculatorResult';
import { useTabState, useTabVersion } from './TabStateContext';
import { NumberField } from './NumberField';
import { OrderCards } from './OrderCards';
import { ResultCard } from './ResultCard';
import boxes from './Boxes.module.css';
import styles from './RecipePanel.module.css';

// How long the focus is claimed after Confirm / Edit while a closing dialog may still hold the page: every 16 ms,
// for about a second.
const FOCUS_CLAIM_EVERY_MS = 16;
const FOCUS_CLAIM_TRIES = 60;

type Props = {
  recipe: Recipe;
  // `role`, `id` and `aria-labelledby` when the recipes are tabs; nothing for a lone recipe.
  panelProps?: HTMLAttributes<HTMLDivElement>;
};

// One recipe's tab, laid out by its logic:
//   orders      → leavening knob (if shown) · Orders · Extra dough · Confirm / Edit
//   total       → Total dough (g) · Confirm / Edit
//   both        → leavening knob (if shown) · Total dough (g) · Orders · Extra dough · Confirm / Edit
//   trays       → Number of trays (and the grams they make) · Confirm / Edit
//   traysTotal  → Number of trays · Total dough (g) · Confirm / Edit
// then the scaled recipe, then «Reset all fields».
//
// Every box is kept in the current app's own localStorage keys per keystroke (calculatorTabState.ts), so the
// numbers survive a reload and the other app shows them too. `touched-<rid>` is written wherever the current
// app writes it: on a typed number or a picked option and on Confirm, never when a box merely comes back to its
// default. `revealed-<rid>` and `lock-<rid>` are the current app's too ({"locked":bool,"logId":string|null}):
// a tab confirmed there is confirmed here.
//
// ⚠️ THE RECIPE IS SHOWN ONLY ONCE THE DOUGH WAS CONFIRMED (`revealed`), and then it is the FIRST thing in the
// panel: the node is MOVED in the document, never reordered with CSS `order`, so the keyboard and the reading
// order are the visual order. Before that it sits just before «Reset all fields». On the tablet's split the
// stylesheet puts it on the right whichever comes first.
export function RecipePanel({ recipe, panelProps }: Props) {
  const { t, locale } = useT();
  const { config, linked } = useCalculator();
  const store = useCalculatorStore();
  const state = useTabState();
  useTabVersion();
  const scrollArea = useContext(ScrollAreaContext);
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const [picking, setPicking] = useState(false);
  const uid = useId();
  const rid = recipe.id;
  // The divisor's crates: display only, never locked, but saved with the dough.
  //
  // ⚠️ IT BELONGS TO THE DAY'S NUMBERS: it is remembered with the generation of the tab it was picked in, and
  // reads as 0 once the tab has been forgotten since (Reset, or the new work day clearing it), as the current
  // app's resetTabFields puts the select back to 0. Derived while drawing, so no frame shows yesterday's split.
  const generation = state.forgotten(rid);
  const [picked, setPicked] = useState({ n: 0, generation });
  const divisorN = picked.generation === generation ? picked.n : 0;
  const setDivisorN = (n: number) => { setPicked({ n, generation }); };

  const products = getTabProducts(config, rid);
  const { source, resolved } = sourceRecipe(recipe, linked);
  const hasOrders = usesOrders(recipe.logic);
  const hasTrays = usesTrays(recipe.logic);
  const hasTotal = usesTypedTotal(recipe.logic);
  const hasKnob = showsKnob(recipe, source, resolved);

  // What the tab keeps, as text (the current app restores a box from the same key).
  const qtyText = (qtyId: string) => state.read(qtyKey(qtyId)) ?? '0';
  const knobText = state.read(paramKey(rid)) ?? String(recipe.leaveningDefaultPct);
  const totalText = state.read(totalKey(rid)) ?? '0';
  const savedTrays = state.read(traysKey(rid));
  const traysText = savedTrays === null ? '0' : settledTraysText(savedTrays) ?? savedTrays;
  const extraText = state.read(extraKey(rid)) ?? '0';
  const unitText = state.read(extraUnitKey(rid));
  const extraUnit = unitText === 'g' ? 'g' : 'kg';
  const extraShown = hasOrders && isExtraDoughEnabled(config, rid);
  const lock = parseLock(state.read(lockKey(rid)));
  const locked = !!lock?.locked;
  const revealed = state.read(revealedKey(rid)) === '1';

  const qty = (qtyId: string) => numberOf(qtyText(qtyId));
  const result = calculateTab(config, recipe, linked, {
    qty,
    extraG: extraShown ? doughExtraGrams(extraText, extraUnit) : 0,
    totalG: hasTotal ? numberOf(totalText) : 0,
    trays: hasTrays ? traysText : 0,
    knob: hasKnob ? knobText : null,
  });
  const hasDough = result.kind !== 'none';
  const shown = revealed && hasDough;

  // The first reveal scrolls to the top: Confirm is tapped at the bottom of the entries, and the recipe, now
  // the first thing in the panel, must come into view. The shell's `main` is the scroll area; the section does
  // not own it (a move to another tab starts at the top by the shell's own reset).
  const wasShown = useRef(shown);
  useLayoutEffect(() => {
    if (shown && !wasShown.current) {
      const area = scrollArea.element();
      if (area) area.scrollTop = 0;
    }
    wasShown.current = shown;
  }, [shown, scrollArea]);

  // ⚠️ THE BUTTON THAT WAS PRESSED IS GONE once the tab changes state (Confirm becomes Edit, Edit becomes Confirm)
  // and the entries move under the recipe: the focus would fall to the page. So the screen says where it goes —
  // the recipe's heading after a Confirm (the recipe is what somebody came for), the Confirm button after Edit —
  // and takes it there once the new state is drawn. Nothing is asked for on a plain re-render.
  const wantFocus = useRef<'recipe' | 'confirm' | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const claimTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  //
  // ⚠️ THE DIALOG THAT WAS OPEN IS STILL THERE WHEN THIS RUNS. After «Today» / «Tomorrow» the new state is drawn
  // while React Aria's modal is still mounted: the page behind it is inert, so a focus() on the heading does
  // nothing, and when the modal finally goes it gives the focus back to the Confirm button — gone — so it falls to
  // the page (seen in Chromium: the heading never received the focus at all). So the focus is claimed again and
  // again, for up to a second, until it holds: while it is on the page or still inside a dialog it is taken; the
  // moment a person has put it somewhere else on the page, it is left alone.
  //
  // ⚠️ THE GOAL IS LOOKED UP AT EVERY TRY, never kept from the first: the heading can be drawn anew in the meantime
  // (seen in Chromium — the first node was gone by the second try, and the focus stayed on the page).
  useLayoutEffect(() => {
    let ref: { readonly current: HTMLElement | null };
    if (wantFocus.current === 'recipe' && shown) ref = headingRef;
    else if (wantFocus.current === 'confirm' && !locked && hasDough) ref = confirmRef;
    else return;
    wantFocus.current = null;
    let frames = 0;
    // Once the focus has been on the goal, a move into a dialog is a person's own (Edit pressed at once).
    let held = false;
    const claim = () => {
      const goal = ref.current;
      if (!goal || !goal.isConnected) return;
      const now = document.activeElement;
      if (now === goal) held = true;
      const elsewhere = now !== null && now !== goal && now !== document.body
        && (held || !now.closest('[role="dialog"], [role="alertdialog"]'));
      if (elsewhere) return;
      if (now !== goal) goal.focus({ preventScroll: true });
      // Not cancelled by the next render (the store answering re-renders at once): only by leaving the screen.
      // ⚠️ A TIMER, NOT requestAnimationFrame: a page that is not being drawn (a window behind another, a tablet
      // dimming) runs no animation frames at all, and the claim would never happen there.
      if (++frames < FOCUS_CLAIM_TRIES) claimTimer.current = setTimeout(claim, FOCUS_CLAIM_EVERY_MS);
    };
    clearTimeout(claimTimer.current);
    claim();
  });
  useEffect(() => () => clearTimeout(claimTimer.current), []);

  const set = (key: string, text: string) => { state.set(key, text, rid); };
  // A box left empty goes back to its default: kept, but the tab is not «used» by it.
  const reset = (key: string, text: string) => { state.set(key, text); };

  // ── Confirm ────────────────────────────────────────────────────────────────
  // Asks «today or tomorrow?» unless the venue switched the question off (shared/src/confirm-flow.ts).
  const onConfirm = () => {
    runConfirm(rid, {
      config,
      openDayPicker: () => { setPicking(true); },
      saveToday: () => { saveFor('today'); },
    });
  };

  // ⚠️ THE DOUGH IS SAVED FROM WHAT THE SCREEN SHOWS, and refused when the screen refuses: a linked recipe that
  // cannot be read says so in a dialog and saves nothing — never a dough of zeros.
  function saveFor(day: ForDay) {
    setPicking(false);
    if (locked) return;
    if (result.kind !== 'ready') {
      const sentence = problemSentence(t, result);
      if (sentence !== null) void alert({ message: sentence, okLabel: t('common.ok') });
      return;
    }
    const version = buildDoughVersion({
      config,
      recipe: result.source,
      products,
      qty,
      extra: { enabled: extraShown, text: extraText, unit: extraUnit },
      totalG: hasTotal ? numberOf(totalText) : 0,
      trays: hasTrays ? traysText : 0,
      leaveningPct: result.pct,
      divisorN,
      // Read NOW, at save time: the words are written into the document in the language of this moment.
      words: { occasionalClient: t('calc.logOccasionalClient'), extraDough: t('calc.logExtraDough') },
      nowMs: Date.now(),
    });
    // Local-first: the log is in memory and the browser's copy at once, the write follows. null: the tab's log
    // is full, nothing was written, the store said so — the tab stays unlocked.
    const done = store.confirmDough({
      linkedLogId: lock?.logId ?? null, dough: result.source.name, recipeId: rid, forDay: day, version,
    });
    if (done === null) return;
    state.set(revealedKey(rid), '1');
    // Confirming is using the tab, even if nothing else was typed after.
    state.set(lockKey(rid), serializeLock(true, done.logId), rid);
    announceAction('dough-confirmed');
    wantFocus.current = 'recipe';
  }

  // Asks first, then unlocks KEEPING the link to the log (the next Confirm updates it), hides the recipe so it
  // cannot change live, and drops `revealed`.
  const onEdit = async () => {
    if (!locked) return;
    const ok = await confirm({
      title: t('ui.edit'), message: t('calc.editQuestion'), okLabel: t('ui.edit'), cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    state.remove(revealedKey(rid));
    state.set(lockKey(rid), serializeLock(false, lock?.logId));
    wantFocus.current = 'confirm';
  };

  // Everything the tab remembers goes through the ONE forget function (numbers, knob, selects, lock, revealed,
  // touched): the lock MUST go with the numbers, or the next Confirm would update the old log.
  const onReset = async () => {
    const ok = await confirm({
      title: t('calc.resetQuestion'), okLabel: t('calc.reset'), cancelLabel: t('common.cancel'), danger: true,
    });
    if (!ok) return;
    state.forget(rid, products.map(product => product.qtyId));
  };

  const range = knobRange(recipe.leaveningDefaultPct);
  const knobName = source.ingredients.find(ingredient => ingredient.key === source.leaveningKey)?.label ?? t('calc.leavening');
  const traysGramsId = `${uid}-trays-grams`;

  const entries = (
    <div key="entries" className={styles.entries}>
      {hasKnob ? (
        <div className={styles.param}>
          <label htmlFor={`${uid}-knob`} className={styles.paramLabel}>{`${knobName} %`}</label>
          <NumberField
            id={`${uid}-knob`}
            value={knobText}
            inputMode="decimal"
            min={range.min}
            max={range.max}
            step={range.step}
            disabled={locked}
            onChange={text => { set(paramKey(rid), text); }}
            onBlank={() => { reset(paramKey(rid), String(recipe.leaveningDefaultPct)); }}
          />
        </div>
      ) : null}

      {hasTrays ? (
        <div className={styles.param}>
          {/* The «= N g» sits BESIDE the label, not inside it: inside, the box's name would change on every
              keystroke. aria-describedby links it, and it stays a polite live region. */}
          <div className={styles.paramStack}>
            <label htmlFor={`${uid}-trays`} className={styles.paramLabel}>{t('calc.trayCount')}</label>
            <span id={traysGramsId} className={styles.traysGrams} aria-live="polite">
              {t('calc.traysEquals', { g: formatGrams(traysGrams(recipe, traysText), locale) })}
            </span>
          </div>
          <NumberField
            id={`${uid}-trays`}
            value={traysText}
            inputMode="numeric"
            min={0}
            step={1}
            describedBy={traysGramsId}
            disabled={locked}
            settle={settledTraysText}
            onChange={text => { set(traysKey(rid), text); }}
            onBlank={() => { reset(traysKey(rid), '0'); }}
          />
        </div>
      ) : null}

      {hasTotal ? (
        <div className={styles.param}>
          <label htmlFor={`${uid}-total`} className={styles.paramLabel}>{t('calc.totalDoughG')}</label>
          <NumberField
            id={`${uid}-total`}
            value={totalText}
            inputMode="numeric"
            min={0}
            step={1}
            disabled={locked}
            onChange={text => { set(totalKey(rid), text); }}
            onBlank={() => { reset(totalKey(rid), '0'); }}
          />
        </div>
      ) : null}

      {hasOrders ? (
        <>
          <h2 className={styles.section}>{t('calc.ordersSection')}</h2>
          <OrderCards
            products={products}
            textOf={qtyText}
            disabled={locked}
            onChange={(qtyId, text) => { set(qtyKey(qtyId), text); }}
            onBlank={qtyId => { reset(qtyKey(qtyId), '0'); }}
          />
        </>
      ) : null}

      {extraShown ? (
        <div className={styles.param}>
          <label htmlFor={`${uid}-extra`} className={styles.paramLabel}>{t('calc.extraDough')}</label>
          <div className={styles.group}>
            <NumberField
              id={`${uid}-extra`}
              value={extraText}
              inputMode="decimal"
              min={0}
              step={0.1}
              disabled={locked}
              onChange={text => { set(extraKey(rid), text); }}
              onBlank={() => { reset(extraKey(rid), '0'); }}
            />
            <select
              className={boxes.select}
              aria-label={t('calc.extraDoughUnit')}
              value={extraUnit}
              disabled={locked}
              onChange={event => { set(extraUnitKey(rid), event.target.value); }}
            >
              <option value="g">g</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>
      ) : null}

      {/* Confirm when there is something to make and the tab is open; Edit when it is locked; neither otherwise. */}
      {hasDough && !locked ? (
        <Button ref={confirmRef} variant="primary" className={styles.confirm} onPress={onConfirm}>{t('calc.confirm')}</Button>
      ) : null}
      {hasDough && locked ? (
        <Button className={styles.confirm} onPress={() => { void onEdit(); }}>
          <Pencil aria-hidden="true" />
          {t('ui.edit')}
        </Button>
      ) : null}
    </div>
  );

  const recipeCard = (
    <div key="result" className={styles.result}>
      {shown ? (
        <ResultCard
          headingRef={headingRef}
          recipe={recipe}
          result={result}
          config={config}
          products={products}
          qty={qty}
          divisorN={divisorN}
          onDivisorN={setDivisorN}
        />
      ) : null}
    </div>
  );

  const resetButton = (
    <div key="reset" className={styles.reset}>
      <Button variant="danger" onPress={() => { void onReset(); }}>{t('calc.resetAll')}</Button>
    </div>
  );

  const parts = shown ? [recipeCard, entries, resetButton] : [entries, recipeCard, resetButton];

  return (
    <div {...panelProps}>
      <ClearedNote rid={rid} />
      <div className={styles.layout}>{parts}</div>
      <Dialog
        isOpen={picking}
        title={t('calc.saveDoughFor')}
        dismissable
        onClose={() => { setPicking(false); }}
        actions={
          <>
            <Button onPress={() => { setPicking(false); }}>{t('common.cancel')}</Button>
            <Button variant="primary" onPress={() => { saveFor('today'); }}>{t('calc.today')}</Button>
            <Button variant="primary" onPress={() => { saveFor('tomorrow'); }}>{t('day.tomorrow')}</Button>
          </>
        }
      />
      {confirmDialog}
      {alertDialog}
    </div>
  );
}

// The quiet line saying why a tab is empty — shown ONLY for a tab the new-day sweep actually cleared, for 12
// seconds, and kept across redraws: the time is in the tab state, not in this component, which the
// configuration arriving redraws. It stays above the recipe.
function ClearedNote({ rid }: { rid: string }) {
  const { t } = useT();
  const state = useTabState();
  useTabVersion();
  const [, expire] = useState(0);
  const left = state.noteLeft(rid);

  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setTimeout(() => { expire(n => n + 1); }, left);
    return () => { clearTimeout(timer); };
  }, [left]);

  return left > 0 ? <p className={styles.note}>{t('calc.fieldsCleared')}</p> : null;
}
