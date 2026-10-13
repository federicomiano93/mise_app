import { useId } from 'react';
import { Clock, TriangleAlert } from 'lucide-react';
import { getClientById } from '@mise/shared/calculator-config';
import { arrivedLate, isApplied, orderChangedSinceApplied, orderRows } from '@mise/shared/client-order-model';
import type { OrderRow } from '@mise/shared/client-order-model';
import { linesLabel } from '@mise/shared/client-order-history';
import type { HistoryTranslate } from '@mise/shared/client-order-history';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useCalculator, useClientOrders } from './CalculatorContext';
import type { ClientOrder } from './clientOrdersStore';
import { arrivedLabel, dayLabel, liveNameOf } from './clientOrdersView';
import styles from './ClientOrders.module.css';

// One order, as a card. Two kinds: an order still to come (with the button that puts it into the Calculator) and a past
// one (a record, with no button at all).

// The client's name for the card.
//
// ⚠️ THE BAKERY'S OWN NAME FOR THE CLIENT FIRST (security audit, 23 Sep 2026): the order's `clientName` is typed by the
// client's account, so one client could appear as another. It stays the fallback for a client the address book no longer
// has.
function useClientName(order: ClientOrder): { name: string; rows: OrderRow[] } {
  const { t } = useT();
  const { config } = useCalculator();
  const client = getClientById(config, order.clientId);
  return {
    name: client?.name || String(order.clientName ?? '') || t('calc.clientFallback'),
    rows: orderRows(order, liveNameOf(client), t('co.deletedProduct')),
  };
}

function Lines({ rows, strike }: { rows: readonly OrderRow[]; strike: boolean }) {
  const { locale } = useT();
  const number = new Intl.NumberFormat(locale);
  if (rows.length === 0) return null;
  return (
    <ul className={styles.lines}>
      {rows.map(row => (
        <li key={row.id} className={styles.line} data-missing={strike && row.missing ? '' : undefined}>
          <span className={styles.lineName}>{row.name}</span>
          <span className={styles.lineQty}>{number.format(row.qty)}</span>
        </li>
      ))}
    </ul>
  );
}

function ClientNote({ order }: { order: ClientOrder }) {
  const { t } = useT();
  const note = String(order.note ?? '');
  if (note === '') return null;
  return (
    <p className={styles.note}>
      <span className={styles.noteLabel}>{t('calc.note')}</span>
      {note}
    </p>
  );
}

// An order still to come.
export function OrderCard({ order, onApply }: { order: ClientOrder; onApply: (order: ClientOrder) => void }) {
  const { t, locale } = useT();
  const { cutoff } = useClientOrders();
  const nameId = useId();
  const { name, rows } = useClientName(order);
  const now = Date.now();
  const changed = orderChangedSinceApplied(order);
  const used = isApplied(order) && !changed;
  const state = changed ? 'changed' : used ? 'used' : 'new';

  // ⚠️ THREE DIFFERENT LABELS, because the tap means three different things and the difference is what stops the wrong
  // bake. On a CHANGED order the button has to say that the numbers about to go in are new ones — «Put in the calculator»
  // on a card the owner may already have acted on this morning reads as a button he has finished with.
  const label: MessageKey = changed ? 'calc.putTheNewOrder' : used ? 'calc.putInTheCalculator' : 'calc.putInTheCalculator2';

  return (
    <article className={styles.card} data-state={state} aria-labelledby={nameId}>
      <div className={styles.head}>
        <h3 id={nameId} className={styles.client}>{name}</h3>
        <p className={styles.day}>{dayLabel(t, locale, order.date, now)}</p>
      </div>
      <p className={styles.sent}>{t(used ? 'calc.co.sentUsed' : 'calc.co.sent', { when: arrivedLabel(t, locale, order, now) })}</p>

      {/* ⚠️ A LATE ARRIVAL IS SHOWN, NOT REFUSED. The security rules keep only a coarse floor on dates, so the deadline is
          really enforced by the client's page, which is code on somebody else's phone. Making a late one VISIBLE is what
          turns that from a hole into a thing the bakery can decide about. */}
      {arrivedLate(order, cutoff) ? (
        <p className={styles.notice} data-tone="warn">
          <Clock aria-hidden="true" />
          <span>{t('calc.co.arrivedLate', { cutoff })}</span>
        </p>
      ) : null}

      {/* ⚠️ THE LOUDEST THING ON THE CARD, because it is the one that bakes the wrong amount. Somebody who used this order
          twenty minutes ago has no other way to know. */}
      {changed ? (
        <p className={styles.notice} data-tone="danger">
          <TriangleAlert aria-hidden="true" />
          <span>{t('calc.thisClientChangedTheir')}</span>
        </p>
      ) : null}

      {rows.length === 0 ? <p className={styles.empty}>{t('calc.nothingThisDayThe')}</p> : <Lines rows={rows} strike />}

      {/* A product this client no longer has cannot be put anywhere: there is no box for it. Said here rather than
          discovered as a line that quietly did not arrive. */}
      {rows.some(row => row.missing) ? (
        <p className={styles.notice} data-tone="warn">
          <TriangleAlert aria-hidden="true" />
          <span>{t('calc.aLineAboveIs')}</span>
        </p>
      ) : null}

      <ClientNote order={order} />

      <Button
        className={styles.apply}
        variant={used ? 'secondary' : 'primary'}
        aria-describedby={nameId}
        onPress={() => { onApply(order); }}
      >
        {t(label)}
      </Button>
    </article>
  );
}

// A past order, read-only.
//
// ⚠️⚠️ NO «PUT IN THE CALCULATOR» BUTTON, and it is the safety decision of the history. That button on a three-week-old
// order would fill TODAY's quantity boxes with old numbers, silently, and nobody would find out until the bake. The
// history is a record of what a client asked for, not a thing to do.
export function PastOrderCard({ order }: { order: ClientOrder }) {
  const { t } = useT();
  const nameId = useId();
  const { name, rows } = useClientName(order);
  // `t` takes the app's own keys; the shared word function asks by the same keys, as plain strings.
  const say: HistoryTranslate = (key, params) => t(key as MessageKey, params);

  return (
    <article className={styles.card} data-state="past" aria-labelledby={nameId}>
      <div className={styles.head}>
        <h4 id={nameId} className={styles.client}>{name}</h4>
        <p className={styles.day}>{linesLabel(order, say)}</p>
      </div>
      {/* Whether it was ever used is a fact worth keeping: an order that arrived and was never put in is exactly the
          thing somebody looks a past day up to check. */}
      <p className={styles.sent}>{isApplied(order) ? t('calc.wentIntoTheCalculator') : t('calc.neverPutIntoThe')}</p>
      {rows.length === 0 ? <p className={styles.empty}>{t('calc.theClientSentThis')}</p> : null}
      {/* ⚠️ NO STRIKE-THROUGH HERE, and it is deliberate: on an order still to be used it warns that the product is gone,
          so this line cannot go into the Calculator. On a RECORD it is a lie by typography — the client DID ask for that
          thing on that day, and a product deleted or renamed since does not change what was ordered. */}
      <Lines rows={rows} strike={false} />
      <ClientNote order={order} />
    </article>
  );
}
