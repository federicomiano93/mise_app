import { CalendarOff } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useAway } from '../shell/away/AwayContext';
import { awayDayLabel } from '../shell/away/awayWords';
import { useAskComeBack } from '../shell/away/useAskComeBack';
import { useStatusMessage } from '../ui/StatusMessage';
import styles from './AwayBand.module.css';

// The Home's holiday band, above the «Da fare» card, while this person is away (the current app's js/home-away.js; the owner, 13 Sep 2026:
// «when I am on holiday I see it on the Home»).
//
// ⚠️ A BUTTON, NOT A LINK: tapping it does something HERE (asks «Back already?») rather than going somewhere. It borrows the amber of the
// Orders banners — «to check» — and its words say it as well: the colour is never the only signal.
export function AwayBand() {
  const { t, locale } = useT();
  const away = useAway();
  const say = useStatusMessage();
  const [askComeBack, dialog] = useAskComeBack(() => { say(t('away.saveFailed')); });

  if (!away.away) return null;
  return (
    <>
      <button type="button" className={styles.band} onClick={() => { void askComeBack(); }}>
        <CalendarOff className={styles.icon} aria-hidden="true" />
        <span className={styles.text}>
          <span className={styles.title}>{t('away.onUntil', { day: awayDayLabel(away.until, locale) })}</span>
          <span>{t('away.band.body')}</span>
        </span>
      </button>
      {dialog}
    </>
  );
}
