import { useEffect, useId, useRef, useState } from 'react';
import { maxAwayDate, toISODate } from '@mise/shared/away-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useAway, useAwayStore } from '../shell/away/AwayContext';
import { awayDayLabel } from '../shell/away/awayWords';
import { SettingsRow } from './SettingsRow';
import { useAskComeBack } from '../shell/away/useAskComeBack';
import { useFocusOnBack } from '../shell/away/useFocusOnBack';
import styles from './AwayRow.module.css';

// «I am on holiday» — the row in Settings' «You» card, for everybody. Not away: a row that opens the date dialog. Away: the same row in
// amber, saying until when, and tapping it asks «Back already?».
export function AwayRow() {
  const { t, locale } = useT();
  const away = useAway();
  const [asking, setAsking] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  // After «I am back» the row becomes «I am on holiday» again: the focus goes to it.
  const armFocus = useFocusOnBack(() => row.current);
  const [askComeBack, backDialog] = useAskComeBack(armFocus);

  return (
    <>
      {away.away ? (
        <SettingsRow
          ref={row}
          warn
          title={t('away.onUntil', { day: awayDayLabel(away.until, locale) })}
          sub={t('away.band.body')}
          onPress={() => { void askComeBack(); }}
        />
      ) : (
        // ⚠️ NOT PRESSABLE UNTIL THE ONE READ HAS ANSWERED (the current app draws its button only after readMyAway): somebody who IS away
        // would otherwise see «I am on holiday» and could set a day over their real one, before the row turns amber under their finger.
        <SettingsRow
          ref={row}
          title={t('away.title')}
          sub={t('settings.away.sub')}
          disabled={away.status === 'loading'}
          onPress={() => { setAsking(true); }}
        />
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
  const inputId = useId();
  const [value, setValue] = useState('');
  // Said inside the dialog, in a live region that is there (empty) before it speaks.
  const [problem, setProblem] = useState(false);
  const [bounds] = useState(() => ({ min: toISODate(Date.now()), max: maxAwayDate(Date.now()) }));
  // A day picked and not yet set is typing: a self-started reload (session/busy.ts) waits for it.
  const typed = value !== '';
  useEffect(() => (typed ? markBusy() : undefined), [typed]);

  function set(): void {
    // An empty box is not a date: the store would take '' as «I am back», which is not what Set means.
    const change = value === '' ? null : store.set(value);
    if (!change?.accepted) {
      setProblem(true);
      return;
    }
    // A refusal is said by the shell (AwayRefusalAlert), wherever the person is when it arrives.
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
