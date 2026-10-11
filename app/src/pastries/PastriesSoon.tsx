import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import type { Weekday } from '@mise/shared/pastries-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { PASTRIES_PATH, dayPath, weekdayLabel } from './weekdays';
import styles from './PastriesSoon.module.css';

// The editor and Records arrive in the next slice of step 3a. Until then their addresses lead
// here: a plain card that says so and a way back, so the day's pencil and its Records link are
// real links to real routes already.
function Soon({ title, body, backTo }: { title: string; body: string; backTo: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { key } = useLocation();

  // Back steps up one level without losing where the person came from. A screen opened by its
  // address (no history behind it) has nothing to step back to, so it goes to `backTo`.
  const back = () => {
    if (key !== 'default') void navigate(-1);
    else void navigate(backTo, { replace: true });
  };

  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>
      <div className={styles.actions}>
        <Button onPress={back}>
          <ArrowLeft aria-hidden="true" />
          {t('ui.back')}
        </Button>
      </div>
    </section>
  );
}

export function EditorSoon({ day }: { day: Weekday }) {
  const { t } = useT();
  const label = weekdayLabel(t, day);
  return <Soon title={t('past.editDay', { day: label })} body={t('past.editorSoon', { day: label })} backTo={dayPath(day)} />;
}

export function RecordsSoon() {
  const { t } = useT();
  return <Soon title={t('past.records')} body={t('past.recordsSoon')} backTo={PASTRIES_PATH} />;
}
