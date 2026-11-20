import { useEffect, useId, useRef, useState } from 'react';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { NIGHT_HOURS_CHOICES, REST_MINUTES_CHOICES } from '@mise/shared/kiosk-model';
import { useT } from '../i18n/useT';
import { saveKioskSettings, useKioskSettings } from '../kiosk/kioskSettings';
import type { KioskChange } from '../kiosk/kioskSettings';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useAlert } from '../ui/useAlert';
import styles from './DeviceCard.module.css';

// How long «Saved ✓» stays on the card's title line after a change.
export const SAVED_MS = 2000;

// «This device» (staff slice 5): what is true of THIS tablet or phone, not of a person or a venue — today kiosk mode (a port of
// kioskRows() in js/home-settings.js).
//
// ⚠️ EVERYBODY CAN CHANGE IT (Federico, 7 Oct 2026; D7 of the plan): the lab tablet signs in with an employee account, and it is the
// people at that tablet who must be able to switch kiosk mode on or off. So the card has no role gate.
// ⚠️ STORED IN THIS DEVICE'S localStorage, never in Firestore (kiosk/kioskSettings.ts, the current app's key and shape). A switch or a
// single choice saves on the tap with «Saved ✓» (the settings kit's rule); the two choices and the note appear and vanish in place
// under the switch, so the rows above never move. A write the device refuses says so in a dialog, and the control shows the stored
// value again by itself (it draws what is stored, never what was tapped).
// ⚠️ ONE «Saved ✓», ON THE CARD'S TITLE LINE (the current app measured it, 4 Oct 2026): in a row it covered the longest Italian words
// at 296px, and in the flow it made the row taller for two seconds under a moving finger. Short texts only: the current app's.
export function DeviceCard() {
  const { t } = useT();
  const settings = useKioskSettings();
  const [alert, alertDialog] = useAlert();
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = useId();

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  function store(change: KioskChange): void {
    if (!saveKioskSettings(change)) {
      void alert({ message: t('kiosk.settings.notSaved'), okLabel: t('common.ok') });
      return;
    }
    if (timer.current !== null) clearTimeout(timer.current);
    setSaved(true);
    timer.current = setTimeout(() => { timer.current = null; setSaved(false); }, SAVED_MS);
  }

  return (
    <section className={styles.card} aria-labelledby={`${ids}-head`}>
      <div className={styles.head}>
        <h2 id={`${ids}-head`} className={styles.title}>{t('settings.device')}</h2>
        {/* Present before it speaks (a live region inserted already filled is not announced reliably). */}
        <span role="status" className={styles.saved}>{saved ? t('settings.saved') : ''}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.text}>
          <span id={`${ids}-title`} className={styles.rowTitle}>{t('kiosk.settings.title')}</span>
          <span id={`${ids}-sub`} className={styles.sub}>{t('kiosk.settings.sub')}</span>
        </span>
        <SettingSwitch
          selected={settings.enabled}
          onChange={enabled => { store({ enabled }); }}
          labelledBy={`${ids}-title`}
          describedBy={`${ids}-sub`}
        />
      </div>
      {settings.enabled ? (
        <>
          <Choice
            label={t('kiosk.settings.dimAfter')}
            choices={REST_MINUTES_CHOICES.map(n => ({ value: n, text: t('kiosk.settings.minutes', { n }) }))}
            selected={settings.restMinutes}
            onSelect={restMinutes => { if (restMinutes !== settings.restMinutes) store({ restMinutes }); }}
          />
          <Choice
            label={t('kiosk.settings.offAfter')}
            sub={t('kiosk.settings.offAfter.sub')}
            choices={NIGHT_HOURS_CHOICES.map(n => ({ value: n, text: n === 0 ? t('kiosk.settings.never') : t('kiosk.settings.hours', { n }) }))}
            selected={settings.nightHours}
            onSelect={nightHours => { if (nightHours !== settings.nightHours) store({ nightHours }); }}
          />
          {/* The note tells whoever SETS the tablet up what to do in Android — everybody may. */}
          <p className={styles.note}>{t('kiosk.settings.note')}</p>
        </>
      ) : null}
      {alertDialog}
    </section>
  );
}

type ChoiceProps = {
  label: string;
  sub?: string;
  choices: readonly { value: number; text: string }[];
  selected: number;
  onSelect: (value: number) => void;
};

// One choice among a few buttons side by side, one chosen at all times, arrow keys inside it (React Aria's toggle button group, as
// the label settings' SegmentedChoice). The choices are told apart by their value, never by their words.
function Choice({ label, sub, choices, selected, onSelect }: ChoiceProps) {
  const ids = useId();
  return (
    <div className={styles.block}>
      <p id={`${ids}-label`} className={styles.label}>{label}</p>
      {sub === undefined ? null : <p id={`${ids}-sub`} className={styles.sub}>{sub}</p>}
      <ToggleButtonGroup
        className={styles.segments}
        aria-labelledby={`${ids}-label`}
        aria-describedby={sub === undefined ? undefined : `${ids}-sub`}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[String(selected)]}
        onSelectionChange={keys => {
          const key = [...keys][0];
          const choice = choices.find(c => String(c.value) === key);
          if (choice !== undefined) onSelect(choice.value);
        }}
      >
        {choices.map(choice => (
          <ToggleButton key={choice.value} id={String(choice.value)} className={styles.segment}>{choice.text}</ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}
