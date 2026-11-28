import { MessageSquarePlus } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useFeedback } from './FeedbackContext';
import styles from './FeedbackButton.module.css';

// The note button of the ONE top bar (from 700px): an icon, named «Nota per Claude», drawn only in a venue that has the switch on.
// On a phone, where the bar is hidden, the same action is a row of the «More» page (`FeedbackRow`).
export function FeedbackButton() {
  const { t } = useT();
  const { available, open } = useFeedback();
  if (!available) return null;
  return (
    <Button variant="bare" className={styles.button} aria-label={t('feedback.title')} onPress={open}>
      <MessageSquarePlus aria-hidden="true" />
    </Button>
  );
}

// The phone's door, a row at the foot of «More» (the one page every phone screen is a tap away from): hidden from 700px, where the bar has it.
export function FeedbackRow() {
  const { t } = useT();
  const { available, open } = useFeedback();
  if (!available) return null;
  return (
    <Button variant="bare" className={styles.row} onPress={open}>
      <MessageSquarePlus aria-hidden="true" />
      <span className={styles.label}>{t('feedback.title')}</span>
    </Button>
  );
}
