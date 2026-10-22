import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import { readPackIngredients } from '@mise/shared/allergen-match';
import type { PackReading } from '@mise/shared/allergen-match';
import { ALLERGENS, ALLERGEN_GROUPS, NUTRIENTS } from '@mise/shared/allergen-model';
import type { AllergenCode, NutrientKey } from '@mise/shared/allergen-model';
import { allergenGroupName, allergenName, nutrientName, outputLanguage } from '@mise/shared/market';
import { allergensOn, nutritionOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import {
  allergenStatus, nutritionMissing, proposeFromPack, proposedNote, tickByHand, withChecked, withNutrient, withPackText,
} from './allergenCardModel';
import type { AllergenWorking, Column } from './allergenCardModel';
import type { ItemLike } from './ingredientCardModel';
import styles from './AllergenSections.module.css';

// The ingredient card's pack list, allergens and nutrition (parity C98–C116): the drawing half of allergenCardModel.ts, which
// holds every rule. Nothing here decides an allergen: each tap hands the model's answer up through `onChange`.
//
// ⚠️ THE FOOD WORDS (the allergens, their group headings, the nutrients) ARE THE VENUE'S COUNTRY'S: `lang` is read here, while
// drawing, from the session's venue — never the interface language. A British bakery run by an Italian reads this card in
// Italian and still prints «Wheat». The words that tell somebody what to tap («has», «traces», «I have checked…») are `t()`.
// This is a LABEL FILE (app/src/label-separation.spec.ts).
//
// ⚠️ THE TWO PANELS ARE READ LIVE FROM THE SESSION, on every draw. A panel the venue hides is not drawn AT ALL; the working copy
// is untouched by that, so nothing of it is written (the display switch is never a data switch, C12, C115).
//
// ⚠️⚠️ THE PACK TEXT PROPOSES, IT NEVER DECLARES (C105). It runs by itself, with no button: after a 450 ms pause in typing, and
// at Save (`flushProposal`). ⚠️ DIFFERENCE FROM THE CURRENT APP, ON PURPOSE: LEAVING THE BOX DOES NOT PROPOSE (the current app
// does, C106) — the boxes still move within 450 ms of the last keystroke, but a blur can no longer race a tap on a tick box.
// A proposal never lands inside a tap on the sections either: a press holds it until its click (see `pressStarted`). NEVER on
// the first draw (C107): a saved item can hold pack text that says «latte» and a milk box somebody deliberately unticked.
// Leaving the box untouched proposes nothing for the same reason. The state word of the pack fold is NEVER green: green means
// «somebody verified this».
//
// ⚠️ FOLDS OPEN CLOSED ON EVERY OPEN and are never remembered. The answer (the status line and the note about what the app
// ticked) stays outside the allergen fold: the app moves boxes by itself while that fold is shut, and a change nobody is told
// about is the worst thing an automatic feature can do here.
//
// ⚠️ ONE SAFETY SENTENCE IS INLINE UNDER THE PACK BOX («This only ticks boxes…»): Mise 2 has no «?» yet (his decision, 22 Oct
// 2026). The other help text waits for the shared «?» (T14).

export const PAUSE_MS = 450;
// After a finger lifts with no click following (a scroll, a release off the box), a held proposal runs after this long.
export const RELEASE_FALLBACK_MS = 700;

// What the card may ask of these sections from outside: open the nutrition fold so a refused box can take the focus.
export interface AllergenControls {
  openNutrition(): void;
  // Run a proposal that is still waiting (the pause has not ended, or a press is still down) NOW, so a save reads what the screen shows.
  flushProposal(): void;
}

export type NutrientBoxes = MutableRefObject<Partial<Record<NutrientKey, HTMLInputElement | null>>>;

type Props = {
  // The card's working copy of these sections (allergenWorkingFrom) and the item as the card opened on it.
  working: AllergenWorking;
  opened: ItemLike | null;
  // The moment a save would stamp «I have checked» with, for the date the status line shows.
  now: string;
  onChange(next: AllergenWorking): void;
  // The nutrition box Save refused, and where the card finds each box to focus it.
  refusedNutrient: { key: NutrientKey; reason: 'invalid' | 'thousands' } | null;
  nutrientBoxes: NutrientBoxes;
  controls: Ref<AllergenControls>;
};

// Space on a focused checkbox toggles it on the key-up, like a tap: R2.
const isSpace = (event: { key: string }) => event.key === ' ' || event.key === 'Spacebar';
const isCheckbox = (target: EventTarget) => target instanceof HTMLInputElement && target.type === 'checkbox';

type Tone = 'neutral' | 'warn' | 'ok';

// The groups the law names individually (more than one member) get their own heading; the rest go under «The rest».
const GROUPED = ALLERGEN_GROUPS
  .map(group => ({ group, codes: ALLERGENS.filter(a => a.group === group).map(a => a.code) }))
  .filter(entry => entry.codes.length > 1);
const SINGLES = ALLERGENS.filter(a => ALLERGENS.filter(other => other.group === a.group).length === 1).map(a => a.code);

function Fold({ title, state, tone, open, onToggle, above, children }: {
  title: string;
  state: string;
  tone: Tone;
  open: boolean;
  onToggle(): void;
  // The answer, outside the fold.
  above?: ReactNode;
  children: ReactNode;
}) {
  const headId = useId();
  const bodyId = useId();
  return (
    <div className={styles.fold}>
      <h3 id={headId} className={styles.heading}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className={styles.title}>{title}</span>
          {/* A space between the two, or the accessible name reads «Allergensnot declared». */}
          {' '}
          <span className={`${styles.state} ${tone === 'warn' ? styles.warn : tone === 'ok' ? styles.ok : styles.neutral}`}>{state}</span>
          <ChevronDown aria-hidden="true" className={styles.chevron} />
        </button>
      </h3>
      {above}
      <div id={bodyId} hidden={!open} className={styles.body}>{children}</div>
    </div>
  );
}

export function AllergenSections({ working, opened, now, onChange, refusedNutrient, nutrientBoxes, controls }: Props) {
  const { t } = useT();
  const { location } = useSession();
  const allergens = allergensOn(location);
  const nutrition = nutritionOn(location);
  const lang = outputLanguage(location);
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;

  const [packOpen, setPackOpen] = useState(false);
  const [algOpen, setAlgOpen] = useState(false);
  const [nutOpen, setNutOpen] = useState(false);
  // The venue's switch as of the latest draw: a proposal still waiting when the venue hides allergens must do nothing.
  const allergensRef = useRef(allergens);
  allergensRef.current = allergens;

  // The latest copy, kept here as well as in the card: a tap right after typing must start from the typing.
  const latest = useRef(working);
  const emit = (next: AllergenWorking) => {
    latest.current = next;
    onChange(next);
  };

  // What the last reading was made of. The findings on the card are for THIS text: they change at the pause, as the boxes do.
  const lastRead = useRef(working.packText);
  const [reading, setReading] = useState<{ text: string; read: PackReading }>(
    () => ({ text: working.packText, read: readPackIngredients(working.packText) }),
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  // ⚠️ A PROPOSAL NEVER LANDS INSIDE A TAP ON THE SECTIONS. A finger's order is pointerdown, pointerup, mousedown (the text box
  // blurs HERE), mouseup, click, change: a proposal that landed before the click would re-draw the box ticked, the click would
  // flip it OFF, and a box a person flipped is theirs for good. So a press (pointerdown anywhere in the sections) HOLDS the
  // proposal until its CLICK: the pause timer only marks it `deferred`. The press ends at whichever comes first, all listened
  // for on the window in CAPTURE, once per press: the click (a capture listener on the window runs BEFORE the checkbox's own
  // handlers, so the run waits a zero-delay timeout for its change to land first), a pointercancel, or — when the finger lifted
  // and no click followed (a scroll, a release off the box) — a 700 ms fallback after the pointerup. A SPACE on a focused box is a
  // press too: it starts at the keydown and ends at the click after the key-up (same fallback, from the key-up).
  // ⚠️ A tap that still lands just as the app ticked the same box keeps it ticked (tickByHand, RECENT_APP_TICK_MS).
  const pressed = useRef(false);
  const deferred = useRef(false);
  const afterPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  function runDeferred() {
    afterPress.current = null;
    if (!deferred.current) return;
    deferred.current = false;
    if (latest.current.packText !== lastRead.current) propose();
  }
  function endPress() {
    pressed.current = false;
    if (fallback.current !== null) clearTimeout(fallback.current);
    fallback.current = null;
    stopListening.current?.();
  }
  function pressEnded() {
    endPress();
    if (deferred.current && afterPress.current === null) afterPress.current = setTimeout(runDeferred, 0);
  }
  function onPause() {
    timer.current = null;
    if (pressed.current) {
      deferred.current = true;
      return;
    }
    propose();
  }
  function pressStarted() {
    pressed.current = true;
    if (fallback.current !== null) clearTimeout(fallback.current);
    fallback.current = null;
    if (stopListening.current) return;
    const lifted = () => {
      if (fallback.current !== null) clearTimeout(fallback.current);
      fallback.current = setTimeout(() => {
        endPress();
        runDeferred();
      }, RELEASE_FALLBACK_MS);
    };
    // A Space on a focused box is a press too: its click follows the key-up, with the same fallback if none comes.
    const liftedKey = (event: KeyboardEvent) => { if (isSpace(event)) lifted(); };
    window.addEventListener('click', pressEnded, true);
    window.addEventListener('pointercancel', pressEnded, true);
    window.addEventListener('pointerup', lifted, true);
    window.addEventListener('keyup', liftedKey, true);
    stopListening.current = () => {
      window.removeEventListener('click', pressEnded, true);
      window.removeEventListener('pointercancel', pressEnded, true);
      window.removeEventListener('pointerup', lifted, true);
      window.removeEventListener('keyup', liftedKey, true);
      stopListening.current = null;
    };
  }
  useEffect(() => () => {
    stopTimer();
    endPress();
    if (afterPress.current !== null) clearTimeout(afterPress.current);
  }, []);

  function propose() {
    stopTimer();
    deferred.current = false;
    if (!allergensRef.current) return;
    const text = latest.current.packText;
    lastRead.current = text;
    setReading({ text, read: readPackIngredients(text) });
    emit(proposeFromPack(latest.current, performance.now()));
  }

  useImperativeHandle(controls, () => ({
    openNutrition: () => { setNutOpen(true); },
    // Save asks for this first: whatever is waiting is run now, whether the pause or a press is what it waits for.
    flushProposal: () => {
      stopTimer();
      endPress();
      if (afterPress.current !== null) clearTimeout(afterPress.current);
      afterPress.current = null;
      deferred.current = false;
      if (latest.current.packText !== lastRead.current) propose();
    },
  }));

  const status = allergenStatus(working, opened, now);
  const note = proposedNote(working);
  const missing = nutritionMissing(working);
  const hasPack = working.packText.trim().length > 0;

  function tickRow(code: AllergenCode) {
    const name = allergenName(code, lang);
    const nameId = id(`alg-${code}`);
    const columns: ReadonlyArray<{ column: Column; word: string; tip: string }> = [
      { column: 'contains', word: t('sup.alg.has'), tip: t('sup.alg.containsTip', { name }) },
      { column: 'may', word: t('sup.alg.traces'), tip: t('sup.alg.tracesTip', { name }) },
    ];
    return (
      <div key={code} className={styles.row}>
        <span id={nameId} className={styles.name}>{name}</span>
        {columns.map(({ column, word, tip }) => {
          const wordId = id(`alg-${code}-${column}`);
          return (
            <label key={column} className={styles.tick} title={tip}>
              {/* ⚠️ THE ACCESSIBLE NAME IS THE VISIBLE WORDS («Milk has»), name first: a name that does not contain the visible
                  word fails WCAG 2.5.3 for people who speak to the screen. The longer sentence stays as the tip. */}
              <input
                type="checkbox"
                aria-labelledby={`${nameId} ${wordId}`}
                checked={(column === 'contains' ? working.contains : working.may).includes(code)}
                onChange={event => { emit(tickByHand(latest.current, code, column, event.target.checked, performance.now())); }}
              />
              <span id={wordId}>{word}</span>
            </label>
          );
        })}
      </div>
    );
  }

  function findings() {
    const lines: string[] = [];
    if (reading.text.trim() !== '' && !reading.read.recognisedAnything) lines.push(t('sup.alg.pack.recognisedNothing'));
    for (const question of reading.read.questions) {
      const word = reading.text.slice(question.from, question.to);
      const options = question.could.map(code => allergenName(code, lang)).filter(Boolean).join(' / ');
      if (question.kind === 'category') lines.push(t('sup.alg.pack.questionCategory', { word }));
      else if (options) lines.push(t('sup.alg.pack.questionWhich', { word, options }));
      else lines.push(t('sup.alg.pack.questionVague', { word }));
    }
    return lines;
  }

  const statusText = status.state === 'unknown'
    ? t('sup.alg.notChecked')
    : (() => {
      const what = status.state === 'none'
        ? t('sup.alg.containsNone')
        : status.codes.map(code => allergenName(code, lang)).join(', ');
      return status.date !== ''
        ? t('sup.alg.checkedOn', { date: status.date, what })
        : t('sup.alg.checkedNoDate', { what });
    })();
  const noteText = note.kind === 'none'
    ? ''
    : note.kind === 'voided'
      ? t('sup.alg.checkVoided')
      : t(note.kind === 'proposed' ? 'sup.alg.proposedTicks' : 'sup.alg.proposedAfterCheck', { n: note.n });

  if (!allergens && !nutrition) return null;

  return (
    <div className={styles.sections} onPointerDownCapture={pressStarted}
      onKeyDownCapture={event => { if (isSpace(event) && isCheckbox(event.target)) pressStarted(); }}>
      {allergens ? (
        <>
          <Fold
            title={t('sup.alg.pack.title')}
            state={hasPack ? t('sup.alg.pack.filledIn') : t('sup.alg.pack.toFillIn')}
            tone={hasPack ? 'neutral' : 'warn'}
            open={packOpen}
            onToggle={() => { setPackOpen(!packOpen); }}
          >
            <textarea
              rows={4}
              maxLength={4000}
              className={`${styles.box} ${styles.packText}`}
              aria-label={t('sup.alg.pack.label')}
              aria-describedby={id('still-yours')}
              placeholder={t('sup.alg.pack.placeholder')}
              value={working.packText}
              onChange={event => {
                emit(withPackText(latest.current, event.target.value));
                stopTimer();
                deferred.current = false;
                timer.current = setTimeout(onPause, PAUSE_MS);
              }}
            />
            {/* ⚠️ THE FINDINGS ARE ABOUT THIS PACK, so they are on the card and not behind a «?». A live region, there before it
                speaks. */}
            <div role="status" className={styles.findings}>
              {findings().map((line, index) => <p key={index} className={styles.finding}>{line}</p>)}
            </div>
            <p id={id('still-yours')} className={styles.hint}>{t('sup.alg.pack.stillYours')}</p>
          </Fold>

          <Fold
            title={t('sup.alg.title')}
            state={status.state === 'unknown' ? t('sup.alg.notDeclared') : t('sup.alg.declared')}
            tone={status.state === 'unknown' ? 'warn' : 'ok'}
            open={algOpen}
            onToggle={() => { setAlgOpen(!algOpen); }}
            above={(
              <>
                <p role="status" className={`${styles.status} ${status.state === 'unknown' ? styles.statusUnknown : styles.statusKnown}`}>
                  {statusText}
                </p>
                <p role="status" className={noteText === '' ? styles.quiet : styles.note}>{noteText}</p>
              </>
            )}
          >
            {GROUPED.map(({ group, codes }) => (
              <div key={group} role="group" aria-labelledby={id(`group-${group}`)}>
                <p id={id(`group-${group}`)} className={styles.group}>{allergenGroupName(group, lang) || group}</p>
                {codes.map(tickRow)}
              </div>
            ))}
            <div role="group" aria-labelledby={id('group-rest')}>
              <p id={id('group-rest')} className={styles.group}>{t('sup.alg.theRest')}</p>
              {SINGLES.map(tickRow)}
            </div>
            <label className={styles.checked}>
              <input
                type="checkbox"
                checked={working.checked}
                onChange={event => { emit(withChecked(latest.current, event.target.checked)); }}
              />
              <span>{t('sup.alg.iHaveChecked')}</span>
            </label>
          </Fold>
        </>
      ) : null}

      {nutrition ? (
        <Fold
          title={t('sup.nut.title')}
          state={missing === NUTRIENTS.length
            ? t('sup.nut.noneYet')
            : missing > 0 ? t('sup.nut.stillEmpty', { n: missing, total: NUTRIENTS.length }) : t('sup.nut.complete')}
          tone={missing === 0 ? 'ok' : 'neutral'}
          open={nutOpen}
          onToggle={() => { setNutOpen(!nutOpen); }}
        >
          <p className={styles.per100}>{t('sup.nut.per100g')}</p>
          <div className={styles.nutGrid}>
            {NUTRIENTS.map(nutrient => {
              const refused = refusedNutrient?.key === nutrient.key;
              return (
                <div key={nutrient.key} className={styles.nutField}>
                  <label htmlFor={id(`nut-${nutrient.key}`)} className={styles.nutLabel}>
                    {`${nutrientName(nutrient, lang)} (${nutrient.unit})`}
                  </label>
                  <input
                    ref={element => { nutrientBoxes.current[nutrient.key] = element; }}
                    id={id(`nut-${nutrient.key}`)}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className={styles.box}
                    aria-invalid={refused ? true : undefined}
                    aria-describedby={id(`nut-${nutrient.key}-error`)}
                    value={working.nutrition[nutrient.key]}
                    onChange={event => { emit(withNutrient(latest.current, nutrient.key, event.target.value)); }}
                  />
                  {/* ⚠️ THE LIVE REGION IS THERE, EMPTY, BEFORE IT SPEAKS. */}
                  <p id={id(`nut-${nutrient.key}-error`)} role="status" className={refused ? styles.error : styles.quiet}>
                    {refused ? t(refusedNutrient?.reason === 'thousands' ? 'sup.nut.noThousands' : 'sup.nut.invalid') : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </Fold>
      ) : null}
    </div>
  );
}
