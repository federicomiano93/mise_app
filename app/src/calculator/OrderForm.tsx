import { useEffect, useId, useState } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { orderSections } from '@mise/shared/calculator-order-text';
import type { OrderSection } from '@mise/shared/calculator-order-text';
import { prefillNote } from '@mise/shared/calculator-order-prefill';
import type { OrderPrefillWindow } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { numberOf } from './calculatorInput';
import { NumberField } from './NumberField';
import { changedByHand, quantityKey, startingQuantities, zeroQuantities } from './orderModel';
import type { OrderEntry } from './orderModel';
import styles from './OrderForm.module.css';

type Props = {
  // The list's title, or the direct client's name (or «Order»).
  title: string;
  entries: readonly OrderEntry[];
  // What the logs offered, once, when the form opened — or null when the saved doughs had not arrived yet (then the
  // form says so instead of «nothing logged»).
  prefilled: Readonly<Record<string, number>> | null;
  prefillWindow: OrderPrefillWindow;
  // The form is closed without sending (after the question, if quantities were changed by hand).
  onCancel: () => void;
  // Something to send: the sections that have a quantity above zero (at least one).
  onSend: (sections: OrderSection[]) => void;
};

// The order form of a market order: a section per client entry, a row per product (and free line) with a number box.
// A modal dialog — it scrolls inside, its title and its two buttons stay in view.
//
// ⚠️ THE PREFILL IS COMPUTED ONCE, BY THE CALLER, WHEN THE FORM OPENS, and the boxes start from it: a log arriving
// while somebody types must never move a number under their finger. «Clear all» zeroes ONLY this form's boxes.
//
// ⚠️ CLOSING AN ORDER THAT WAS CHANGED BY HAND ASKS FIRST (Cancel, Escape and a press on the backdrop alike), and
// while it holds such quantities the session is busy, so an update does not throw the typed order away. An untouched
// form (the prefill alone does not count) closes at once.
export function OrderForm({ title, entries, prefilled, prefillWindow, onCancel, onSend }: Props) {
  const { t } = useT();
  const base = useId();
  const [start] = useState(() => startingQuantities(entries, prefilled ?? {}));
  const [qty, setQty] = useState<Record<string, string>>(start);
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const dirty = changedByHand(start, qty);
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  // The sentence that makes a pre-filled number honest (P20): where it came from, or that there was none.
  const note = prefilled === null
    ? t('calc.prefill.notArrived')
    : prefillNote(Object.keys(prefilled).length, prefillWindow, t);

  const close = async () => {
    if (dirty && !(await confirm({
      title: t('calc.discardOrder'),
      okLabel: t('ui.discard'),
      cancelLabel: t('calc.keepOrder'),
      danger: true,
    }))) return;
    onCancel();
  };

  const clearAll = async () => {
    if (!(await confirm({
      title: t('calc.setEveryQuantityIn'),
      okLabel: t('calc.clearAll'),
      cancelLabel: t('common.cancel'),
      danger: true,
    }))) return;
    setQty(zeroQuantities(start));
  };

  const send = () => {
    const sections = orderSections(entries, (entryIndex, productId) => numberOf(qty[quantityKey(entryIndex, productId)]));
    if (sections.length === 0) {
      void alert({ message: t('calc.noOrdersToShare'), okLabel: t('common.ok') });
      return;
    }
    onSend(sections);
  };

  const several = entries.length > 1;

  return (
    <>
      <ModalOverlay isOpen onOpenChange={open => { if (!open) void close(); }} isDismissable className={styles.overlay}>
        <Modal className={styles.modal}>
          <AriaDialog className={styles.dialog}>
            <header className={styles.header}>
              <Heading slot="title" className={styles.title}>{title}</Heading>
            </header>

            <div className={styles.body}>
              <div className={styles.bar}>
                <p className={styles.note}>{note}</p>
                <Button variant="secondary" onPress={() => { void clearAll(); }}>{t('calc.clearAll')}</Button>
              </div>

              {entries.map((entry, entryIndex) => {
                const headingId = `${base}-client-${entryIndex}`;
                return (
                  <div key={entryIndex} role="group" aria-labelledby={headingId} className={styles.section}>
                    <h3 id={headingId} className={styles.client}>{entry.client.name}</h3>
                    <ul className={styles.rows}>
                      {entry.products.map(product => {
                        const key = quantityKey(entryIndex, product.id);
                        const boxId = `${base}-${key}`;
                        return (
                          <li key={product.id} className={styles.row}>
                            <label htmlFor={boxId} className={styles.name}>{product.name}</label>
                            <NumberField
                              id={boxId}
                              value={qty[key] ?? '0'}
                              onChange={text => { setQty(current => ({ ...current, [key]: text })); }}
                              onBlank={() => { setQty(current => ({ ...current, [key]: '0' })); }}
                              inputMode="numeric"
                              min={0}
                              label={several ? t('calc.orderBoxName', { product: product.name, client: entry.client.name }) : undefined}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>

            <footer className={styles.footer}>
              <Button onPress={() => { void close(); }}>{t('common.cancel')}</Button>
              <Button variant="primary" onPress={send}>{t('calc.send')}</Button>
            </footer>
          </AriaDialog>
        </Modal>
      </ModalOverlay>
      {confirmDialog}
      {alertDialog}
    </>
  );
}
