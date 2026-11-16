import { saveStateView } from '@mise/shared/save-state';
import { useT } from '../i18n/useT';
import { useOnline } from '../shell/useOnline';
import { useOrders } from './OrdersContext';
import styles from './SaveStateLine.module.css';

type Props = {
  // Another line is speaking for the same draft (a supplier's screen open beside the list): this one keeps its room and says
  // nothing, and is no live region, so a screen reader hears ONE voice.
  silent?: boolean;
  // Drawn under a supplier screen's bar rather than in the list's head (a little room above it).
  inBar?: boolean;
};

// «Saved ✓» / «Not sent yet»: whether everything typed on THIS device has reached the server (the iPad order of 14 Nov 2026, where
// the last number typed never left the tablet and no screen said so). The words come from saveStateView; the device being offline
// counts as not sent.
//
// ⚠️ THE LINE IS ALWAYS THERE, AT ONE FIXED HEIGHT: it appears with the first snapshot and changes its words with every save, and
// anything that moved the rows at that moment would move them under a finger. ⚠️ THE LIVE REGION IS RENDERED EMPTY and only its text
// comes and goes (StatusMessage.tsx): one inserted already filled in is not announced by VoiceOver.
export function SaveStateLine({ silent = false, inBar = false }: Props) {
  const { t } = useT();
  const { saveState } = useOrders();
  const online = useOnline();
  const view = silent ? { state: '', key: '' } as const : saveStateView(saveState, online);
  return (
    <p
      className={inBar ? `${styles.line} ${styles.inBar}` : styles.line}
      data-state={view.state}
      role={silent ? undefined : 'status'}
      aria-live={silent ? undefined : 'polite'}
    >
      {view.key === '' ? null : t(view.key)}
    </p>
  );
}
