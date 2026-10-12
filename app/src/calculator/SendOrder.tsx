import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight, Send } from 'lucide-react';
import {
  getOrderPrefillWindow, getWhatsappClients, getWhatsappLists,
} from '@mise/shared/calculator-config';
import type { OrderPrefillWindow, WhatsappClient, WhatsappList } from '@mise/shared/calculator-config';
import { latestVersion, sortLogs } from '@mise/shared/log-model';
import { prefillFromLogs } from '@mise/shared/calculator-order-prefill';
import { buildOrderMessage } from '@mise/shared/calculator-order-text';
import type { OrderSection } from '@mise/shared/calculator-order-text';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useAlert } from '../ui/useAlert';
import { useSendSheet } from '../ui/SendSheet';
import { useCalculator } from './CalculatorContext';
import { OrderForm } from './OrderForm';
import { directEntries, listEntries } from './orderModel';
import type { OrderEntry } from './orderModel';
import styles from './SendOrder.module.css';

// Where the market order is: nothing open, the picker of lists and clients, or the order form — with, on top of it,
// the «Send to» question when more than one client holds quantities.
type Flow =
  | { step: 'pick'; lists: WhatsappList[]; directs: WhatsappClient[] }
  | {
    step: 'form';
    title: string;
    entries: OrderEntry[];
    prefilled: Record<string, number> | null;
    prefillWindow: OrderPrefillWindow;
    stale: boolean;
    who: OrderSection[] | null;
  };

// The «Send order» door at the top of the work view (the current app's header arrow): it opens the market order — the
// WhatsApp lists and the direct clients built in Settings, an order form with the quantities filled in from the
// doughs already logged, and the message to send.
//
//   • nothing saved → a notice; exactly one list or client → straight into its form; otherwise a picker;
//   • the form is a dialog (Cancel, Escape and the backdrop ask first when the quantities were changed by hand);
//   • Send builds the message, the form closes, and the same «which road» sheet as the recipe's takes over.
export function SendOrderDoor() {
  const { t } = useT();
  const calculator = useCalculator();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [alert, alertDialog] = useAlert();
  const [sendText, sendSheet] = useSendSheet();
  const door = useRef<HTMLButtonElement>(null);

  // ⚠️ THE FOCUS GOES BACK TO THE DOOR WHEN THE WHOLE ERRAND IS OVER, not at each dialog's close: the picker closes
  // into the form, the form into the sheet, and the element each of them would restore the focus to is gone by then.
  const busy = flow !== null || alertDialog !== null || sendSheet !== null;
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) door.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  const say = (message: string) => { void alert({ message, okLabel: t('common.ok') }); };

  // The form opens with the quantities the logs already hold, worked out ONCE, here: newest log first, the work days
  // of the setting, the clock of now. ⚠️ If the logs have not arrived, «nothing logged» would be a lie: no number is
  // offered and the form says they have not arrived.
  const openForm = (title: string, entries: OrderEntry[]) => {
    const prefillWindow = getOrderPrefillWindow(calculator.config);
    let prefilled = calculator.logsLoaded
      ? prefillFromLogs(entries, sortLogs(calculator.logs), latestVersion, { nowMs: Date.now(), window: prefillWindow })
      : null;
    // ⚠️ Logs that are only this device's copy never pass for fresh: if they filled nothing, «nothing logged» may be
    // false, so the form says the doughs have not arrived; if they filled something, the numbers carry a caution.
    const stale = prefilled !== null && !calculator.logsFromServer;
    if (stale && prefilled !== null && Object.keys(prefilled).length === 0) prefilled = null;
    setFlow({ step: 'form', title, entries, prefilled, prefillWindow, stale: stale && prefilled !== null, who: null });
  };

  const openList = (list: WhatsappList) => {
    const entries = listEntries(calculator.config, list);
    if (entries.length === 0) {
      setFlow(null);
      say(t('calc.thisListHasNo'));
      return;
    }
    openForm(list.title || t('calc.orderFallback'), entries);
  };

  const openDirect = (direct: WhatsappClient) => {
    const entries = directEntries(calculator.config, direct);
    if (entries.length === 0) {
      setFlow(null);
      return;
    }
    openForm(entries[0]?.client.name || t('calc.orderFallback'), entries);
  };

  const begin = () => {
    const lists = getWhatsappLists(calculator.config);
    const directs = getWhatsappClients(calculator.config);
    if (lists.length + directs.length === 0) {
      say(t('calc.noWhatsappListsOr'));
      return;
    }
    const onlyList = lists[0];
    const onlyDirect = directs[0];
    if (lists.length + directs.length === 1) {
      if (onlyList) openList(onlyList);
      else if (onlyDirect) openDirect(onlyDirect);
      return;
    }
    setFlow({ step: 'pick', lists, directs });
  };

  // The form closes BEFORE the road is taken (both roads open a new window, and on a phone that leaves the app).
  const hand = (title: string, sections: OrderSection[], multi: boolean) => {
    setFlow(null);
    sendText({ subject: title, text: buildOrderMessage(title, sections, multi) });
  };

  return (
    <>
      <Button ref={door} onPress={begin}>
        <Send aria-hidden="true" />
        {t('calc.sendOrder')}
      </Button>

      {flow?.step === 'pick' ? (
        <PickDialog
          lists={flow.lists}
          directs={flow.directs}
          onList={openList}
          onDirect={openDirect}
          onClose={() => { setFlow(null); }}
        />
      ) : null}

      {flow?.step === 'form' ? (
        <OrderForm
          title={flow.title}
          entries={flow.entries}
          prefilled={flow.prefilled}
          prefillWindow={flow.prefillWindow}
          stale={flow.stale}
          onCancel={() => { setFlow(null); }}
          onSend={sections => {
            // The chooser only appears when it has a real choice to offer: with a single client filled in there is
            // nothing to decide. ⚠️ `multi` is true whenever the form has several clients, even if only one of them
            // holds quantities — the title is then the LIST's name, and the message must still say who it is for.
            if (sections.length === 1) hand(flow.title, sections, flow.entries.length > 1);
            else setFlow({ ...flow, who: sections });
          }}
        />
      ) : null}

      {flow?.step === 'form' && flow.who !== null ? (
        <WhoDialog
          sections={flow.who}
          onAll={() => { hand(flow.title, flow.who ?? [], true); }}
          onOne={section => { hand(String(section.name) || flow.title, [section], false); }}
          // Back to the form with every quantity as it was: the form never closed.
          onClose={() => { setFlow({ ...flow, who: null }); }}
        />
      ) : null}

      {alertDialog}
      {sendSheet}
    </>
  );
}

function Row({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Button variant="bare" className={styles.row} onPress={onPress}>
      <span className={styles.label}>{children}</span>
      <ChevronRight aria-hidden="true" />
    </Button>
  );
}

// «Send order»: the saved lists first, then the direct clients.
function PickDialog({ lists, directs, onList, onDirect, onClose }: {
  lists: readonly WhatsappList[];
  directs: readonly WhatsappClient[];
  onList: (list: WhatsappList) => void;
  onDirect: (direct: WhatsappClient) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      isOpen
      dismissable
      title={t('calc.sendOrder')}
      onClose={onClose}
      actions={<Button onPress={onClose}>{t('common.cancel')}</Button>}
    >
      <div className={styles.picker}>
        {lists.length > 0 ? (
          <Group label={t('ui.lists')}>
            {lists.map(list => (
              <Row key={list.id} onPress={() => { onList(list); }}>{list.title || t('calc.untitledList')}</Row>
            ))}
          </Group>
        ) : null}
        {directs.length > 0 ? (
          <Group label={t('ui.clients')}>
            {directs.map(direct => (
              <Row key={direct.id} onPress={() => { onDirect(direct); }}>{direct.name || t('calc.unnamedClient')}</Row>
            ))}
          </Group>
        ) : null}
      </div>
    </Dialog>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={styles.group}>
      <p id={id} className={styles.groupLabel}>{label}</p>
      {children}
    </div>
  );
}

// «Send to»: everything together (the list's title, a heading per client) or one client on its own (that client's name
// as the title, no heading).
function WhoDialog({ sections, onAll, onOne, onClose }: {
  sections: readonly OrderSection[];
  onAll: () => void;
  onOne: (section: OrderSection) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      isOpen
      dismissable
      title={t('calc.sendTo')}
      onClose={onClose}
      actions={<Button onPress={onClose}>{t('common.cancel')}</Button>}
    >
      <div className={styles.picker}>
        <Row onPress={onAll}>{t('calc.allClientsTogether')}</Row>
        <p className={styles.groupLabel}>{t('calc.orOneClient')}</p>
        {sections.map(section => (
          <Row key={section.index} onPress={() => { onOne(section); }}>{String(section.name)}</Row>
        ))}
      </div>
    </Dialog>
  );
}
