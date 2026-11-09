import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import {
  MAX_ITEM_NOTE_LENGTH, MAX_NAME_LENGTH, MAX_NOTE_LENGTH, MAX_QTY, cleanItems, cleanNote, findInvalidItems,
} from '@mise/shared/pastries-model';
import { workDate } from '@mise/shared/pastries-log-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { blankRow, fieldOf, isUntouched, namesOnOtherDays, problemMessage, rowsFrom, workingItems } from './editorModel';
import type { EditorField, EditorRow } from './editorModel';
import { editRecordedDayQuestion } from './lockQuestion';
import { usePastries, usePastriesStore } from './PastriesContext';
import { FROM_DAY, cameFromDay, copyOf, useLeave } from './pastriesNav';
import { dayPath, tabId, weekdayLabel } from './weekdays';
import styles from './Editor.module.css';

type Props = {
  day: Weekday;
  // Set when the person is handed back to the day, so the pencil takes the focus (DayPanel).
  handBackFocus: RefObject<boolean>;
  // Set instead of handBackFocus when this editor is a COPY and the person steps back to the day it
  // was copied from: «Copy day» takes the focus there, not the pencil (DayPanel).
  handBackToCopy: RefObject<boolean>;
};

// «Copy day» in the editor: the day whose list pre-fills it, and whether the person has already
// agreed to change a RECORDED target. Agreeing is all it records — the permission itself is only
// granted by the copy's Save, so a copy thrown away leaves the recorded day locked.
type CopyRequest = { readonly from: Weekday; readonly agreed: boolean };

// The hand-back flag to raise when stepping back to the day: the pencil's, or «Copy day»'s for a copy
// that came from the day (opened by its address there is no «Copy day» button behind it).
function useHandBack(props: Props, copying: boolean, fromDay: boolean): () => void {
  const { handBackFocus, handBackToCopy } = props;
  return useCallback(() => {
    (copying && fromDay ? handBackToCopy : handBackFocus).current = true;
  }, [handBackFocus, handBackToCopy, copying, fromDay]);
}

// Where to put the focus once the rows have been redrawn: on a new row, or where a removed one was.
type FocusRequest = { readonly row: 'last' } | { readonly row: number };

const inputKey = (id: number, field: EditorField): string => `${id}-${field}`;

type Phase = 'waiting' | 'asking' | 'open';

// ⚠️ THE EDITOR COPIES THE DAY ONCE AND NEVER REPAINTS, so it must not open before the day is there.
// Opened by its address (a reload, a bookmark) on a phone with nothing stored, the seven days are
// still on their way: a copy taken now would be an EMPTY day, and a Save would write that over the
// real one. It waits for the first answer (store.daysLoaded; a stream that fails counts as an answer,
// so it never waits for ever; an EMPTY answer from the device's own cache does not count as the first
// answer — see believable() in pastriesStore.ts). While the days are missing it says «The list hasn't
// arrived yet — it opens as soon as it does.»; once only the confirmations are missing, «Loading…».
// Opened from the day, the days are long loaded and this is one render.
//
// ⚠️ THE EDITOR ASKS THE LOCK QUESTION ITSELF, ONCE. From the day, the pencil has already asked it
// (DayPanel's gate) and by the time the editor opens the permission is stored, so it opens straight.
// But opened by its address it has come through no gate: without this, typing the address of a
// recorded day would be a way round the lock. So when BOTH answers are in (the days, and tonight's
// confirmations — until the second one, «not recorded» only means «nobody has said») it asks, once,
// the same question as the day panel. Edit grants the permission and the form opens; Cancel leaves
// for the day (no discard question: nothing has been typed, the form is not there yet). Once decided
// it is never asked again: a colleague confirming the day while it is open changes nothing here, as
// in the current app.
export function Editor(props: Props) {
  const { day } = props;
  const { t } = useT();
  const store = usePastriesStore();
  const { state, pathname } = useLocation();
  const navigate = useNavigate();
  const { daysLoaded, confirmedLoaded } = usePastries();
  const [confirm, confirmDialog] = useConfirm();
  const [phase, setPhase] = useState<Phase>('waiting');
  // The copy this editor was opened for, if any: fixed when the phase is decided (below).
  const [copy, setCopy] = useState<CopyRequest | null>(null);
  const label = weekdayLabel(t, day);
  const handBack = useHandBack(props, copy !== null, cameFromDay(state));
  const leave = useLeave(dayPath(day), handBack);
  // The latest of all, read by the question below, which must not start over when they change.
  const latest = useRef({ leave, label, copy });
  useEffect(() => { latest.current = { leave, label, copy }; });

  // Decided while drawing, not in an effect, so the form is never on the page for a frame before the
  // question. The lock is read from the clock, like the day panel does (store.isLocked).
  //
  // ⚠️ A COPY WHOSE SOURCE HAS NO ROWS IS AN ORDINARY EDIT: the source may have been emptied by
  // another phone between the question and now, and an empty copy would only wipe the target.
  // And a person who already said «Edit» for the copy TODAY (the day panel asked, and the request
  // carries the work date) is not asked again; an older date — a reload tomorrow, a stale history
  // entry — is.
  if (phase === 'waiting' && daysLoaded && confirmedLoaded) {
    const requested = copyOf(state);
    const usable = requested !== null
      && requested.from !== day
      && store.getSnapshot().days[requested.from].items.length > 0;
    const agreed = usable && requested.editAgreedOn === workDate(Date.now());
    setCopy(usable ? { from: requested.from, agreed } : null);
    setPhase(store.isLocked(day) && !agreed ? 'asking' : 'open');
  }

  // ⚠️ A COPY REQUEST IS SPENT BY THE OPENING THAT READ IT. Once the phase is decided it is taken out of
  // the history entry (the same address, replaced, its other marks kept): left there, a reload or the
  // browser's Forward after a Discard would bring the copy back without its questions — «Replace the
  // list of {day}?» above all, about a target another phone may have filled meanwhile (code review,
  // 8 Nov 2026). Spent, they open an ordinary edit of the target, as a reload does in the current app.
  // The same address is never blocked (shouldBlock below), and the editor is keyed on its day, so
  // nothing on screen starts over.
  useEffect(() => {
    if (phase === 'waiting' || copyOf(state) === null) return;
    void navigate(pathname, { replace: true, state: cameFromDay(state) ? FROM_DAY : KEEP_FOCUS });
  }, [phase, state, pathname, navigate]);

  // Started by the phase, and dropped with the editor (a way out of the page while it is open; React's
  // development mode, which mounts everything twice, starts it again).
  useEffect(() => {
    if (phase !== 'asking') return;
    let cancelled = false;
    void (async () => {
      const ok = await confirm(editRecordedDayQuestion(t, latest.current.label));
      if (cancelled) return;
      if (ok) {
        if (latest.current.copy) {
          // A copy only records the yes: the permission comes with its Save (see CopyRequest).
          setCopy(current => (current ? { ...current, agreed: true } : current));
        } else {
          // The permission carries tonight's work date, so 4am spends it — and so does the next Confirm.
          store.grantEdit(day);
        }
        setPhase('open');
      } else {
        latest.current.leave();
      }
    })();
    return () => { cancelled = true; };
  }, [phase, confirm, store, day, t]);

  if (phase !== 'open') {
    return (
      <section className={styles.editor} aria-busy="true">
        <p className={styles.loading}>{daysLoaded ? t('session.loading') : t('past.listNotLoadedYet')}</p>
        {confirmDialog}
      </section>
    );
  }
  return <EditorForm {...props} copy={copy} />;
}

// One day's list, edited (the form; Editor above waits for the day and for the lock question).
//
// ⚠️ EVERYTHING HAPPENS ON A WORKING COPY (P20): nothing touches the stored day until Save is
// pressed and confirmed, and leaving with something typed asks first.
//
// ⚠️ THE FORM DOES NOT CHECK THE LOCK. A confirmed day is guarded where the editor is entered: from
// the day, by the pencil in DayPanel (through the same `requestEdit` as a row); by its address, by
// the question Editor asks above, before this form exists. The form itself only edits what it was
// given.
//
// ⚠️ A SNAPSHOT FROM ANOTHER PHONE DOES NOT REPAINT IT. It reads the stored day once, when it opens
// (store.getSnapshot(), never usePastries()): replacing the rows would delete what somebody is in
// the middle of typing. The names on the other days are read once too, for the same reason.
//
// ⚠️ A COPY IS DIRTY FROM THE START: nothing of it is stored yet, so Back and the router's blocker
// ask before throwing it away (a reload asks nothing and opens an ordinary edit: see Editor above). Its rows (name, quantity and row note) come from the
// source day; the standing note stays the TARGET's own.
function EditorForm(props: Props & { copy: CopyRequest | null }) {
  const { day, handBackFocus, handBackToCopy, copy } = props;
  const { t } = useT();
  const store = usePastriesStore();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const { state } = useLocation();
  const label = weekdayLabel(t, day);
  const ids = useId();
  const titleId = `${ids}-title`;
  const listId = `${ids}-names`;
  const noteId = `${ids}-note`;
  const kickerId = `${ids}-kicker`;

  const idCounter = useRef(0);
  const nextId = useCallback(() => {
    idCounter.current += 1;
    return idCounter.current;
  }, []);

  // The working copy: the stored day as it is NOW, read once.
  const [start] = useState(() => {
    const { days } = store.getSnapshot();
    // A copy takes its rows from the source day; the standing note is always the target's own.
    const source = copy ? days[copy.from] : days[day];
    return { rows: rowsFrom(source.items, nextId), note: days[day].note, suggestions: namesOnOtherDays(days, day) };
  });
  const [rows, setRows] = useState<EditorRow[]>(start.rows);
  const [note, setNote] = useState(start.note);
  const [showErrors, setShowErrors] = useState(false);

  // ⚠️ DIRTY IS «SOMETHING WAS TOUCHED», as in the current app, and it is also kept in a ref: the
  // router's blocker reads it at the moment of a navigation, and a state value read there could be
  // one render behind.
  const [dirty, setDirty] = useState(copy !== null);
  const dirtyRef = useRef(copy !== null);
  const touch = () => {
    dirtyRef.current = true;
    setDirty(true);
  };

  // Unsaved edits: a reload the app starts by itself waits until they are saved or dropped
  // (session/busy.ts). Released on save, on discard, and when the editor goes away.
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  // A second tap while a question is open does nothing.
  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const setInput = (id: number, field: EditorField, node: HTMLInputElement | null) => {
    if (node) inputs.current.set(inputKey(id, field), node);
    else inputs.current.delete(inputKey(id, field));
  };
  const pending = useRef<FocusRequest | null>(null);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    const index = request.row === 'last' ? rows.length - 1 : Math.min(request.row, rows.length - 1);
    const row = rows[index];
    if (row) inputs.current.get(inputKey(row.id, 'name'))?.focus();
  }, [rows]);

  // Arriving from the day, the page does not move the focus (FROM_DAY): it goes to this title, so
  // the screen's name is what a screen reader hears. Opened by its address, the page does it.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (cameFromDay(state)) title.current?.focus();
  }, []);

  // The copy's notice. ⚠️ THE REGION IS ON THE PAGE EMPTY and filled right after mount: a live
  // region inserted already filled in is announced unreliably.
  const [copiedNotice, setCopiedNotice] = useState('');
  useEffect(() => {
    if (copy) setCopiedNotice(t('past.copiedFromDay', { day: weekdayLabel(t, copy.from) }));
  }, []);

  const handBack = useHandBack(props, copy !== null, cameFromDay(state));
  const leave = useLeave(dayPath(day), handBack);

  // ── Leaving with unsaved changes ──────────────────────────────────────────────────────────
  //
  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's
  // Back, a day picked in the split's list, the rail and the tab bar all navigate, and a question
  // asked only by the Back button would let each of them throw the edits away without a word.
  // Staying on the same address (nothing to leave) is never blocked.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const askingLeave = useRef(false);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked' || askingLeave.current) return;
    askingLeave.current = true;
    // A day picked from the list of days has already put the focus on the day aimed at (DaysNav moves
    // it with the key, before the router answers): note it, because a refusal leaves it there.
    const pickedFromDays = document.activeElement?.closest('[role="tab"]') != null;
    void (async () => {
      try {
        const discard = await confirm({
          title: t('past.discardChanges'),
          message: t('past.unsavedFor', { day: label }),
          okLabel: t('ui.discard'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        // The editor went away while the question was open (answered «no» on its way out): the
        // router has already dropped its blocker, and answering it again would throw.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) {
          current.proceed();
        } else {
          // Staying: the Back button has already said «the day panel should take the focus», and
          // nobody is going there. Left set, the next day panel to open would grab the focus.
          handBackFocus.current = false;
          handBackToCopy.current = false;
          current.reset();
          // ⚠️ A REFUSED PICK LEAVES THE FOCUS ON A DAY THAT IS NOT SELECTED (and out of the Tab
          // order): the arrow keys would carry on from the wrong place. Back to the day being edited.
          // Done now, while the focus is nowhere: the dialog's own restore, a frame later, only acts
          // on a focus that is lost, and would put it back on the day that was aimed at.
          if (pickedFromDays) document.getElementById(tabId(day))?.focus();
        }
      } finally {
        askingLeave.current = false;
      }
    })();
  });

  // ── The rows ──────────────────────────────────────────────────────────────────────────────

  const change = (id: number, patch: { name?: string; qty?: string; note?: string }) => {
    setRows(current => current.map(row => (row.id === id ? { ...row, ...patch } : row)));
    touch();
  };

  const add = () => {
    const row = blankRow(nextId());
    setRows(current => [...current, row]);
    pending.current = { row: 'last' };
    touch();
  };

  async function remove(id: number) {
    if (asking.current) return;
    const index = rows.findIndex(row => row.id === id);
    const row = rows[index];
    if (!row) return;
    // An untouched row has nothing to lose: asking about it is noise.
    if (!isUntouched(row)) {
      asking.current = true;
      try {
        const ok = await confirm({
          title: t('past.removeThisPastry'),
          message: t('past.removeRowFrom', { name: row.name.trim() || t('past.thisRow'), day: label }),
          okLabel: t('ui.remove'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        if (!ok || !mounted.current) return;
      } finally {
        asking.current = false;
      }
    }
    // ⚠️ AT LEAST ONE ROW, ALWAYS: removing the last leaves one empty row.
    setRows(current => {
      const next = current.filter(item => item.id !== id);
      return next.length > 0 ? next : [blankRow(nextId())];
    });
    pending.current = { row: index };
    touch();
  }

  // ── Save ──────────────────────────────────────────────────────────────────────────────────

  // The problem that blocks a save, once the person has tried to save (and from then on, as they
  // type, until it is fixed).
  const working = workingItems(rows);
  const found = showErrors ? findInvalidItems(working) : null;
  const count = cleanItems(working).length;

  function showWhatIsWrong(problem: NonNullable<typeof found>) {
    const row = rows[problem.index];
    const field = fieldOf(problem.problem);
    const node = row && field ? inputs.current.get(inputKey(row.id, field)) : undefined;
    if (!node) return;
    node.focus();
    node.scrollIntoView?.({ block: 'center' });
  }

  async function save() {
    if (asking.current) return;
    setShowErrors(true);
    const problem = findInvalidItems(working);
    if (problem) {
      showWhatIsWrong(problem);
      return;
    }

    const clean = cleanItems(working);
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('past.saveDay', { day: label }),
        message: clean.length > 0 ? t('past.saveThese', { n: clean.length, day: label }) : t('past.saveEmpty', { day: label }),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }

    // Saved: nothing is unsaved any more, so leaving asks nothing (the blocker reads the ref).
    dirtyRef.current = false;
    setDirty(false);
    if (copy === null) {
      store.saveDay(day, clean, cleanNote(note));
      say(t('past.daySaved', { day: label }));
      leave();
      return;
    }
    // ⚠️ A COPY GRANTS FIRST, THEN SAVES, and only here: a recorded target the person agreed to
    // change is unlocked by the Save that changes it, never by opening the copy (a copy thrown
    // away would leave the recorded day open all night). Granting first means the day is already
    // open for editing when the save repaints it, as the pencil's route does.
    if (copy.agreed) store.grantEdit(day);
    store.saveDay(day, clean, cleanNote(note));
    say(t('past.daySaved', { day: label }));
    // Land on the day just written, not on the one it was copied from (which Back would show).
    handBackFocus.current = true;
    void navigate(dayPath(day), { replace: true, state: KEEP_FOCUS });
  }

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES, instead of leaving it to the blocker.
  // Its navigate(-1) is a POP, and the router's blocker fails SILENTLY on a POP to an entry the
  // router did not create — a day opened by typing or pasting its address: react-router only warns
  // «This will fail silently in production» — so the edits went without a word. Found by driving
  // it, 11 Oct 2026. Once answered, the editor is clean, so the blocker does not ask again; it
  // still guards every other way out.
  async function back() {
    if (asking.current || askingLeave.current) return;
    if (dirtyRef.current) {
      asking.current = true;
      try {
        const discard = await confirm({
          title: t('past.discardChanges'),
          message: t('past.unsavedFor', { day: label }),
          okLabel: t('ui.discard'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        if (!discard || !mounted.current) return;
      } finally {
        asking.current = false;
      }
      dirtyRef.current = false;
      setDirty(false);
    }
    leave();
  }

  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t('past.editDay', { day: label })}
        titleId={titleId}
        titleRef={title}
        sub={
          // Present from the start and empty, so the words are announced when they arrive.
          <p role="status" className={styles.dirty} data-dirty={dirty}>
            {dirty ? t('past.unsavedChanges') : ''}
          </p>
        }
        action={
          <Button variant="primary" className={styles.save} onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />

      {copy === null ? null : <p role="status" className={styles.copied}>{copiedNotice}</p>}

      {/* The notice for a blocked save. The region is on the page, empty, before there is anything
          to say: a notice inserted already filled in is announced unreliably. It has no height
          until it has something to say (the notice carries its own margins). */}
      <div role="alert">
        {found ? <p className={styles.banner}>{problemMessage(t, found)}</p> : null}
      </div>

      <div className={styles.body}>
        <datalist id={listId}>
          {start.suggestions.map(name => <option key={name} value={name} />)}
        </datalist>

        <div className={styles.head}>
          <p id={kickerId} className={styles.kicker}>{t('past.toProveFor', { day: label })}</p>
          <p className={styles.count}>{t('past.count', { n: count })}</p>
        </div>

        <ul className={styles.rows} aria-labelledby={kickerId}>
          {rows.map((row, index) => {
            const wrong = found !== null && found.index === index ? found : null;
            const wrongField = wrong ? fieldOf(wrong.problem) : null;
            const errorId = `${ids}-error-${row.id}`;
            const name = row.name.trim();
            const describe = (field: EditorField) => (wrongField === field ? errorId : undefined);

            return (
              <li key={row.id} className={styles.row}>
                <div className={styles.line}>
                  <input
                    ref={node => setInput(row.id, 'name', node)}
                    type="text"
                    value={row.name}
                    list={listId}
                    autoComplete="off"
                    maxLength={MAX_NAME_LENGTH}
                    placeholder={t('past.pastryPlaceholder')}
                    aria-label={t('past.pastryName')}
                    aria-invalid={wrongField === 'name' ? true : undefined}
                    aria-describedby={describe('name')}
                    className={`${styles.input} ${styles.name} ${wrongField === 'name' ? styles.isError : ''}`}
                    onChange={event => change(row.id, { name: event.target.value })}
                  />
                  <div className={styles.end}>
                    <input
                      ref={node => setInput(row.id, 'qty', node)}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_QTY}
                      step={1}
                      value={row.qty}
                      placeholder="0"
                      aria-label={name === '' ? t('past.howManyPastries') : t('past.howManyOf', { name })}
                      aria-invalid={wrongField === 'qty' ? true : undefined}
                      aria-describedby={describe('qty')}
                      className={`${styles.input} ${styles.qty} ${wrongField === 'qty' ? styles.isError : ''}`}
                      onChange={event => change(row.id, { qty: event.target.value })}
                    />
                    <Button
                      variant="bare"
                      className={styles.bin}
                      aria-label={t('past.removeRow', { name: name === '' ? t('past.thisRow') : name })}
                      onPress={() => { void remove(row.id); }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <input
                    ref={node => setInput(row.id, 'note', node)}
                    type="text"
                    value={row.note}
                    autoComplete="off"
                    maxLength={MAX_ITEM_NOTE_LENGTH}
                    placeholder={t('past.itemNotePlaceholder')}
                    aria-label={name === '' ? t('past.itemNote') : t('past.itemNoteFor', { name })}
                    className={`${styles.input} ${styles.itemNote}`}
                    onChange={event => change(row.id, { note: event.target.value })}
                  />
                </div>
                {wrong && wrongField ? <p id={errorId} className={styles.err}>{problemMessage(t, wrong)}</p> : null}
              </li>
            );
          })}
        </ul>

        <Button className={styles.add} onPress={add}>
          <Plus aria-hidden="true" />
          {t('past.addPastry')}
        </Button>

        <div className={styles.field}>
          <label htmlFor={noteId} className={styles.label}>{t('past.noteStays', { day: label })}</label>
          <textarea
            id={noteId}
            rows={4}
            maxLength={MAX_NOTE_LENGTH}
            value={note}
            placeholder={t('past.anythingWorthRememberingAbout')}
            className={styles.textarea}
            onChange={event => { setNote(event.target.value); touch(); }}
          />
        </div>
      </div>

      {confirmDialog}
    </section>
  );
}
