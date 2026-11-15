import { useOnline } from '../shell/useOnline';
import { useT } from '../i18n/useT';
import { useOrders } from './OrdersContext';
import { saveStateView } from './saveStateView';
import styles from './SaveStateLine.module.css';

// Whether everything typed on THIS device has reached the server: «Saved ✓» / «Not sent yet» (the current app's PR #551). In the
// Orders head and under a supplier screen's bar, so it is in sight while typing.
//
// ⚠️ A FIXED HEIGHT AND ONE LINE, WHATEVER IT SAYS: the head sticks and the supplier screen's bar sticks, so a line that grew, shrank or
// appeared would move every row under the thumb. Before the first snapshot it is empty but keeps its room.
// ⚠️ ONE VOICE (`quiet`): while a supplier's screen is open beside the list only ITS line speaks — the head's is left empty, or a screen
// reader would hear every change twice. Empty is surer than aria-live="off" on a role="status", which some readers still announce.
// ⚠️ THE LIVE REGION IS THERE FROM THE START and only its text changes: a region inserted already filled is not announced.
export function SaveStateLine({ quiet = false, className }: { quiet?: boolean; className?: string }) {
  const { t } = useT();
  const { draftSaveState } = useOrders();
  const online = useOnline();
  const view = quiet ? { state: '' as const, key: null } : saveStateView(draftSaveState, online);
  return (
    <p
      className={className === undefined ? styles.line : `${styles.line} ${className}`}
      role="status"
      aria-live="polite"
      data-state={view.state}
    >
      {view.key === null ? '' : t(view.key)}
    </p>
  );
}
