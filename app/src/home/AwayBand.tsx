import { CalendarOff } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useAway } from '../shell/away/AwayContext';
import { awayDayLabel } from '../shell/away/awayWords';
import { useAskComeBack } from '../shell/away/useAskComeBack';
import styles from './AwayBand.module.css';

// The Home's holiday band, above the «Da fare» card, while this person is away (the current app's js/home-away.js; the owner, 13 Sep 2026:
// «when I am on holiday I see it on the Home»).
//
// ⚠️ A BUTTON, NOT A LINK: tapping it does something HERE (asks «Back already?») rather than going somewhere. It borrows the amber of the
// Orders banners — «to check» — and its words say it as well: the colour is never the only signal.
//
// `onBack`: called as the person answers «I am back» (the Home's useFocusOnBack arm, so the focus lands on the card's Add).
export function AwayBand({ onBack }: { onBack?: () => void }) {
  const { t, locale } = useT();
  const away = useAway();
  const [askComeBack, dialog] = useAskComeBack(onBack);

  // The question is drawn whatever the holiday: if it ends while «Back already?» is open, useAskComeBack closes the question itself.
  if (!away.away) return <>{dialog}</>;
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
