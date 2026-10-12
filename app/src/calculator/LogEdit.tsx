import { useId, useState } from 'react';
import { Navigate } from 'react-router';
import { latestVersion } from '@mise/shared/log-model';
import type { Log } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { announceAction } from '../telemetry/usage';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { logViewPath } from './calculatorPath';
import { LogTotalField, LogTraysField } from './LogAmountFields';
import { LogMissing } from './LogMissing';
import { LogQtyRows } from './LogQtyRows';
import { buildEditedVersion, editStart, editsTrays } from './logVersions';
import type { EditStart } from './logVersions';
import { SettingsEditor } from './SettingsEditor';
import { useLog } from './useLog';
import styles from './LogEditor.module.css';

// «Edit dough»: a new version of a log made BY HAND, from its own screen. A log the Calculator made has no edit screen
// (it is edited from the work view: Edit, then Confirm), so its address goes to the log.
//
// Nothing asks before this opens (the current app asked «Edit this dough?» first): it works on a copy, writes nothing
// until Save, and asks before it is left with edits.
export function LogEdit({ id }: { id: string }) {
  const lookup = useLog(id);
  const { configAnswered, configFailed } = useCalculator();
  // The copy is taken from the configuration as it is once the settings have answered: before that the products a
  // log may gain, and the recipe it is matched to, would be missing.
  if (lookup.status !== 'found') return <LogMissing lookup={lookup} />;
  if (!configAnswered && !configFailed) return <LogMissing lookup={{ status: 'loading' }} />;
  if (lookup.log.origin !== 'manual') return <Navigate to={logViewPath(id)} replace state={KEEP_FOCUS} />;
  return <LogEditForm key={id} log={lookup.log} />;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// What the person can change, as one string: the copy is dirty when it differs from the one it started as.
const editable = (working: EditStart): string =>
  JSON.stringify([working.calculatedBy, working.trays, working.typedTotal, working.rows.map(row => num(row.qty))]);

function LogEditForm({ log }: { log: Log }) {
  const { t } = useT();
  const store = useCalculatorStore();
  const uid = useId();
  // ⚠️ THE COPY IS TAKEN ONCE, when the log is first on screen, and never again: the log may change under the screen
  // (another phone), and a copy re-taken then would swallow what is being typed. A log that goes away is said by
  // LogEdit (this form is unmounted); one that changes is read again at Save, for the version it adds to.
  const [started] = useState(() => editStart(store.getSnapshot().config, log));
  const [working, setWorking] = useState<EditStart>(started);

  const commit = (): boolean => {
    const latest = store.getSnapshot();
    const current = latest.logs.find(known => known.id === log.id);
    if (!current) return false;
    const version = buildEditedVersion({
      config: latest.config,
      working,
      previous: latestVersion(current),
      // Read NOW, at save time: the words are written into the document in the language of this moment.
      words: { occasionalClient: t('calc.logOccasionalClient'), extraDough: t('calc.logExtraDough') },
      nowMs: Date.now(),
    });
    // 'full': the store has said why and the screen stays as it is. 'missing': the log is gone, LogEdit says so.
    if (store.editLog(log.id, version) !== 'saved') return false;
    announceAction('log-edited');
    return true;
  };

  const trays = editsTrays(working.recipe);
  const setQty = (index: number, qty: number) => {
    setWorking(before => ({ ...before, rows: before.rows.map((row, at) => (at === index ? { ...row, qty } : row)) }));
  };

  return (
    <SettingsEditor
      title={t('ui.edit')}
      fallback={logViewPath(log.id)}
      dirty={editable(working) !== editable(started)}
      saveQuestion={t('calc.saveTheseChangesAs')}
      commit={commit}
    >
      <div className={styles.form}>
        <h3 className={styles.dough}>{log.dough}</h3>
        <div className={styles.field}>
          <label htmlFor={`${uid}-by`} className={styles.label}>{t('calc.calculatedBy2')}</label>
          <input
            id={`${uid}-by`}
            type="text"
            className={styles.text}
            value={working.calculatedBy}
            placeholder={t('calc.nameOptional')}
            autoComplete="off"
            onChange={event => { setWorking(before => ({ ...before, calculatedBy: event.target.value })); }}
          />
        </div>
        {trays ? (
          <>
            {/* At the tray weight the dough was MADE with, not today's. */}
            <LogTraysField
              weight={{ trayWeight: working.trayWeight }}
              trays={working.trays}
              onChange={next => { setWorking(before => ({ ...before, trays: next })); }}
            />
            {working.recipe?.logic === 'traysTotal' ? (
              <LogTotalField total={working.typedTotal} onChange={next => { setWorking(before => ({ ...before, typedTotal: next })); }} />
            ) : null}
          </>
        ) : (
          <div className={styles.field}>
            <p className={styles.label}>{t('calc.productsQuantitiesOnly')}</p>
            <LogQtyRows rows={working.rows} onChange={setQty} empty={t('calc.noProductsInThisDough')} />
          </div>
        )}
      </div>
    </SettingsEditor>
  );
}
