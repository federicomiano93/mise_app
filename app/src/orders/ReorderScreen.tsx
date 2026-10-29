import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { recordedName } from '@mise/shared/archive';
import { spellDay } from '@mise/shared/day';
import type { ReorderItem } from '@mise/shared/deliveries';
import { NO_SUPPLIER_ID } from '@mise/shared/no-supplier';
import { indexById } from '@mise/shared/order-text';
import { qtyWithUnit } from '@mise/shared/order-unit';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useOrders, useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import { REORDER_DOOR, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { ORDERS_PATH } from './ordersPath';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';
import { useDeliveryView } from './useDeliveryView';
import { useKeepFocus } from './useKeepFocus';
import styles from './ReorderScreen.module.css';

const keyOf = (item: ReorderItem): string => `${item.recordId}|${item.id}`;

// How long every card ignores a press after an action on the list. ⚠️ A card that was acted on leaves in the same tick and the
// NEXT card's identical button slides under the finger that is still tapping: a double tap on «Put back» would put back two lines.
const QUIET_MS = 600;

// «To re-order» (parity V7–V11), at /orders/reorder, one level below the list: every ingredient that did not arrive and has not been
// dealt with, newest first, ONE CARD PER LINE. Each line waits until somebody decides — Federico buys a missing ingredient
// «somewhere else» as often as from the same supplier, so there is no single «put everything back»: per line, «put it back in
// {supplier}'s order», «order from another supplier», or «Resolved» (bought elsewhere: it leaves this list for good and goes in no
// order).
//
// ⚠️ EVERYTHING IT SHOWS IS DERIVED from the records and the order being typed (useDeliveryView): a line put back, ordered
// elsewhere or marked resolved — on this phone or another — leaves the list without any bookkeeping here.
// ⚠️ AN EMPTY LIST STAYS OPEN, with a sentence: closing it when the last line goes would yank the screen from under the thumb that
// just tapped.
export function ReorderScreen() {
  const { t } = useT();
  const { state } = useLocation();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const { history, ingredients, suppliers } = useOrders();
  const { reorder } = useDeliveryView();
  const [confirm, confirmDialog] = useConfirm();
  const dt = dayTranslate(t);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const leave = useLeave(ORDERS_PATH, useCallback(() => { handBack.expect(REORDER_DOOR); }, [handBack]));
  // The lines whose «Resolved» is in the air («recordId|ingredientId»): every button of that card is off, and stays off across a
  // redraw. Re-enabled only on failure — on success the card is about to go, and a live button on it would invite a second tap.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = useState<string | null>(null);
  // Until when the cards ignore a press (a Date.now() reading): set by every action on the list, read by every handler.
  const quietUntil = useRef(0);
  const quiet = (): boolean => Date.now() < quietUntil.current;
  const hush = (): void => { quietUntil.current = Date.now() + QUIET_MS; };

  const ingredientsById = useMemo(() => indexById(ingredients), [ingredients]);
  const suppliersById = useMemo(() => indexById(suppliers), [suppliers]);
  const recordsById = useMemo(() => indexById(history), [history]);

  const keepFocus = useKeepFocus(list, title, `${reorder.map(keyOf).join('|')}#${[...busy].sort().join('|')}`);

  useEffect(() => {
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const couldNotSave = () => { say(t('ord.incoming.couldNotSave'), LONG_MS); };

  // The supplier a «put back» really goes to: the ingredient's CURRENT one, which is not always the one it was missed from (it may
  // have been moved since). ⚠️ A draft quantity is only ever seen on an order row, so where no visible row would carry it — the
  // ingredient is gone, switched off, or has no active supplier (Orders files those under «No supplier», which is not a place to put
  // an order back) — there is no such button: a quantity typed into a row nobody can see is an order that is never placed.
  const putBackTarget = (item: ReorderItem): StoredDoc | null => {
    const card = ingredientsById[item.id];
    if (!card || card.active === false) return null;
    const to = suppliersById[String(card.supplierId)];
    return to && to.active !== false ? to : null;
  };

  // The suppliers a missing line may be ordered from INSTEAD: active, sorted by the name a person reads, never the ingredient's
  // usual supplier and never the pseudo «no supplier». Empty when the ingredient is gone or switched off.
  const otherChoices = (item: ReorderItem): StoredDoc[] => {
    const card = ingredientsById[item.id];
    if (!card || card.active === false) return [];
    return suppliers
      .filter(s => s.active !== false && s.id !== NO_SUPPLIER_ID && s.id !== card.supplierId)
      .sort((a, b) => supplierLabel(a).localeCompare(supplierLabel(b)));
  };

  const nameOf = (item: ReorderItem): string => {
    // ⚠️ THE NAMES FROZEN INTO THE ORDER are the fallback, never an empty map: the ingredient list can arrive after the order
    // history, and a card drawn in between would say «Deleted ingredient» for an ingredient that exists.
    const record = recordsById[item.recordId];
    return recordedName(item.id, ingredientsById, record?.names, t('ord.deletedIngredient'));
  };

  // ⚠️ 'gone' is NOT a failed save: the ingredient or the supplier was switched off since the card was drawn, so the sentence says
  // that, instead of sending somebody to check a connection that is fine.
  const lineGone = () => { say(t('ord.reorder.lineGone'), LONG_MS); };

  function putBack(item: ReorderItem): void {
    if (quiet()) return;
    const outcome = store.putBack(item);
    hush();
    if (outcome === 'skipped') say(t('ord.reorder.someSkipped', { n: 1 }), LONG_MS);
    else if (outcome === 'gone') lineGone();
  }

  function chooseSupplier(item: ReorderItem, supplier: StoredDoc): void {
    if (quiet()) return;
    const outcome = store.orderElsewhere(item, supplier.id);
    hush();
    setChoosing(null);
    if (outcome === 'skipped') say(t('ord.reorder.someSkipped', { n: 1 }), LONG_MS);
    else if (outcome === 'gone') lineGone();
  }

  async function resolve(item: ReorderItem): Promise<void> {
    const key = keyOf(item);
    if (busy.has(key) || quiet()) return;
    const name = nameOf(item);
    const yes = await confirm({
      title: t('ord.reorder.resolveTitle'),
      message: t('ord.reorder.resolveMessage', { name }),
      okLabel: t('ord.reorder.resolved'),
      cancelLabel: t('common.cancel'),
    });
    if (!yes) return;
    hush();
    setBusy(before => new Set(before).add(key));
    let outcome: 'saved' | 'refused' | 'failed';
    try {
      outcome = await store.resolveMissing(item);
    } catch {
      outcome = 'failed';
    }
    if (outcome !== 'saved') {
      setBusy(before => {
        const next = new Set(before);
        next.delete(key);
        return next;
      });
      couldNotSave();
    }
  }

  const chosen = choosing === null ? null : reorder.find(item => keyOf(item) === choosing) ?? null;
  const choices = chosen === null ? [] : otherChoices(chosen);

  // The line the chooser is about left the list (put back or resolved on another phone): forget it, or the chooser would open by
  // itself when the same line comes back.
  useEffect(() => {
    if (choosing !== null && chosen === null) setChoosing(null);
  }, [choosing, chosen]);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.reorder.title')} titleId={titleId} titleRef={title} />
      <div ref={list} className={styles.body} onFocusCapture={keepFocus}>
        {reorder.length === 0 ? (
          <p className={styles.empty}>{t('ord.reorder.empty')}</p>
        ) : (
          <ul className={styles.cards}>
            {reorder.map(item => {
              const key = keyOf(item);
              const name = nameOf(item);
              const record = recordsById[item.recordId];
              const supplier = suppliersById[String(item.supplierId)];
              const supplierName = supplierLabel(supplier)
                || (typeof record?.supplierName === 'string' ? record.supplierName : '')
                || t('ord.incoming.unknownSupplier');
              const target = putBackTarget(item);
              const hasChoices = otherChoices(item).length > 0;
              const off = busy.has(key);
              return (
                <li key={key} className={styles.card} data-keep={key}>
                  <div className={styles.main}>
                    <span className={styles.name}>{name}</span>
                    <span className={styles.qty}>{qtyWithUnit(item.qty, item.unit)}</span>
                  </div>
                  <p className={styles.meta}>{t('ord.reorder.rowMeta', { supplier: supplierName, day: spellDay(item.missedOn, dt) })}</p>
                  {target === null ? null : (
                    <Button
                      block
                      className={styles.full}
                      isDisabled={off}
                      aria-label={t('ord.reorder.putBackInAria', { supplier: supplierLabel(target), name })}
                      onPress={() => { putBack(item); }}
                    >
                      {t('ord.reorder.putBackIn', { supplier: supplierLabel(target) })}
                    </Button>
                  )}
                  {hasChoices ? (
                    <Button
                      block
                      className={styles.full}
                      isDisabled={off}
                      aria-label={t('ord.reorder.otherSupplierAria', { name })}
                      onPress={() => { if (!quiet()) setChoosing(key); }}
                    >
                      {t('ord.reorder.otherSupplier')}
                    </Button>
                  ) : null}
                  <Button
                    variant="quiet"
                    className={styles.resolve}
                    isDisabled={off}
                    aria-label={t('ord.reorder.resolvedAria', { name })}
                    onPress={() => { void resolve(item); }}
                  >
                    {t('ord.reorder.resolved')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {chosen === null || choices.length === 0 ? null : (
        <Chooser
          name={nameOf(chosen)}
          usual={supplierLabel(suppliersById[String(ingredientsById[chosen.id]?.supplierId)])}
          choices={choices}
          onPick={supplier => { chooseSupplier(chosen, supplier); }}
          onClose={() => { setChoosing(null); }}
        />
      )}
      {confirmDialog}
    </section>
  );
}

// «Choose a supplier»: one big button per supplier it may go to, FOR THIS ORDER ONLY (the ingredient keeps its usual supplier). On
// the shared Dialog, so Escape, the backdrop and Cancel close it and write NOTHING.
function Chooser({ name, usual, choices, onPick, onClose }: {
  name: string; usual: string; choices: readonly StoredDoc[]; onPick: (supplier: StoredDoc) => void; onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      isOpen
      title={t('ord.reorder.chooseTitle')}
      message={usual !== '' ? t('ord.reorder.chooseHint', { name, supplier: usual }) : t('ord.reorder.chooseHintNoUsual', { name })}
      dismissable
      onClose={onClose}
      actions={<Button onPress={onClose}>{t('common.cancel')}</Button>}
    >
      <div className={styles.choices}>
        {choices.map((supplier, index) => (
          <Button
            key={supplier.id}
            variant="bare"
            className={styles.choice}
            autoFocus={index === 0}
            aria-label={t('ord.reorder.chooseAria', { name, supplier: supplierLabel(supplier) })}
            onPress={() => { onPick(supplier); }}
          >
            {supplierLabel(supplier)}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
