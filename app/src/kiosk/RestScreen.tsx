import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { KioskSection } from '@mise/shared/kiosk-lines';
import { wakeArmDelay, workDayDate } from '@mise/shared/kiosk-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useOnline } from '../shell/useOnline';
import type { RestTodos } from './restTodos';
import { armWakeTap } from './wakeTap';
import styles from './RestScreen.module.css';

type Props = {
  // The open venue's name ('' when there is none yet: a page resumed in the night, its session still loading).
  venue: string;
  // The waking tap is reloading the page (nightHours 0 after a long rest): one line says so.
  reloading: boolean;
  // The moment painted: the clock shown. Moves on every tick of the kiosk.
  now: number;
  // What to order and what arrives today (staff slice 6), only for somebody who may see Orders: a title key and supplier names each.
  sections: readonly KioskSection[];
  // The to-dos not done whose day has come (restTodos.ts), for every role: the left half, or alone in the centre.
  todos: RestTodos;
  // Not before this moment is the waking tap armed (the Home's «Standby» raised it: its own tap must not wake it). 0: at once.
  armAt: number;
  onWake: (viaKey: boolean) => void;
};

function pad(n: number): string { return String(n).padStart(2, '0'); }
function dayString(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// The kiosk's black rest screen (staff slices 5 and 6): what the current app's js/kiosk.js draws, exactly (D9) — top left the time, the
// venue, the date, the work day while it is not today's date (before 04:00), and «No connection» when there is none; in the centre,
// large, two halves side by side — «To do today» on the left (up to four to-dos, «+N» for the rest, an overdue one with «overdue» under
// it) and «To order today» over «Arriving today» on the right (up to four supplier names each; Kiosk.tsx decides who sees them) — or
// the one half there is, centred, or the one «reloading» line after the waking tap. On a phone the halves stack, the to-dos on top.
//
// ⚠️ A SCREEN COVER, NOT A DIALOG: a button that wakes the screen («Tap to continue» is its name), focused as it appears, reachable by
// keyboard. Any key wakes it, any tap wakes it, and neither reaches the page under it (wakeTap.ts, armed while it is up).
// ⚠️ DRAWN ON <body> ABOVE EVERY LAYER OF THE PAGE, dialogs and status messages included (RestScreen.module.css): it is the one black
// screen of the app, and nothing may shine through it in a dark lab.
// Burn-in: the block moves a few pixels when the MINUTE changes, by transform only (a jump, never an animation).
export function RestScreen({ venue, reloading, now, sections, todos, armAt, onWake }: Props) {
  const { t, locale } = useT();
  const online = useOnline();
  const cover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = cover.current;
    if (node === null) return undefined;
    try { node.focus({ preventScroll: true }); } catch { /* ignore */ }
    // Raised by the Home's «Standby»: the tap (or the key's repeat) that did it must not wake the cover (REST_NOW_GUARD_MS).
    const delay = wakeArmDelay(armAt, Date.now());
    if (delay === 0) return armWakeTap(window, node, onWake);
    let disarm: (() => void) | null = null;
    const timer = setTimeout(() => { disarm = armWakeTap(window, node, onWake); }, delay);
    return () => { clearTimeout(timer); disarm?.(); };
  }, [onWake, armAt]);

  const date = new Date(now);
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  const day = workDayDate(now);
  const showDay = day !== dayString(date);
  const [y, m, d] = day.split('-').map(Number);
  const workDay = showDay ? t('kiosk.rest.workDay', { date: long.format(new Date(y ?? 0, (m ?? 1) - 1, d ?? 1)) }) : '';
  const hasTodos = todos.items.length > 0;
  const hasOrders = sections.length > 0;
  const halves = !reloading && hasTodos && hasOrders;
  const shift = Math.floor(now / 60000) % 4;

  function todoSection() {
    if (todos.items.length === 0) return null;
    return (
      <section className={styles.section}>
        <p className={styles.sectionTitle}>{t('kiosk.rest.todoTitle')}</p>
        <ul className={styles.names}>
          {todos.items.map((item, index) => (
            <li key={index}>
              <span className={styles.todoText}>{item.text}</span>
              {item.late ? (
                <span className={styles.late}><span className="visually-hidden">, </span>{t('kiosk.rest.late')}</span>
              ) : null}
            </li>
          ))}
          {todos.more > 0 ? <li>{`+${todos.more}`}</li> : null}
        </ul>
      </section>
    );
  }

  function orderSections() {
    return sections.map(section => (
      <section key={section.titleKey} className={styles.section}>
        <p className={styles.sectionTitle}>{t(section.titleKey as MessageKey)}</p>
        <ul className={styles.names}>
          {section.names.map((name, index) => <li key={index}>{name}</li>)}
          {section.more > 0 ? <li>{`+${section.more}`}</li> : null}
        </ul>
      </section>
    ));
  }

  return createPortal(
    <div
      ref={cover}
      id="kiosk-rest"
      role="button"
      tabIndex={0}
      aria-label={reloading ? t('kiosk.rest.reloading') : t('kiosk.rest.tap')}
      className={styles.cover}
      // ⚠️ A TOP LAYER FOR REACT ARIA (code review): a dialog that opens while the tablet rests makes everything outside it `inert`
      // (useModalOverlay → ariaHideOutside, Chrome 102 and later), the cover included — and an inert cover lets the waking tap fall
      // through onto the hidden dialog's buttons, answering a question nobody saw. Marked so, the cover is left alone and keeps
      // swallowing the tap. (The lab tablet's Chrome 101 has no `inert`; React Aria falls back to aria-hidden there.)
      data-react-aria-top-layer=""
    >
      <div className={styles.block} data-shift={shift}>
        <div className={styles.corner}>
          <p className={styles.time}>{time}</p>
          {venue === '' ? null : <p className={styles.line}>{venue}</p>}
          <p className={styles.line}>{long.format(date)}</p>
          {showDay ? <p className={styles.line}>{workDay}</p> : null}
          {online ? null : <p className={styles.line}>{t('kiosk.rest.offline')}</p>}
        </div>
        {halves ? (
          <div className={styles.halves}>
            <div className={styles.half}>{todoSection()}</div>
            <div className={styles.divider} aria-hidden="true" />
            <div className={styles.half}>{orderSections()}</div>
          </div>
        ) : (
          <div className={styles.centre}>
            {reloading ? <p className={styles.sectionTitle}>{t('kiosk.rest.reloading')}</p> : (
              <>
                {hasTodos ? todoSection() : null}
                {orderSections()}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
