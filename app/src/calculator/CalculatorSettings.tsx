import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { asksDoughDay, cloneConfig, showsClientOrdersButton } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { Door } from './Door';
import {
  CALCULATOR_PATH, clientsPath, divisorPath, extraPath, logSettingsPath, orderingPath, recipesPath, whatsappPath,
} from './calculatorPath';
import { CLIENTS_OPENER, DIVISOR_OPENER, EXTRA_OPENER, LOG_OPENER, ORDERING_OPENER, RECIPES_OPENER, WHATSAPP_OPENER } from './handBack';
import { SettingSwitch } from './SettingSwitch';
import { SettingsPage } from './SettingsPage';
import { useSaveConfig } from './useSaveConfig';
import styles from './CalculatorSettings.module.css';

// How long «Saved ✓» stays beside a switch that has just been saved.
export const SAVED_TAG_MS = 2000;

// The Calculator's Settings: a hub of doors, one card per subject, and the two switches that apply to the whole
// venue (a port of the hub in calculator.html and of js/calculator-settings.js).
//
// The Client ordering door (the deadline of the orders clients send from their own link, step 3c-4b) sits beside the
// WhatsApp door (the market order lists, 3c-4a); the first switch governs the Calculator's door to the received orders.
//
// ⚠️ THE TWO SWITCHES WAIT FOR THE SERVER'S ANSWER (`configFromServer`): a tap before it would be built on a copy the
// browser's own database answered, and the store sends nothing before the server has spoken.
export function CalculatorSettings() {
  const { t } = useT();
  return (
    <SettingsPage title={t('ui.settings')} fallback={CALCULATOR_PATH}>
      <VenueSwitches />
      <Card title={t('ui.recipes')}>
        <Door opener={RECIPES_OPENER} to={recipesPath} title={t('ui.recipes')} sub={t('ui.addEditOrDelete')} />
        <Door opener={EXTRA_OPENER} to={extraPath} title={t('calc.extraDough2')} sub={t('ui.showOrHideThe')} />
        <Door opener={DIVISOR_OPENER} to={divisorPath} title={t('ui.divisor')} sub={t('ui.chooseWhichProductsThe')} />
      </Card>
      <Card title={t('ui.log')}>
        <Door opener={LOG_OPENER} to={logSettingsPath} title={t('ui.log')} sub={t('ui.chooseWhichRecipesLogs')} />
      </Card>
    </SettingsPage>
  );
}

// A card of rows under a heading; the optional tag sits at the heading's end.
function Card({ title, tag, children }: { title: string; tag?: ReactNode; children: ReactNode }) {
  const headId = useId();
  return (
    <section className={styles.card} aria-labelledby={headId}>
      <div className={styles.head}>
        <h3 id={headId} className={styles.headTitle}>{title}</h3>
        {tag}
      </div>
      {children}
    </section>
  );
}

type SwitchKey = 'showClientOrdersButton' | 'askDoughDay';

// «Clients and orders»: the Clients door and the two switches of the whole venue.
//
// ⚠️ EACH SWITCH SAVES ON THE TAP (no Save, no question: the settings kit's rule) and shows «Saved ✓» for two
// seconds — but only when the database was told; a change kept on this phone says so in words instead. The
// switch shows what the store holds, and the store takes a refused write back, so a refusal puts the switch
// where it was by itself, and the sentence says why.
function VenueSwitches() {
  const { t } = useT();
  const store = useCalculatorStore();
  const { config, configFromServer } = useCalculator();
  const [save, saveDialog] = useSaveConfig();
  const [tagged, setTagged] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  function flash() {
    if (timer.current !== null) clearTimeout(timer.current);
    setTagged(true);
    timer.current = setTimeout(() => { timer.current = null; setTagged(false); }, SAVED_TAG_MS);
  }

  async function change(key: SwitchKey, wanted: boolean) {
    // A second tap while the first is travelling does nothing.
    if (saving.current) return;
    saving.current = true;
    try {
      const next: CalculatorConfig = cloneConfig(store.getSnapshot().config);
      next[key] = wanted;
      const saved = await save(next);
      // Kept on this phone is not a confirmation either: the database has not been told.
      if (saved && mounted.current && store.getSnapshot().configFromServer) flash();
    } finally {
      saving.current = false;
    }
  }

  return (
    <Card
      title={t('settings.calc.clients')}
      tag={<span role="status" className={styles.saved}>{tagged ? t('settings.saved') : ''}</span>}
    >
      <Door opener={CLIENTS_OPENER} to={clientsPath} title={t('ui.clients')} sub={t('ui.clientsAndTheProducts')} />
      <Door opener={WHATSAPP_OPENER} to={whatsappPath} title={t('ui.whatsapp')} sub={t('ui.buildOrderListsPick')} />
      <Door opener={ORDERING_OPENER} to={orderingPath} title={t('ui.clientOrdering')} sub={t('ui.whenOrdersSentFrom')} />
      <SwitchRow
        title={t('settings.calc.ordersButton')}
        sub={t('settings.calc.ordersButton.sub')}
        selected={showsClientOrdersButton(config)}
        isDisabled={!configFromServer}
        onChange={wanted => { void change('showClientOrdersButton', wanted); }}
      />
      <SwitchRow
        title={t('settings.calc.askDay')}
        sub={t('settings.calc.askDay.sub')}
        selected={asksDoughDay(config)}
        isDisabled={!configFromServer}
        onChange={wanted => { void change('askDoughDay', wanted); }}
      />
      {saveDialog}
    </Card>
  );
}

function SwitchRow({ title, sub, selected, isDisabled, onChange }: {
  title: string; sub: string; selected: boolean; isDisabled: boolean; onChange: (selected: boolean) => void;
}) {
  const ids = useId();
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span id={`${ids}-title`} className={styles.title}>{title}</span>
        <span id={`${ids}-sub`} className={styles.sub}>{sub}</span>
      </span>
      <SettingSwitch selected={selected} onChange={onChange} isDisabled={isDisabled} labelledBy={`${ids}-title`} describedBy={`${ids}-sub`} />
    </div>
  );
}
