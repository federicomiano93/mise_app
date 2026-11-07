import { useId, useState } from 'react';
import { maxAwayDate, toISODate } from '@mise/shared/away-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAway, useAwayStore } from './AwayContext';
import { awayDayLabel } from './awayWords';
import { SettingsRow } from './SettingsRow';
import { useAskComeBack } from './useAskComeBack';
import styles from './AwayRow.module.css';

// «I am on holiday» — the row in Settings' «You» card, for everybody. Not away: a row that opens the date dialog. Away: the same row in
// amber, saying until when, and tapping it asks «Back already?».
export function AwayRow() {
  const { t, locale } = useT();
  const away = useAway();
  const say = useStatusMessage();
  const [asking, setAsking] = useState(false);
  const [askComeBack, backDialog] = useAskComeBack(() => { say(t('away.saveFailed')); });

  return (
    <>
      {away.away ? (
        <SettingsRow
          warn
          title={t('away.onUntil', { day: awayDayLabel(away.until, locale) })}
          sub={t('away.band.body')}
          onPress={() => { void askComeBack(); }}
        />
      ) : (
        <SettingsRow title={t('away.title')} sub={t('settings.away.sub')} onPress={() => { setAsking(true); }} />
      )}
      {asking ? <UntilDialog onClose={() => { setAsking(false); }} /> : null}
      {backDialog}
    </>
  );
}

// The dialog: one date, and a way back from it.
//
// ⚠️ IT SAYS WHAT BEING AWAY DOES AND WHAT IT DOES NOT. «Your phone stops ringing; the lists still arrive and are still waiting for you.»
// Without that line somebody reasonably assumes the work is being handled by somebody else, which is the one belief this feature must
// never create.
//
// ⚠️ THE DATE PICKER IS THE PLATFORM'S OWN (`<input type="date">`), on purpose (P19): a hand-rolled calendar is notoriously fragile, and
// the phone's own picker is the one every person already knows, with its language and its idea of which day a week starts on. The ceiling
// is a property of the CONTROL (`max`), not an error afterwards.
function UntilDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const store = useAwayStore();
  const say = useStatusMessage();
  const inputId = useId();
  const [value, setValue] = useState('');
  // Said inside the dialog, in a live region that is there (empty) before it speaks.
  const [problem, setProblem] = useState(false);
  const [bounds] = useState(() => ({ min: toISODate(Date.now()), max: maxAwayDate(Date.now()) }));

  function set(): void {
    // An empty box is not a date: the store would take '' as «I am back», which is not what Set means.
    const change = value === '' ? null : store.set(value);
    if (!change?.accepted) {
      setProblem(true);
      return;
    }
    void change.saved.then(saved => { if (!saved) say(t('away.saveFailed')); });
    onClose();
  }

  return (
    <Dialog
      isOpen
      title={t('away.title')}
      message={t('away.whatItDoes')}
      onClose={onClose}
      actions={
        <>
          <Button key="cancel" onPress={onClose}>{t('common.cancel')}</Button>
          <Button key="set" variant="primary" onPress={set}>{t('away.set')}</Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>{t('away.untilLabel')}</label>
        <input
          id={inputId}
          type="date"
          className={styles.date}
          min={bounds.min}
          max={bounds.max}
          value={value}
          onChange={event => { setValue(event.target.value); setProblem(false); }}
        />
        <p role="status" className={styles.problem}>{problem ? t('away.badDate') : ''}</p>
      </div>
    </Dialog>
  );
}
