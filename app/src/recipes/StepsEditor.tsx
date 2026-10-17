import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { ArrowDown, ArrowUp, Check, Trash2 } from 'lucide-react';
import { useBlocker, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { formatDuration } from '@mise/shared/guided-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useRecipesStore } from './RecipesContext';
import { amountText, recipeAmounts } from './recipeAmounts';
import { cameFromRecipe, useLeave } from './recipesNav';
import { recipePath } from './recipesPath';
import {
  MAX_END_NOTE, MAX_SPEED_TEXT, MAX_STEPS, MAX_STEP_TEXT, MAX_MINUTES, MAX_SECONDS_PART, addStep, canAddStep, moveStep, procedureOf, removeStep, rowCheck,
  setEndNote, setStepRow, setStepSpeed, setStepText, setStepTime, stepsWorkingFrom, tickableRows, timeBoxes, totalSeconds,
} from './stepsEditorModel';
import type { EditStep, StepsWorking } from './stepsEditorModel';
import styles from './StepsEditor.module.css';

type Props = {
  id: string;
  // The recipe as the list holds it when this form mounts (null: deleted on another phone while the screen was open).
  recipe: CatalogueRecipe | null;
  titleRef: Ref<HTMLHeadingElement>;
  // Told when something is typed, so the screen knows a newer copy from the server must not replace the form.
  onTyped?: () => void;
};

const NO_RECIPE: CatalogueRecipe = { id: '', name: '', ingredients: [], lossPct: 0 };

// What the focus is owed after a change, looked up AFTER the render (and after a dialog has given the focus back to a
// button that may be gone): an object, so asking twice for the same thing works twice.
type Owed =
  | { readonly kind: 'move'; readonly key: number; readonly dir: -1 | 1 }
  | { readonly kind: 'text'; readonly key: number }
  | { readonly kind: 'remove'; readonly index: number };

// Nothing to do when the screen is left: the recipe steps back to the list's focus by itself.
const NOTHING = (): void => undefined;

// The mixing steps editor (a port of js/catalogue/guided-editor.js, decision for decision). The editing pattern is the
// app's own (P20): a working COPY, nothing touches the stored recipe until Save, Save asks first, and leaving with
// unsaved edits asks. It sits one level below the recipe: Back (and Save) returns to it.
//
// ⚠️ THE COPY IS TAKEN ONCE, WHEN THIS FORM MOUNTS (StepsEditorScreen mounts it only once the recipe is in the list): the
// rows with their ids minted into the copy, so every tick box names a row that stays the same row whatever is typed
// elsewhere, and the steps and the closing message as the normaliser reads them. A recipe changed on another phone
// afterwards NEVER replaces the copy.
//
// ⚠️ THE CHECK OVER THE ROWS (a named row in no step) is read at every draw, so it follows a box as it is ticked. It is a
// WARNING and never a block: a recipe can hold a row the mixing does not use (flour for dusting).
export function StepsEditor({ id, recipe, titleRef, onTyped }: Props) {
  const { t, locale } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const titleId = `${ids}-title`;
  const endNoteId = `${ids}-end`;
  const hintId = `${ids}-end-hint`;

  const [source] = useState<CatalogueRecipe>(recipe ?? NO_RECIPE);
  const [working, setWorking] = useState<StepsWorking>(() => stepsWorkingFrom(source));
  // The name the recipe had when this screen opened: what the Save question calls it.
  const [name] = useState(source.name);

  // ⚠️ DIRTY IS «SOMETHING WAS TYPED», also kept in a ref: the router's blocker reads it at the moment of a navigation.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const edit = (change: (current: StepsWorking) => StepsWorking) => {
    dirtyRef.current = true;
    onTyped?.();
    setDirty(true);
    setWorking(change);
  };
  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Set once the edits are saved, so leaving asks nothing.
  const leavingClean = useRef(false);
  // A second tap on Save (or Remove) while a question is open is ignored.
  const busy = useRef(false);
  const askingLeave = useRef(false);

  // One level up: the recipe. The browser's Back when the recipe is the entry behind this one, otherwise this entry is
  // replaced by the recipe (a page opened by its address).
  const leave = useLeave(recipePath(id), NOTHING, cameFromRecipe);

  // ── Leaving with unsaved changes ─────────────────────────────────────────────────────────────────────────────
  const discardQuestion = () => confirm({
    title: t('cat.discardChanges'),
    message: t('cat.theStepsYouHave'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's Back, a recipe picked in
  // the split's list, the rail and the tab bar all navigate. Staying on the same address is never blocked.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      askingLeave.current = false;
      return;
    }
    if (askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        // The form went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } catch (error) {
        askingLeave.current = false;
        throw error;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker fails
  // silently on a POP to an entry it did not create (a page opened by its address).
  async function back() {
    if (busy.current || askingLeave.current) return;
    if (dirtyRef.current) {
      busy.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        busy.current = false;
      }
    }
    leavingClean.current = true;
    leave();
  }

  // ── Where the focus is owed ──────────────────────────────────────────────────────────────────────────────────
  const nodes = useRef(new Map<string, HTMLElement>());
  const register = (name: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(name, node);
    else nodes.current.delete(name);
  };
  const [owed, setOwed] = useState<Owed | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const stepsNow = useRef(working.steps);
  stepsNow.current = working.steps;
  useEffect(() => {
    if (owed === null) return undefined;
    const frame = requestAnimationFrame(() => {
      const steps = stepsNow.current;
      if (owed.kind === 'text') {
        nodes.current.get(`${owed.key}:text`)?.focus();
      } else if (owed.kind === 'move') {
        // The arrow just pressed, or the other one when this one has become disabled (the step reached an end).
        const same = nodes.current.get(`${owed.key}:${owed.dir === -1 ? 'up' : 'down'}`) as HTMLButtonElement | undefined;
        const other = nodes.current.get(`${owed.key}:${owed.dir === -1 ? 'down' : 'up'}`) as HTMLButtonElement | undefined;
        (same && !same.disabled ? same : other)?.focus();
      } else {
        // A step was taken out: the one now at its place (or the one before, at the end), else the Add button.
        const next = steps[owed.index] ?? steps[owed.index - 1];
        (next ? nodes.current.get(`${next.key}:remove`) : addButton.current)?.focus();
      }
    });
    return () => { cancelAnimationFrame(frame); };
  }, [owed]);

  // ── The steps ────────────────────────────────────────────────────────────────────────────────────────────────
  function add() {
    if (!canAddStep(working)) {
      say(t('cat.procedureCanHold', { n: MAX_STEPS }));
      return;
    }
    const added = addStep(working);
    edit(addStep);
    const fresh = added.steps[added.steps.length - 1];
    if (fresh) setOwed({ kind: 'text', key: fresh.key });
  }

  function move(key: number, dir: -1 | 1) {
    if (moveStep(working, key, dir) === working) return;
    edit(current => moveStep(current, key, dir));
    setOwed({ kind: 'move', key, dir });
  }

  async function remove(key: number) {
    if (busy.current || askingLeave.current || leavingClean.current) return;
    const index = working.steps.findIndex(step => step.key === key);
    if (index < 0) return;
    busy.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: t('cat.removeThisStep'),
        message: t('cat.stepWillBeRemoved', { n: index + 1 }),
        okLabel: t('ui.remove'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
    } finally {
      busy.current = false;
    }
    if (!ok || !mounted.current) return;
    edit(current => removeStep(current, key));
    setOwed({ kind: 'remove', index });
  }

  const changeTime = (key: number, part: 'minutes' | 'seconds', value: string) => {
    edit(current => {
      const step = current.steps.find(candidate => candidate.key === key);
      if (!step) return current;
      const boxes = timeBoxes(step.seconds);
      return part === 'minutes' ? setStepTime(current, key, value, boxes.seconds) : setStepTime(current, key, boxes.minutes, value);
    });
  };

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async function save() {
    if (busy.current || askingLeave.current || leavingClean.current) return;
    const procedure = procedureOf(working);
    busy.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: t('cat.saveTheProcedure'),
        message: procedure.steps.length > 0 ? t('cat.saveStepsFor', { n: procedure.steps.length, name }) : t('cat.noProcedureFor', { name }),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
    } finally {
      busy.current = false;
    }
    if (!ok || !mounted.current) return;
    // Saved: nothing is unsaved any more, so leaving asks nothing. Local-first: the recipe changes at once and the database
    // follows; a refused write is taken back and said by the store.
    leavingClean.current = true;
    if (!store.saveProcedure({ id, name, ...procedure })) {
      // The recipe is not held any more (deleted on another phone): nothing was written, and the typing stays.
      leavingClean.current = false;
      say(t('recipes.notFound'));
      return;
    }
    announceAction('procedure-saved');
    say(t('cat.procedureSaved'));
    leave();
  }

  // ── What is drawn ────────────────────────────────────────────────────────────────────────────────────────────
  const check = rowCheck(working);
  const ticks = tickableRows(working);
  // The amounts as the recipe page writes them (recipeAmounts), over the very rows being ticked.
  const amounts = useMemo(
    () => recipeAmounts({ ...source, ingredients: [...working.rows] }, null, t, locale).rows,
    [source, working.rows, t, locale],
  );

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t('cat.mixingSteps')}
        titleId={titleId}
        titleRef={titleRef}
        action={
          <Button variant="primary" onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />

      <div className={styles.body}>
        <div className={styles.top}>
          <p className={styles.summary}>
            {working.steps.length > 0
              ? t('cat.stepsAndTimers', { n: working.steps.length, duration: formatDuration(totalSeconds(working)) })
              : t('cat.noStepsYet')}
          </p>
          <div aria-live="polite" className={styles.check}>
            {check.kind === 'no-steps' ? <p className={styles.hint}>{t('cat.addTheFirstStep')}</p> : null}
            {check.kind === 'all-in' ? <p className={styles.ok}>{t('cat.everyIngredientIsIn')}</p> : null}
            {check.kind === 'missing' ? (
              <>
                <p className={styles.warn}>{t('cat.notInAnyStepYet', { list: check.labels.join(', ') })}</p>
                <p className={styles.hint}>{t('cat.whoeverFollowsThisWill')}</p>
              </>
            ) : null}
          </div>
        </div>

        {working.steps.length > 0 ? (
          <ol className={styles.steps}>
            {working.steps.map((step, index) => (
              <li key={step.key} className={styles.card}>
                <StepCard
                  step={step}
                  n={index + 1}
                  first={index === 0}
                  last={index === working.steps.length - 1}
                  ticks={ticks}
                  amounts={amounts.map(amountText)}
                  register={register}
                  onMove={move}
                  onRemove={key => { void remove(key); }}
                  onText={(key, value) => { edit(current => setStepText(current, key, value)); }}
                  onRow={(key, rid, on) => { edit(current => setStepRow(current, key, rid, on)); }}
                  onTime={changeTime}
                  onSpeed={(key, value) => { edit(current => setStepSpeed(current, key, value)); }}
                />
              </li>
            ))}
          </ol>
        ) : null}

        <Button ref={addButton} variant="secondary" className={styles.add} onPress={add}>
          {t('cat.addStep')}
        </Button>

        {/* ⚠️ AT THE BOTTOM, after the steps, because that is where it appears when the procedure runs: an editor whose
            order does not match the screen it produces makes people write things in the wrong place. */}
        <div className={styles.end}>
          <p id={endNoteId} className={styles.endHead}>{t('cat.whenTheDoughIs')}</p>
          <textarea
            className={styles.textarea}
            rows={2}
            maxLength={MAX_END_NOTE}
            placeholder={t('cat.eGFinalDough')}
            aria-label={t('cat.closingMessageShownWhen')}
            aria-describedby={hintId}
            value={working.endNote}
            onChange={event => { edit(current => setEndNote(current, event.target.value)); }}
          />
          <p id={hintId} className={styles.hint}>{t('cat.shownOnItsOwn')}</p>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}

type CardProps = {
  step: EditStep;
  n: number;
  first: boolean;
  last: boolean;
  ticks: ReturnType<typeof tickableRows>;
  // Each row's amount as the recipe page writes it, by the row's place in the recipe.
  amounts: readonly string[];
  register: (name: string, node: HTMLElement | null) => void;
  onMove: (key: number, dir: -1 | 1) => void;
  onRemove: (key: number) => void;
  onText: (key: number, value: string) => void;
  onRow: (key: number, rid: string, on: boolean) => void;
  onTime: (key: number, part: 'minutes' | 'seconds', value: string) => void;
  onSpeed: (key: number, value: string) => void;
};

// One step: its head with the three icon buttons, the instruction, the tick boxes over the recipe's own rows (ticking, not
// typing: a name typed here would be a COPY of the recipe, free to drift from it and to carry its own typo), the timer as
// minutes and seconds (4:30 is how a mixing time is said, and one box invites 4.5 — four and a half of something nobody has
// named) and the mixer speed.
function StepCard({ step, n, first, last, ticks, amounts, register, onMove, onRemove, onText, onRow, onTime, onSpeed }: CardProps) {
  const { t } = useT();
  const ids = useId();
  const headId = `${ids}-head`;
  const picksId = `${ids}-picks`;
  const timerId = `${ids}-timer`;
  const time = timeBoxes(step.seconds);
  const { key } = step;

  return (
    <div role="group" aria-labelledby={headId} className={styles.cardBody}>
      <div className={styles.cardHead}>
        <h3 id={headId} className={styles.stepName}>{t('cat.stepN', { n })}</h3>
        <button
          ref={node => { register(`${key}:up`, node); }}
          type="button"
          className={styles.icon}
          aria-label={t('cat.moveStepUp', { n })}
          title={t('cat.moveStepUp', { n })}
          disabled={first}
          onClick={() => { onMove(key, -1); }}
        >
          <ArrowUp aria-hidden="true" />
        </button>
        <button
          ref={node => { register(`${key}:down`, node); }}
          type="button"
          className={styles.icon}
          aria-label={t('cat.moveStepDown', { n })}
          title={t('cat.moveStepDown', { n })}
          disabled={last}
          onClick={() => { onMove(key, 1); }}
        >
          <ArrowDown aria-hidden="true" />
        </button>
        <button
          ref={node => { register(`${key}:remove`, node); }}
          type="button"
          className={styles.icon}
          aria-label={t('cat.removeStepN', { n })}
          title={t('cat.removeStepN', { n })}
          onClick={() => { onRemove(key); }}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>

      <input
        ref={node => { register(`${key}:text`, node); }}
        type="text"
        autoComplete="off"
        className={styles.box}
        maxLength={MAX_STEP_TEXT}
        placeholder={t('cat.whatToDoE')}
        aria-label={t('cat.stepInstruction', { n })}
        value={step.text}
        onChange={event => { onText(key, event.target.value); }}
      />

      {/* ABSENT, not empty, when no row of the recipe has a name: there is nothing to tick. */}
      {ticks.length > 0 ? (
        <div className={styles.field} role="group" aria-labelledby={picksId}>
          <span id={picksId} className={styles.label}>{t('cat.ingredientsToAdd')}</span>
          <div className={styles.picks}>
            {ticks.map(row => (
              <label key={row.rid} className={styles.pick}>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={step.rows.includes(row.rid)}
                  onChange={event => { onRow(key, row.rid, event.target.checked); }}
                />
                <span className={styles.pickName}>{row.label}</span>{' '}
                <span className={styles.pickAmount}>{amounts[row.index] ?? ''}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.field} role="group" aria-labelledby={timerId}>
        <span id={timerId} className={styles.label}>{t('cat.timer')}</span>
        <div className={styles.time}>
          <input
            type="number"
            min="0"
            max={MAX_MINUTES}
            step="1"
            inputMode="numeric"
            className={`${styles.box} ${styles.num}`}
            placeholder="0"
            aria-label={t('cat.stepMinutes', { n })}
            value={time.minutes}
            onChange={event => { onTime(key, 'minutes', event.target.value); }}
          />
          <span className={styles.unit}>{t('cat.minWord')}</span>
          <input
            type="number"
            min="0"
            max={MAX_SECONDS_PART}
            step="1"
            inputMode="numeric"
            className={`${styles.box} ${styles.num}`}
            placeholder="0"
            aria-label={t('cat.stepSeconds', { n })}
            value={time.seconds}
            onChange={event => { onTime(key, 'seconds', event.target.value); }}
          />
          <span className={styles.unit}>{t('cat.secWord')}</span>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{t('cat.mixerSpeed')}</span>
        <input
          type="text"
          autoComplete="off"
          className={styles.box}
          maxLength={MAX_SPEED_TEXT}
          placeholder={t('cat.speedExample')}
          aria-label={t('cat.stepSpeed', { n })}
          value={step.speed}
          onChange={event => { onSpeed(key, event.target.value); }}
        />
      </div>
    </div>
  );
}
