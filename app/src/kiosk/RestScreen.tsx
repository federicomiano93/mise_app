import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { workDayDate } from '@mise/shared/kiosk-model';
import { useT } from '../i18n/useT';
import { useOnline } from '../shell/useOnline';
import { armWakeTap } from './wakeTap';
import styles from './RestScreen.module.css';

type Props = {
  // The open venue's name ('' when there is none yet: a page resumed in the night, its session still loading).
  venue: string;
  // The waking tap is reloading the page (nightHours 0 after a long rest): one line says so.
  reloading: boolean;
  // The moment painted: the clock shown. Moves on every tick of the kiosk.
  now: number;
  onWake: (viaKey: boolean) => void;
};

function pad(n: number): string { return String(n).padStart(2, '0'); }
function dayString(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// The kiosk's black rest screen (staff slice 5): what the current app's js/kiosk.js draws, exactly (D9) — top left the time, the
// venue, the date, the work day while it is not today's date (before 04:00), and «No connection» when there is none. The order lines
// in the centre come with slice 6; until then the centre holds only «reloading» after the waking tap.
//
// ⚠️ A SCREEN COVER, NOT A DIALOG: a button that wakes the screen («Tap to continue» is its name), focused as it appears, reachable by
// keyboard. Any key wakes it, any tap wakes it, and neither reaches the page under it (wakeTap.ts, armed while it is up).
// ⚠️ DRAWN ON <body> ABOVE EVERY LAYER OF THE PAGE, dialogs and status messages included (RestScreen.module.css): it is the one black
// screen of the app, and nothing may shine through it in a dark lab.
// Burn-in: the block moves a few pixels when the MINUTE changes, by transform only (a jump, never an animation).
export function RestScreen({ venue, reloading, now, onWake }: Props) {
  const { t, locale } = useT();
  const online = useOnline();
  const cover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = cover.current;
    if (node === null) return undefined;
    try { node.focus({ preventScroll: true }); } catch { /* ignore */ }
    return armWakeTap(window, node, onWake);
  }, [onWake]);

  const date = new Date(now);
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  const day = workDayDate(now);
  const showDay = day !== dayString(date);
  const [y, m, d] = day.split('-').map(Number);
  const workDay = showDay ? t('kiosk.rest.workDay', { date: long.format(new Date(y ?? 0, (m ?? 1) - 1, d ?? 1)) }) : '';
  const shift = Math.floor(now / 60000) % 4;

  return createPortal(
    <div
      ref={cover}
      id="kiosk-rest"
      role="button"
      tabIndex={0}
      aria-label={reloading ? t('kiosk.rest.reloading') : t('kiosk.rest.tap')}
      className={styles.cover}
    >
      <div className={styles.block} data-shift={shift}>
        <div className={styles.corner}>
          <p className={styles.time}>{time}</p>
          {venue === '' ? null : <p className={styles.line}>{venue}</p>}
          <p className={styles.line}>{long.format(date)}</p>
          {showDay ? <p className={styles.line}>{workDay}</p> : null}
          {online ? null : <p className={styles.line}>{t('kiosk.rest.offline')}</p>}
        </div>
        <div className={styles.centre}>
          {reloading ? <p className={styles.sectionTitle}>{t('kiosk.rest.reloading')}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
