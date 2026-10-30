import type { Ref } from 'react';
import { Bell } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useNotices } from './NoticesContext';
import styles from './NoticesBell.module.css';

// The bell in the list's head (step 3f-6, parity R3, R11): ALWAYS there, so nobody has to find a button that comes and goes; only
// the small number on it comes and goes. It opens the panel under the head, which is NOT a dialog: the list stays usable.
//
// The number is read aloud with the button («Notices: 2») and drawn `aria-hidden`, like the badges of the delivery doors.
export function NoticesBell({ ref }: { ref?: Ref<HTMLButtonElement> }) {
  const { t } = useT();
  const { open, setOpen, panelId, count } = useNotices();
  return (
    <Button
      ref={ref}
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
