import { useCallback, useMemo, useState } from 'react';
import { Check, ChevronRight, ClipboardList, List } from 'lucide-react';
import { spellShortDate, todayISO } from '@mise/shared/day';
import { isFutureDay, nextDeliveryAfter } from '@mise/shared/order-day';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { DeliveryDoors } from './DeliveryDoors';
import { ListsDoor } from './ListsDoor';
import { NoticesPanel } from './NoticesPanel';
import { OrdersFilter } from './OrdersFilter';
import { OrdersHead } from './OrdersHead';
import { TodayOrders } from './TodayOrders';
import { useOrders } from './OrdersContext';
import { dayTranslate, deliveryDaysText } from './dayWords';
import { CLEAR_OPENER, PLACE_ALL_OPENER, itemsOpener, summaryOpener, supplierOpener, useHandBack } from './handBack';
import { orderingCount, supplierListGroups } from './ordersLens';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import styles from './OrdersList.module.css';

type Props = {
  lens: OrdersLens;
  // What the rows draw before `ready` (the local copy of the last good lists, or the live lists once those have landed), or null
  // (OrdersSection.tsx). ONLY for the rows: everything that acts reads `lens`.
  earlyLens: OrdersLens | null;
  // Suppliers, ingredients and the draft have all arrived (or failed): before that nothing may say «no suppliers» (parity L8).
  ready: boolean;
  // The supplier open beside the list (the tablet's split), marked as the current one.
  openId: string | null;
  // The supplier tapped while the list was drawn from the copy, waiting for the live data: its row is dimmed and busy.
  heldId: string | null;
  // The search box took the focus or its text changed: a supplier held for the live data is no longer wanted.
  onLookingElsewhere: () => void;
  onOpenSupplier: (id: string) => void;
  onOpenItems: (id: string) => void;
  // The clipboard button of a row (the split only, while the supplier has quantities): the order summary beside the list.
  onOpenSummary: (id: string) => void;
  // The two buttons under the list: the picker of the suppliers to record together, and the one to clear.
  onPlaceAll: () => void;
  onClearAll: () => void;
  // The swap button in the head: the flat view, «by ingredient» (step 3f-8b).
  swapOpen: boolean;
  onSwap: () => void;
  // The arrow beside the search box: the send screen.
  onSend: () => void;
  // The gear at the end of the head: the Orders settings (step 3f-4).
  onSettings: () => void;
  onHistory: () => void;
  // The debt banner and the two doors under the head (step 3f-5), drawn only while the venue checks deliveries.
  onIncoming: () => void;
  onReorder: () => void;
  // The «Order lists» door under them (step 3f-7), independent from the delivery switch.
  onLists: () => void;
  // «Placed yesterday» on a pending banner (step 3f-6): the supplier's confirm screen, recording under that day.
  onOpenPending: (id: string, day: string) => void;
};

const HEADING_KEY = {
  'orders.favourites.title': 'ord.favourites.title',
  'orders.favourites.others': 'ord.favourites.others',
} as const satisfies Record<string, MessageKey>;

// The left column: the head (OrdersHead: the search box, the send arrow, the tools and the All / Ordering filter, which stay put
// while the rows scroll), over the suppliers. The search box's text lives HERE, in a component that stays mounted, so a data
// snapshot never remounts the box (see OrdersHead).
export function OrdersList({ lens, earlyLens, ready, openId, heldId, onLookingElsewhere, onOpenSupplier, onOpenItems, onOpenSummary, onPlaceAll, onClearAll, swapOpen, onSwap, onSend, onSettings, onHistory, onIncoming, onReorder, onLists, onOpenPending }: Props) {
  const { t } = useT();
  const { config, draft, suppliersBroken, ingredientsBroken } = useOrders();
  const [query, setQuery] = useState('');
  const [orderingOnly, setOrderingOnly] = useState(false);
  const handBack = useHandBack();
  const split = useMediaQuery(SPLIT_QUERY);
  // Back from a picker hands the focus back to the button that opened it.
  const placeAllNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(PLACE_ALL_OPENER, node); }, [handBack]);
  const clearNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(CLEAR_OPENER, node); }, [handBack]);

  // ⚠️ THE ROWS, THE FILTER COUNTS AND THEIR ORDER READ `drawn`: the copy while the live lists have not landed, the live lens
  // otherwise. The search box above is the same mounted element either way, so what was typed on the copy survives the move to
  // live and still filters. THE SEND AND BULK BUTTONS BELOW STAY ON `ready` (when it is true `drawn` IS the live lens): nothing is
  // sent or recorded from an old list, and «No suppliers yet» is never said from it.
  const drawn = earlyLens ?? lens;
  const ordering = orderingCount(drawn);
  const groups = useMemo(
    () => supplierListGroups(drawn, { query, orderingOnly, favourites: config.favouriteSuppliers }),
    [drawn, query, orderingOnly, config.favouriteSuppliers],
  );
  const shown = groups.reduce((n, group) => n + group.suppliers.length, 0);
  const broken = suppliersBroken || ingredientsBroken;

  // Nothing typed anywhere: there is no «just what I'm ordering» to offer — unless it is on (it must be possible to leave it).
  const showFilter = ordering > 0 || orderingOnly;

  const today = todayISO();
  const dt = dayTranslate(t);

  return (
    <div className={styles.column}>
      <OrdersHead
        view="suppliers"
        label={t('ord.searchASupplier')}
        query={query}
        onQuery={setQuery}
        onLookingElsewhere={onLookingElsewhere}
        ready={ready}
        hasSuppliers={lens.suppliers.length > 0}
        swapOpen={swapOpen}
        onSwap={onSwap}
        onSend={onSend}
        onSettings={onSettings}
        onHistory={onHistory}
      >
        {showFilter ? (
          <OrdersFilter
            label={t('ord.whichSuppliers')}
            ordering={orderingOnly}
            allText={t('ord.filter.all', { n: drawn.suppliers.length })}
            orderingText={t('ord.filter.ordering', { n: ordering })}
            onChoose={setOrderingOnly}
          />
        ) : null}
      </OrdersHead>

      <PartBoundary>
        <NoticesPanel onOpenSupplier={onOpenSupplier} onOpenPending={onOpenPending} onSend={onSend} />
      </PartBoundary>

      <PartBoundary>
        <TodayOrders onOpenSupplier={onOpenSupplier} />
      </PartBoundary>

      <DeliveryDoors onIncoming={onIncoming} onReorder={onReorder} />

      <ListsDoor onOpen={onLists} />

      {!ready && earlyLens === null ? (
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      ) : drawn.suppliers.length === 0 ? (
        // ⚠️ A DEAD STREAM IS NOT «NO SUPPLIERS»: the status line says what happened.
        broken ? null : (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{t('ord.noSuppliersYet')}</p>
            <p className={styles.emptySub}>{t('ord.noSuppliersYetSub')}</p>
          </div>
        )
      ) : shown === 0 ? (
        <p className={styles.nothing}>{query.trim() !== '' ? t('ord.noSupplierMatch') : t('ord.nothingOrdered')}</p>
      ) : (
        groups.map(group => (
          <div key={group.headingKey ?? 'all'} className={styles.group}>
            {group.headingKey === null ? null : <h2 className={styles.groupTitle}>{t(HEADING_KEY[group.headingKey as keyof typeof HEADING_KEY])}</h2>}
            <ul className={styles.rows}>
              {group.suppliers.map(supplier => {
                const filled = drawn.filledFor(supplier.id);
                // «delivery Mon 12» / «for Thu 8»: only with something typed AND a stamp that has not come yet (parity L14).
                const stamp = draft.days[supplier.id];
                const forLater = filled > 0 && isFutureDay(stamp, today);
                const delivery = forLater ? nextDeliveryAfter(supplier, stamp) : '';
                const tag = !forLater ? ''
                  : delivery !== '' ? t('day.delivery', { day: spellShortDate(delivery, dt) })
                    : t('day.for', { day: spellShortDate(stamp, dt) });
                return (
                  <SupplierRow
                    key={supplier.id}
                    supplier={supplier}
                    meta={[typeof supplier.category === 'string' ? supplier.category : '', deliveryDaysText(supplier.deliveryDays, t)]
                      .filter(part => part !== '').join(' · ')}
                    count={filled}
                    tag={tag}
                    isOpen={supplier.id === openId}
                    isWaiting={supplier.id === heldId}
                    onOpenSupplier={onOpenSupplier}
                    onOpenItems={onOpenItems}
                    onOpenSummary={split ? onOpenSummary : undefined}
                  />
                );
              })}
            </ul>
          </div>
        ))
      )}

      {/* After the list (parity X13): recording is offered from two suppliers with quantities, clearing from one. */}
      {ready && ordering > 0 ? (
        <div className={styles.bulk}>
          {ordering >= 2 ? (
            <Button ref={placeAllNode} onPress={onPlaceAll}>
              <Check aria-hidden="true" />
              {t('ord.placeAction')}
            </Button>
          ) : null}
          <Button ref={clearNode} variant="quiet" onPress={onClearAll}>{t('ord.clearAction')}</Button>
        </div>
      ) : null}
    </div>
  );
}

type RowProps = {
  supplier: StoredDoc;
  meta: string;
  count: number;
  tag: string;
  isOpen: boolean;
  isWaiting: boolean;
  onOpenSupplier: (id: string) => void;
  onOpenItems: (id: string) => void;
  // Undefined on a phone: neither the summary button nor its spacer is drawn there.
  onOpenSummary: ((id: string) => void) | undefined;
};

// ⚠️ SIBLING BUTTONS, NOT ONE WITH SOMETHING CLICKABLE INSIDE IT: a button in a button is invalid, and a tap on the inner one ran
// the outer one's handler too. The row is a plain container holding siblings: the wide one opens the order, a narrow one opens the
// read-only list of what the supplier sells, and on the split a third opens the order summary beside the list (only while the
// supplier has quantities; an invisible spacer of the same width keeps the rows aligned).
function SupplierRow({ supplier, meta, count, tag, isOpen, isWaiting, onOpenSupplier, onOpenItems, onOpenSummary }: RowProps) {
  const { t } = useT();
  const handBack = useHandBack();
  const id = supplier.id;
  const label = supplierLabel(supplier);
  // Back from the supplier's screen hands the focus back to its button; so does Back from «What they sell».
  const openNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(supplierOpener(id), node); }, [handBack, id]);
  const itemsNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(itemsOpener(id), node); }, [handBack, id]);
  const summaryNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(summaryOpener(id), node); }, [handBack, id]);
  return (
    <li className={styles.item} data-open={isOpen} data-waiting={isWaiting ? 'true' : undefined}>
      <button
        ref={openNode}
        type="button"
        className={styles.open}
        aria-current={isOpen ? 'true' : undefined}
        aria-busy={isWaiting ? 'true' : undefined}
        onClick={() => { onOpenSupplier(id); }}
      >
        <span className={styles.main}>
          <span className={styles.name}>{label}</span>
          {meta !== '' ? <span className={styles.meta}>{meta}</span> : null}
          {tag !== '' ? <span className={styles.tag}>{tag}</span> : null}
        </span>
        {count > 0 ? <span className={styles.count}>{t('ord.itemsCount', { n: count })}</span> : null}
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </button>
      <button
        ref={itemsNode}
        type="button"
        className={styles.view}
        aria-label={t('ord.ingredientsFrom', { supplier: label })}
        onClick={() => { onOpenItems(id); }}
      >
        <List aria-hidden="true" />
      </button>
      {onOpenSummary === undefined ? null : count > 0 ? (
        <button
          ref={summaryNode}
          type="button"
          className={styles.view}
          aria-label={t('ord.summaryFor', { supplier: label })}
          onClick={() => { onOpenSummary(id); }}
        >
          <ClipboardList aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" className={styles.spacer} />
      )}
    </li>
  );
}
