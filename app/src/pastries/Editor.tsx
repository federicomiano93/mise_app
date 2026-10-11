import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useBlocker, useLocation } from 'react-router';
import type { BlockerFunction } from 'react-router';
import {
  MAX_NAME_LENGTH, MAX_NOTE_LENGTH, MAX_QTY, cleanItems, cleanNote, findInvalidItems,
} from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { blankRow, fieldOf, isUntouched, namesOnOtherDays, problemMessage, rowsFrom, workingItems } from './editorModel';
import type { EditorField, EditorRow } from './editorModel';
import { usePastries, usePastriesStore } from './PastriesContext';
import { cameFromDay, useLeave } from './pastriesNav';
import { dayPath, weekdayLabel } from './weekdays';
import styles from './Editor.module.css';

type Props = {
  day: Weekday;
  // Set when the person is handed back to the day, so the pencil takes the focus (DayPanel).
  handBackFocus: RefObject<boolean>;
};

// Where to put the focus once the rows have been redrawn: on a new row, or where a removed one was.
type FocusRequest = { readonly row: 'last' } | { readonly row: number };

const inputKey = (id: number, field: EditorField): string => `${id}-${field}`;

// ⚠️ THE EDITOR COPIES THE DAY ONCE AND NEVER REPAINTS, so it must not open before the day is there.
// Opened by its address (a reload, a bookmark) on a phone with nothing stored, the seven days are
// still on their way: a copy taken now would be an EMPTY day, and a Save would write that over the
// real one. It waits for the first answer (store.daysLoaded; a stream that fails counts as an answer,
// so it never waits for ever). Opened from the day, the days are long loaded and this is one render.
export function Editor(props: Props) {
  const { t } = useT();
  const { daysLoaded } = usePastries();
  if (!daysLoaded) {
    return (
      <section className={styles.editor} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return <EditorForm {...props} />;
}

// One day's list, edited (the form; Editor above waits for the day).
//
// ⚠️ EVERYTHING HAPPENS ON A WORKING COPY (P20): nothing touches the stored day until Save is
// pressed and confirmed, and leaving with something typed asks first.
//
// ⚠️ THE EDITOR DOES NOT CHECK THE LOCK. A confirmed day is guarded where the editor is entered
// from (the pencil and the Edit button in DayPanel, through the same `requestEdit` as a row): the
// question belongs next to the tap that causes it. The editor itself only edits what it was given.
//
// ⚠️ A SNAPSHOT FROM ANOTHER PHONE DOES NOT REPAINT IT. It reads the stored day once, when it opens
// (store.getSnapshot(), never usePastries()): replacing the rows would delete what somebody is in
// the middle of typing. The names on the other days are read once too, for the same reason.
function EditorForm({ day, handBackFocus }: Props) {
  const { t } = useT();
  const store = usePastriesStore();
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
    return { rows: rowsFrom(days[day].items, nextId), note: days[day].note, suggestions: namesOnOtherDays(days, day) };
  });
  const [rows, setRows] = useState<EditorRow[]>(start.rows);
  const [note, setNote] = useState(start.note);
  const [showErrors, setShowErrors] = useState(false);

  // ⚠️ DIRTY IS «SOMETHING WAS TOUCHED», as in the current app, and it is also kept in a ref: the
  // router's blocker reads it at the moment of a navigation, and a state value read there could be
  // one render behind.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
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

  const handBack = useCallback(() => { handBackFocus.current = true; }, [handBackFocus]);
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
          current.reset();
        }
      } finally {
        askingLeave.current = false;
      }
    })();
  });

  // ── The rows ──────────────────────────────────────────────────────────────────────────────

  const change = (id: number, patch: { name?: string; qty?: string }) => {
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
    store.saveDay(day, clean, cleanNote(note));
    say(t('past.daySaved', { day: label }));
    leave();
  }

  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
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
