import { Bell } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useNotices } from './NoticesContext';
import styles from './NoticesBell.module.css';

// The bell on the page's title line (step 3f-6, parity R3, R11): ALWAYS there, so nobody has to find a button that comes and goes; only
// the small number on it comes and goes. It opens the panel at the top of the list, which is NOT a dialog: the list stays usable.
//
// ⚠️ ON THE TITLE LINE, NOT IN THE LIST'S HEAD: beside the search box, the send arrow and the gear it pushed the gear onto a line of
// its own and cut the search box short on a 360px phone; the title line has the room at every width.
//
// The number is read aloud with the button («Notices: 2») and drawn `aria-hidden`, like the badges of the delivery doors.
export function NoticesBell() {
  const { t } = useT();
  const { open, setOpen, panelId, bellRef, count } = useNotices();
  return (
    <Button
      ref={bellRef}
      variant="bare"
      className={styles.bell}
      aria-label={count > 0 ? t('ord.notices.bellCount', { n: count }) : t('ord.notices.title')}
      aria-expanded={open}
      aria-controls={panelId}
      onPress={() => { setOpen(!open); }}
    >
      <Bell aria-hidden="true" />
      {count > 0 ? <span className={styles.badge} aria-hidden="true">{count}</span> : null}
    </Button>
  );
}
