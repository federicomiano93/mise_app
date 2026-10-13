import { useId, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useAlert } from '../ui/useAlert';
import { useClientOrders, useClientOrdersStore } from './CalculatorContext';
import { isAcceptableCutoff } from './clientOrdersModel';
import { SETTINGS_PATH } from './calculatorPath';
import { SettingsEditor } from './SettingsEditor';
import { SettingsPage } from './SettingsPage';
import { Empty, Help } from './SettingsParts';
import styles from './ClientOrdering.module.css';

// Client ordering: when the orders a client sends from their own link close (a port of `renderCutoffSettings` in
// js/calculator-client-orders.js). A form like the other editors of Settings: a working copy, Save disabled until it
// differs, the question, the discard question on every way out.
//
// ⚠️ IT COPIES THE DEADLINE ONLY ONCE THE SERVER HAS ANSWERED (`cutoffFromServer`): the browser's own database answers
// at once with whatever this phone last saw, and an editor opened on yesterday's deadline would save it back over a
// change another phone made since. Until then it says «Loading…», like the editors of the configuration.
export function CutoffEditor() {
  const { t } = useT();
  const { cutoffFromServer } = useClientOrders();
  if (cutoffFromServer) return <CutoffForm />;
  return (
    <SettingsPage title={t('ui.clientOrdering')} fallback={SETTINGS_PATH}>
      <Empty>{t('calc.loading')}</Empty>
    </SettingsPage>
  );
}

function CutoffForm() {
  const { t } = useT();
  const store = useClientOrdersStore();
  const { cutoff } = useClientOrders();
  const [alert, alertDialog] = useAlert();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  // '' is a real answer: no deadline. The copy is made ONCE, when the editor opens.
  const [opening] = useState(cutoff);
  const [value, setValue] = useState(opening);

  return (
    <SettingsEditor
      title={t('ui.clientOrdering')}
      fallback={SETTINGS_PATH}
      dirty={value !== opening}
      // ⚠️ The deadline is handed to the browser's own database and the screen moves on (P20); a refusal that arrives
      // later is said by the Calculator itself (the store's message), with the old deadline back on screen.
      commit={() => {
        store.saveCutoff(value);
        return true;
      }}
      saveQuestion={value === '' ? t('calc.removeTheDeadlineClients') : t('calc.co.closeOrdersAt', { time: value })}
      beforeSave={() => {
        if (isAcceptableCutoff(value)) return true;
        void alert({ message: t('calc.thatIsNotA'), okLabel: t('common.ok') });
        return false;
      }}
    >
      <Help>{t('calc.cutoff.help')}</Help>
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>{t('calc.ordersCloseAt')}</label>
        <input
          ref={input}
          id={inputId}
          type="time"
          className={styles.input}
          value={value}
          onChange={event => { setValue(event.target.value); }}
        />
        <p className={styles.hint}>{t('calc.cutoff.empty')}</p>
        <Button
          variant="quiet"
          className={styles.clear}
          isDisabled={value === ''}
          onPress={() => {
            setValue('');
            input.current?.focus();
          }}
        >
          {t('calc.noDeadline')}
        </Button>
      </div>
      {alertDialog}
    </SettingsEditor>
  );
}
