import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, ClipboardList, List } from 'lucide-react';
import { spellShortDate, todayISO } from '@mise/shared/day';
import { isFutureDay, nextDeliveryAfter } from '@mise/shared/order-day';
import { skippedOn } from '@mise/shared/reminders';
import type { PlacedRecord } from '@mise/shared/reminders';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { PartBoundary } from '../errors/PartBoundary';
import { useDueSuppliers } from '../shell/useDueSuppliers';
import { useFocusAcrossReorder } from '../shell/useFocusAcrossReorder';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { DebtBanner, DeliveryDoors } from './DeliveryDoors';
import { AwaitingBanners } from './AwaitingBanners';
import { NoticesPanel } from './NoticesPanel';
import { OrdersHead } from './OrdersHead';
import { SaveStateLine } from './SaveStateLine';
import { useOrders } from './OrdersContext';
import { dayTranslate, deliveryDaysText } from './dayWords';
import { CLEAR_OPENER, PLACE_ALL_OPENER, itemsOpener, summaryOpener, supplierOpener, useHandBack } from './handBack';
import { orderingCount, supplierGroups } from './ordersLens';
import type { OrdersLens, SupplierGroupKey } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import styles from './OrdersList.module.css';

type Props = {
  lens: OrdersLens;
  // What the rows draw before `ready` (the local copy of the last good lists, or the live lists once those have landed), or null
  // (OrdersSection.tsx). ONLY for the rows: everything that acts reads `lens`.
  earlyLens: OrdersLens | null;
  // Suppliers, ingredients and the draft have all arrived (or failed): before that nothing may say «no suppliers» (parity L8).
  ready: boolean;
  // The tablet's split: the doors and the notices are in the right-hand column (OrdersSection), not here, and a row has its summary
  // button. On a phone they are here: the doors under the search box, the notices above the list.
  split: boolean;
  // The supplier open beside the list (the tablet's split), marked as the current one.
  openId: string | null;
  // The supplier tapped while the list was drawn from the copy, waiting for the live data: its row is dimmed and busy.
  heldId: string | null;
  // The search box took the focus or its text changed: a supplier held for the live data is no longer wanted.
  onLookingElsewhere: () => void;
  onOpenSupplier: (id: string) => void;
  onOpenItems: (id: string) => void;
  // The clipboard button of a row (the split only): the order summary beside the list — while the supplier has quantities, and for a
  // supplier closed today as «not needed», whose summary holds «Reopen» (its door used to be the «Order today» chip, now gone).
  onOpenSummary: (id: string) => void;
  // The two buttons under the list: the picker of the suppliers to record together, and the one to clear.
  onPlaceAll: () => void;
  onClearAll: () => void;
  // The Ingredients tab: the flat view (step 3f-8b).
  onSwap: () => void;
  // «Send the list again» in the notices: the send screen.
  onSend: () => void;
  // The phone's debt banner and two doors (step 3f-5), drawn only while the venue checks deliveries.
  onIncoming: () => void;
  onReorder: () => void;
  // «Placed yesterday» on a pending banner (step 3f-6): the supplier's confirm screen, recording under that day.
  onOpenPending: (id: string, day: string) => void;
  // A supplier's screen is open beside the list: its save line speaks, this one keeps its room (SaveStateLine).
  saveSilent: boolean;
};

const HEADING_KEY: Record<SupplierGroupKey, MessageKey> = {
  due: 'ord.group.due',
  favourites: 'ord.favourites.title',
  others: 'ord.favourites.others',
};

// The left column: the head (OrdersHead: the tabs and the search box, which sticks while the rows scroll), then «Saved ✓» and the
// suppliers in three groups — «To order», «Favourites», «Other suppliers» (the redesign of 16 Nov 2026, item 4). The search box's text
// lives HERE, in a component that stays mounted, so a data snapshot never remounts the box (see OrdersHead).
export function OrdersList({ lens, earlyLens, ready, split, openId, heldId, onLookingElsewhere, onOpenSupplier, onOpenItems, onOpenSummary, onPlaceAll, onClearAll, onSwap, onSend, onIncoming, onReorder, onOpenPending, saveSilent }: Props) {
  const { t } = useT();
  const { config, draft, suppliers, suppliersLoaded, history, historyBroken, draftBroken, draftLoaded, serverSeen, suppliersBroken, ingredientsBroken } = useOrders();
  const [query, setQuery] = useState('');
  const handBack = useHandBack();
  // Back from a picker hands the focus back to the button that opened it.
  const placeAllNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(PLACE_ALL_OPENER, node); }, [handBack]);
  const clearNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(CLEAR_OPENER, node); }, [handBack]);

  // ⚠️ THE ROWS AND THEIR ORDER READ `drawn`: the copy while the live lists have not landed, the live lens otherwise. The search box
  // above is the same mounted element either way, so what was typed on the copy survives the move to live and still filters. THE BULK
  // BUTTONS BELOW STAY ON `ready` (when it is true `drawn` IS the live lens): nothing is recorded from an old list, and «No suppliers
  // yet» is never said from it.
  const drawn = earlyLens ?? lens;
  const ordering = orderingCount(drawn);
  // ⚠️ THE SUPPLIERS STILL TO ORDER TODAY (reminders dueTodayIds) count for «To order» ONLY once the suppliers have arrived AND THE
  // SERVER has answered for today's records and the draft (not the phone's saved copy, which can lack an order placed this morning on
  // another phone and would flash that supplier as due, then move it): before that — and offline with no server answer — only the
  // quantities typed decide. A dead records stream says nothing (nothing to read them from); a dead draft counts as arrived with no
  // closes.
  const dueReady = suppliersLoaded && !historyBroken && serverSeen.history && (serverSeen.draft || draftBroken);
  const due = useDueSuppliers({
    suppliers,
    records: history as readonly PlacedRecord[],
    skipped: draftBroken ? null : draft.skipped,
    ready: dueReady,
  });
  const today = todayISO();
  // Closed today as «not needed» (drafts/current.skipped): out of «To order», and its row keeps the door to «Reopen». A dead draft
  // closes nobody, as in useDueSuppliers.
  const closedToday = useMemo(
    () => (draftLoaded && !draftBroken ? skippedOn(draft.skipped, today) : new Set<string>()),
    [draftLoaded, draftBroken, draft.skipped, today],
  );
  const groups = useMemo(
    () => supplierGroups(drawn, { query, favourites: config.favouriteSuppliers, due, closedToday }),
    [drawn, query, config.favouriteSuppliers, due, closedToday],
  );
  const shown = groups.reduce((n, group) => n + group.suppliers.length, 0);
  const broken = suppliersBroken || ingredientsBroken;
  useFocusAcrossReorder(due);
  // ⚠️ A ROW THAT MOVES FROM ONE GROUP TO ANOTHER IS A NEW NODE (another list): a focus that fell with the old one is handed to the new
  // row of the same supplier. ONLY when that old node is gone and the focus fell to nothing: a person who moved on, or a focus that left
  // the row by itself (a tap on blank space after typing beside it), is never pulled back to the list (review of 16 Nov 2026).
  const focusedRow = useRef<{ id: string; node: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const was = focusedRow.current;
    if (was === null || was.node.isConnected) return;
    focusedRow.current = null;
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    handBack.focus(supplierOpener(was.id));
  }, [groups, handBack]);

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
        onSwap={onSwap}
      />

      {/* A phone: the debt and the two doors under the search box, then the notices above the list. On the split they are in the
          right-hand column. */}
      {split ? null : (
        <>
          <DebtBanner onIncoming={onIncoming} />
          <DeliveryDoors onIncoming={onIncoming} onReorder={onReorder} />
          <PartBoundary>
            <NoticesPanel onOpenSupplier={onOpenSupplier} onOpenPending={onOpenPending} onSend={onSend} />
          </PartBoundary>
        </>
      )}

      {/* ⚠️ In the column, above the suppliers, so the list shows whether what was typed has reached the server (the iPad order of
          14 Nov 2026). Silent while a supplier is open: its own line speaks. */}
      <SaveStateLine silent={saveSilent} />

      {/* «Did it go?» on every device, as a line that blocks nothing; the device that sent it asks in a dialog (AskHereDialog). */}
      <PartBoundary>
        <AwaitingBanners lens={lens} />
      </PartBoundary>

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
        <p className={styles.nothing}>{t('ord.noSupplierMatch')}</p>
      ) : (
        groups.map(group => (
          <div key={group.key} className={styles.group} data-group={group.key}>
            {group.heading ? <h2 className={styles.groupTitle}>{t(HEADING_KEY[group.key])}</h2> : null}
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
                const closed = closedToday.has(supplier.id);
                return (
                  <SupplierRow
                    key={supplier.id}
                    supplier={supplier}
                    meta={[typeof supplier.category === 'string' ? supplier.category : '', deliveryDaysText(supplier.deliveryDays, t)]
                      .filter(part => part !== '').join(' · ')}
                    count={filled}
                    tag={tag}
                    due={due.has(supplier.id)}
                    isOpen={supplier.id === openId}
                    isWaiting={supplier.id === heldId}
                    onOpenSupplier={onOpenSupplier}
                    onOpenItems={onOpenItems}
                    onOpenSummary={split ? onOpenSummary : undefined}
                    summaryOffered={filled > 0 || closed}
                    onRowFocus={(id, node) => { focusedRow.current = { id, node }; }}
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
  due: boolean;
  isOpen: boolean;
  isWaiting: boolean;
  onOpenSupplier: (id: string) => void;
  onOpenItems: (id: string) => void;
  // Undefined on a phone: neither the summary button nor its spacer is drawn there.
  onOpenSummary: ((id: string) => void) | undefined;
  // The summary button is drawn (quantities typed, or closed today: «Reopen» is in the summary); otherwise its spacer.
  summaryOffered: boolean;
  // The row's open button took the focus: kept by the list, which hands the focus back if the row moves to another group.
  onRowFocus: (id: string, node: HTMLElement) => void;
};

// ⚠️ SIBLING BUTTONS, NOT ONE WITH SOMETHING CLICKABLE INSIDE IT: a button in a button is invalid, and a tap on the inner one ran
// the outer one's handler too. The row is a plain container holding siblings: the wide one opens the order, a narrow one opens the
// read-only list of what the supplier sells, and on the split a third opens the order summary beside the list (while the supplier
// has quantities or was closed today; an invisible spacer of the same width keeps the rows aligned).
function SupplierRow({ supplier, meta, count, tag, due, isOpen, isWaiting, onOpenSupplier, onOpenItems, onOpenSummary, summaryOffered, onRowFocus }: RowProps) {
  const { t } = useT();
  const handBack = useHandBack();
  const id = supplier.id;
  const label = supplierLabel(supplier);
  // Back from the supplier's screen hands the focus back to its button; so does Back from «What they sell».
  const openNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(supplierOpener(id), node); }, [handBack, id]);
  const itemsNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(itemsOpener(id), node); }, [handBack, id]);
  const summaryNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(summaryOpener(id), node); }, [handBack, id]);
  return (
    <li className={styles.item} data-open={isOpen} data-due={due ? 'true' : undefined} data-waiting={isWaiting ? 'true' : undefined}>
      <button
        ref={openNode}
        type="button"
        className={styles.open}
        aria-current={isOpen ? 'true' : undefined}
        aria-busy={isWaiting ? 'true' : undefined}
        onFocus={event => { onRowFocus(id, event.currentTarget); }}
        onClick={() => { onOpenSupplier(id); }}
      >
        <span className={styles.main}>
          <span className={styles.name}>{label}</span>
          {meta !== '' ? <span className={styles.meta}>{meta}</span> : null}
          {tag !== '' ? <span className={styles.tag}>{tag}</span> : null}
          {/* «To order today» and «N items» on one line under the name (16 Nov 2026). ⚠️ A REAL SPACE before each: without it the
              name read out is «Bee FarmTo order today». */}
          {/* ⚠️ THE SPACES ARE OUTSIDE THE SPANS: a space that opens a nested span is dropped from the accessible name. */}
          {due || count > 0 ? (
            <>
              {' '}
              <span className={styles.facts}>
                {due ? <span className={styles.dueTag}>{t('ord.dueToday')}</span> : null}
                {due && count > 0 ? ' ' : null}
                {count > 0 ? <span className={styles.count}>{t('ord.itemsCount', { n: count })}</span> : null}
              </span>
            </>
          ) : null}
        </span>
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
      {onOpenSummary === undefined ? null : summaryOffered ? (
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
