import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  ORDER_PREFILL_WINDOWS, cloneConfig, getOrderPrefillWindow, getWhatsappClients, getWhatsappLists,
} from '@mise/shared/calculator-config';
import type { OrderPrefillWindow } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/useConfirm';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { fromParentAt } from './calculatorNav';
import {
  SETTINGS_PATH, newWhatsappDirectPath, newWhatsappListPath, whatsappDirectPath, whatsappListPath,
} from './calculatorPath';
import { useHandBack, whatsappItemOpener } from './handBack';
import { SettingsPage } from './SettingsPage';
import { useSaveConfig } from './useSaveConfig';
import { PREFILL_LABEL_KEYS, isBlank, withPrefillWindow, withoutItem } from './whatsappModel';
import styles from './WhatsappEditor.module.css';

// The top of the WhatsApp lists editor (Level 0): which days the order form fills itself from, the saved lists and the
// saved direct clients, each a card that opens it with a small icon that deletes it.
//
// ⚠️ THERE IS NO SAVE HERE, and nothing waits for one: the window is applied when it is chosen, and a delete is applied
// when it is confirmed. Each list or client is saved from ITS OWN screen. Both write over the LATEST configuration
// only what they changed (the window; one id removed), so another phone's change to anything else survives.
export function WhatsappTop() {
  const { t } = useT();
  const store = useCalculatorStore();
  const { config } = useCalculator();
  const navigate = useNavigate();
  const [confirm, confirmDialog] = useConfirm();
  const [save, saveDialog] = useSaveConfig();
  const lists = getWhatsappLists(config);
  const clients = getWhatsappClients(config);
  const headList = useId();
  const headClients = useId();
  const busy = useRef(false);
  const addList = useRef<HTMLButtonElement>(null);
  const addClient = useRef<HTMLButtonElement>(null);

  async function remove(group: 'list' | 'direct', id: string) {
    // One question at a time, and a delete in the air is not asked again.
    if (busy.current) return;
    busy.current = true;
    try {
      const ok = await confirm({
        title: t(group === 'list' ? 'calc.deleteThisList' : 'calc.deleteThisClient'),
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
      // The latest configuration with this ONE id taken out: a list another phone added since stays.
      const latest = cloneConfig(store.getSnapshot().config);
      // Refused → the store is back on the server's copy and the row is drawn again, after the sentence says so.
      if (await save(withoutItem(latest, group, id))) (group === 'list' ? addList : addClient).current?.focus();
    } finally {
      busy.current = false;
    }
  }

  return (
    <SettingsPage title={t('calc.whatsappLists')} fallback={SETTINGS_PATH}>
      <div className={styles.form}>
        <PrefillWindow />

        <section className={styles.section} aria-labelledby={headList}>
          <h3 id={headList} className={styles.label}>{t('ui.lists')}</h3>
          <ul className={styles.rows}>
            {lists.map(list => (
              <ItemRow
                key={list.id}
                group="list"
                id={list.id}
                name={isBlank(list.title) ? t('calc.untitledList') : list.title}
                deleteLabel={t('calc.deleteListNamed', { name: isBlank(list.title) ? t('calc.untitledList') : list.title })}
                onDelete={() => { void remove('list', list.id); }}
              />
            ))}
          </ul>
          <Button ref={addList} className={styles.add} onPress={() => { void navigate(newWhatsappListPath, { state: fromParentAt(1) }); }}>
            {t('calc.addList')}
          </Button>
        </section>

        <section className={styles.section} aria-labelledby={headClients}>
          <h3 id={headClients} className={styles.label}>{t('ui.clients')}</h3>
          <ul className={styles.rows}>
            {clients.map(client => (
              <ItemRow
                key={client.id}
                group="direct"
                id={client.id}
                name={isBlank(client.name) ? t('calc.unnamedClient') : client.name}
                deleteLabel={t('calc.deleteClientNamed', { name: isBlank(client.name) ? t('calc.unnamedClient') : client.name })}
                onDelete={() => { void remove('direct', client.id); }}
              />
            ))}
          </ul>
          <Button ref={addClient} className={styles.add} onPress={() => { void navigate(newWhatsappDirectPath, { state: fromParentAt(1) }); }}>
            {t('calc.addClient')}
          </Button>
        </section>
      </div>
      {confirmDialog}
      {saveDialog}
    </SettingsPage>
  );
}

// A card of the top: it opens the list or the client, and a small icon beside it deletes it.
function ItemRow({ group, id, name, deleteLabel, onDelete }: {
  group: 'list' | 'direct'; id: string; name: string; deleteLabel: string; onDelete: () => void;
}) {
  const navigate = useNavigate();
  const handBack = useHandBack();
  const opener = whatsappItemOpener(group, id);
  const register = useCallback((node: HTMLButtonElement | null) => { handBack.register(opener, node); }, [handBack, opener]);
  return (
    <li className={styles.card}>
      <Button
        ref={register}
        variant="bare"
        className={styles.open}
        onPress={() => {
          handBack.expect(opener);
          void navigate(group === 'list' ? whatsappListPath(id) : whatsappDirectPath(id), { state: fromParentAt(1) });
        }}
      >
        <span className={`${styles.text} ${styles.name}`}>{name}</span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </Button>
      <Button variant="bare" className={styles.del} aria-label={deleteLabel} onPress={onDelete}>
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

// «Fill the order from»: applied on the change (see WhatsappTop), disabled while the write is in the air, and put back
// when it is refused.
function PrefillWindow() {
  const { t } = useT();
  const store = useCalculatorStore();
  const { config } = useCalculator();
  const [save, saveDialog] = useSaveConfig();
  const selectId = useId();
  const helpId = useId();
  // The value just chosen while its write is in the air; otherwise the box shows what the store holds.
  const [pending, setPending] = useState<OrderPrefillWindow | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const shown = pending ?? getOrderPrefillWindow(config);

  async function change(wanted: OrderPrefillWindow) {
    if (pending !== null) return;
    // Built on the LATEST configuration, with only this one key changed.
    const latest = cloneConfig(store.getSnapshot().config);
    if (wanted === getOrderPrefillWindow(latest)) return;
    const before = getOrderPrefillWindow(latest);
    setPending(wanted);
    try {
      await save(withPrefillWindow(latest, wanted), { onFail: () => { if (mounted.current) setPending(before); } });
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  return (
    <div className={styles.field}>
      <div className={styles.selectRow}>
        <label htmlFor={selectId} className={styles.label}>{t('calc.fillTheOrderFrom')}</label>
        <select
          id={selectId}
          className={styles.select}
          aria-describedby={helpId}
          value={shown}
          disabled={pending !== null}
          onChange={event => { void change(event.target.value as OrderPrefillWindow); }}
        >
          {ORDER_PREFILL_WINDOWS.map(window => (
            <option key={window} value={window}>{t(PREFILL_LABEL_KEYS[window])}</option>
          ))}
        </select>
      </div>
      <p id={helpId} className={styles.help}>{t('calc.prefillWindow.help')}</p>
      {saveDialog}
    </div>
  );
}
