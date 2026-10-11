import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Check, History, Pencil } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { MAX_QTY } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { editRecordedDayQuestion } from './lockQuestion';
import { usePastries, usePastriesStore } from './PastriesContext';
import { FROM_DAY } from './pastriesNav';
import { PastryRow } from './PastryRow';
import { proposedQuantity, rowKeys, typedKey } from './quantityEdit';
import { PANEL_ID, RECORDS_PATH, editorPath, weekdayLabel } from './weekdays';
import styles from './DayPanel.module.css';

const TITLE_ID = `${PANEL_ID}-title`;

type Props = {
  day: Weekday;
  // The day the section opened on: only it is subtitled «Tomorrow · to prove».
  opening: Weekday;
  // Set by the editor or Records when they hand the person back to the day: the pencil that
  // opened the editor takes the focus, so a keyboard or screen-reader user lands where they left.
  handBackFocus: RefObject<boolean>;
};

// One day's list and the fast way to correct one number. The screen somebody reads standing up at
// 4am, so it stays plain: big names, big numbers, and nothing is a field until a row is tapped.
//
// ⚠️ WHAT THIS PHONE HAS TYPED SURVIVES A SNAPSHOT. The data arrives live from the other phones,
// several times a minute, and a half-typed number must not be eaten by one of them: the typed
// values are kept by day AND pastry name (never by position — a snapshot can reorder the list),
// the open row is kept by the same key, and the rows are keyed by name (and which occurrence of that
// name they are), never by position, so React updates them in place — the scroll position and the
// focus in the box survive too, even when another phone removes a row ABOVE the one being typed in.
// (The current app's update() has to put the focus back by hand because it rebuilds every row. Here
// nothing is rebuilt: an element React only has to MOVE, for a reordered list, gets its focus back
// from React itself when the commit is done — it remembers the focused element before and restores
// it after. A row that is REMOVED and built again is what loses it, which is what the keys prevent.)
//
// ⚠️ UNTIL THE DAYS HAVE ANSWERED, THE LIST IS ONLY THIS PHONE'S OLD COPY (it can be days old): it
// is drawn, so the first paint is instant, but nothing may be WRITTEN from it. A tick on a stale
// row would write a list that other phones have long since changed, and Confirm would record it as
// tonight's. So until the first live answer (store.daysLoaded — the device's own cache counts, so
// working offline is untouched) a row ignores a tap and Confirm is disabled.
export function DayPanel({ day, opening, handBackFocus }: Props) {
  const { t } = useT();
  const store = usePastriesStore();
  const { days, daysLoaded } = usePastries();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();

  const { items, note } = days[day];
  const reactKeys = rowKeys(day, items.map(item => item.name));
  const label = weekdayLabel(t, day);
  // Read from the clock every time (store.isLocked): the lock releases itself at 4am.
  const locked = store.isLocked(day);

  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const confirming = useRef(false);
  // The day this panel shows NOW, for an answer that arrives after the person has moved on.
  const shownDay = useRef(day);
  // A swap of the two bottom buttons this phone asked for and is waiting to see (see below).
  const swapFocus = useRef<{ day: Weekday; to: 'edit' | 'confirm' } | null>(null);
  useEffect(() => {
    shownDay.current = day;
    swapFocus.current = null;
  }, [day]);

  // ⚠️ A ROW THAT IS GONE CANNOT STAY OPEN, and neither can any row once the day is confirmed —
  // here or on a colleague's phone: a box left open over a locked list would accept a number and
  // then refuse to keep it. Closing is derived while drawing, not in an effect, so the stale box
  // is never on screen for a frame.
  if (openKey !== null && (locked || !items.some(item => typedKey(day, item.name) === openKey))) {
    setOpenKey(null);
  }

  // Back from the editor or Records: the pencil takes the focus (once).
  useEffect(() => {
    if (!handBackFocus.current) return;
    handBackFocus.current = false;
    pencil.current?.focus();
  }, [handBackFocus]);

  // The box takes the focus when its row opens.
  useEffect(() => {
    if (openKey !== null) openInput.current?.focus();
  }, [openKey]);

  // ⚠️ THE BUTTON THAT WAS PRESSED HIDES ITSELF, with the focus on it: Confirm when the record has
  // landed (the «Confirmed» row takes its place), Edit when the day unlocks (Confirm comes back).
  // A hidden element cannot keep the focus, so it would fall to <body> — a keyboard user is lost and
  // a screen reader says nothing. The focus goes to the control that takes the button's place.
  //
  // Asked for by the press that causes the swap (swapFocus), done when the swap is on the page: a
  // colleague's Confirm sets nothing, so it never moves anybody's focus. And only when the focus is
  // still on the button that goes, or nowhere (while a question closes, the focus is on <body> until
  // the dialog's own restore runs a frame later): somebody who has moved on keeps the focus where
  // they put it.
  useLayoutEffect(() => {
    const want = swapFocus.current;
    if (!want || want.day !== day) return;
    if (want.to === 'edit' ? !locked : locked) return;
    swapFocus.current = null;
    const arriving = want.to === 'edit' ? editButton.current : confirmButton.current;
    const leaving = want.to === 'edit' ? confirmButton.current : editButton.current;
    const active = document.activeElement;
    if (active === null || active === document.body || active === leaving) arriving?.focus();
  });

  // A number typed and not yet written is an unsaved edit: a reload the app starts by itself
  // waits until it is written or dropped (session/busy.ts).
  const typing = openKey !== null && (typed[openKey] ?? '').trim() !== '';
  useEffect(() => (typing ? markBusy() : undefined), [typing]);

  // ⚠️ THE ONE GATE, whichever way a confirmed list is reached: a row, the pencil, or the Edit
  // button. A locked row does not silently ignore the tap — that would read as a broken screen —
  // it asks. An unlocked day passes straight through: the gate exists to catch a change to
  // something already recorded, not to make every edit slower.
  async function requestEdit(): Promise<boolean> {
    if (!store.isLocked(day)) return true;
    const ok = await confirm(editRecordedDayQuestion(t, label));
    if (!ok) return false;
    // The permission carries tonight's work date, so 4am spends it — and so does the next Confirm.
    store.grantEdit(day);
    return true;
  }

  // The Edit button of a confirmed day: the same question, then only unlocks the list.
  async function pressEdit() {
    swapFocus.current = { day, to: 'confirm' };
    if (!(await requestEdit())) swapFocus.current = null;
  }

  async function pressRow(key: string) {
    if (!store.isLocked(day)) {
      setOpenKey(current => (current === key ? null : key));
      return;
    }
    // Said yes: open the row that was tapped, rather than making them find it again.
    if ((await requestEdit()) && shownDay.current === day) setOpenKey(key);
  }

  // The pencil opens the full editor, which can rewrite the whole list — so it goes through the
  // SAME gate as a row. Left open, the lock would be cosmetic.
  async function pressPencil() {
    if (!(await requestEdit()) || shownDay.current !== day) return;
    void navigate(editorPath(day), { state: FROM_DAY });
  }

  function commit(index: number, key: string) {
    const item = items[index];
    if (!item) return;
    const n = proposedQuantity(typed[key]);
    if (n === null || n <= 0 || n > MAX_QTY || n === item.qty) return;
    // The STORE composes the payload from the list as it is now and refuses if the row has moved
    // since it was drawn.
    const ok = store.setItemQuantity(day, index, item.name, n);
    setTyped(current => {
      const { [key]: _dropped, ...rest } = current;
      return rest;
    });
    setOpenKey(null);
    say(ok ? t('past.quantitySet', { name: item.name, qty: String(n) }) : t('past.thatRowHasChanged'));
  }

  // Keeping tonight's list as a record asks first, because it writes something permanent — unlike
  // the tick on a row, which changes a number that can be changed straight back.
  async function confirmToday() {
    // The dialog takes time to read, and taps keep arriving.
    if (confirming.current) return;
    confirming.current = true;
    try {
      // One read, only here: it lets the question say «will be replaced» truthfully. null when it
      // cannot be established — then nothing is promised.
      const existing = await store.tonightsRecord(day);
      const base = items.length > 0
        ? t('past.keepAsRecord', { day: label })
        : t('past.nothingToProveRecord', { day: label });
      const ok = await confirm({
        title: t('past.confirmDay', { day: label }),
        message: [
          base,
          existing ? t('past.tonightsRecordReplaced', { day: label }) : t('past.willShowAsDone', { day: label }),
        ],
        okLabel: t('past.confirm'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
      // Landing locks the day, which swaps the buttons: ask for the focus to follow (see above).
      swapFocus.current = { day, to: 'edit' };
      const saved = await store.confirmDay(day, items, note);
      if (!saved) {
        swapFocus.current = null;
        return;
      }
      announceAction('pastry-day-confirmed');
      say(t('past.dayRecorded', { day: label }));
    } finally {
      confirming.current = false;
    }
  }

  return (
    // Named by its own heading: the tab's name is a whole sentence («Tuesday 2 pastries Tomorrow»).
    <section role="tabpanel" id={PANEL_ID} aria-labelledby={TITLE_ID} className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 id={TITLE_ID} className={styles.title}>{label}</h2>
          <p className={styles.meta}>{day === opening ? t('past.tomorrowToProve') : t('past.toProve')}</p>
        </div>
        <Button
          ref={pencil}
          variant="bare"
          className={styles.pencil}
          aria-label={t('past.editDay', { day: label })}
          onPress={() => { void pressPencil(); }}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </header>

      <div className={styles.body}>
        {items.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{t('past.nothingToProveFor', { day: label })}</p>
            <p className={styles.emptyHint}>{t('past.tapThePencilTo')}</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {items.map((item, index) => {
              const key = typedKey(day, item.name);
              const open = openKey === key;
              return (
                <PastryRow
                  key={reactKeys[index]}
                  item={item}
                  open={open}
                  disabled={!daysLoaded}
                  typed={typed[key] ?? ''}
                  inputRef={open ? openInput : undefined}
                  onToggle={() => { void pressRow(key); }}
                  onType={value => setTyped(current => ({ ...current, [key]: value }))}
                  onCommit={() => commit(index, key)}
                />
              );
            })}
          </ul>
        )}

        {note === '' ? null : (
          <div className={styles.note}>
            <p className={styles.noteLabel}>{t('ui.note')}</p>
            <p className={styles.noteText}>{note}</p>
          </div>
        )}
      </div>

      {/* ⚠️ THE BOTTOM ROW STICKS TO THE BOTTOM OF THE SCREEN, at every width: a long list must
          never push Confirm off a tablet that stands on a bench (1024 x 768). Records stays in the
          flow after it, at the end of the panel. */}
      <div className={styles.bar}>
        {/* ⚠️ BOTH ARE ALWAYS BUILT and one is hidden, never one built only when the day is
            confirmed: the data changes live, and a control built conditionally would appear and
            vanish at random as other phones wrote. */}
        <Button
          ref={confirmButton}
          variant="primary"
          block
          hidden={locked}
          isDisabled={!daysLoaded}
          onPress={() => { void confirmToday(); }}
        >
          {t('past.confirm')}
        </Button>
        <div className={styles.done} hidden={!locked}>
          <span className={styles.doneMark}>
            <Check aria-hidden="true" />
            {t('past.confirmedMark')}
          </span>
          <Button ref={editButton} onPress={() => { void pressEdit(); }}>
            <Pencil aria-hidden="true" />
            {t('ui.edit')}
          </Button>
        </div>
      </div>
      <div className={styles.foot}>
        <Link to={RECORDS_PATH} state={FROM_DAY} className={styles.records}>
          <History aria-hidden="true" />
          {t('past.records')}
        </Link>
      </div>

      {confirmDialog}
    </section>
  );
}
