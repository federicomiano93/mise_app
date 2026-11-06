import { useCallback, useMemo, useRef, useState } from 'react';
import { wholeNumber } from '@mise/shared/archive';
import { fromOrdersList, ingredientCardAddress } from '@mise/shared/records-link';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { tabOfLine, useCardDoors } from './CardDoors';
import { NoticesPanel } from './NoticesPanel';
import { OrderLine } from './OrderLine';
import { OrdersFilter } from './OrdersFilter';
import { OrdersHead } from './OrdersHead';
import { useOrders, useOrdersStore } from './OrdersContext';
import { flatView, isShownLine, notInUseLines, orderedIds } from './flatView';
import type { FlatLine } from './flatView';
import type { OrdersLens } from './ordersLens';
import styles from './IngredientsList.module.css';

type Props = {
  // The LIVE lens: this view has no copy of the lists to draw from, so before `ready` it only says it is loading.
  lens: OrdersLens;
  ready: boolean;
  // Drawn only at list level: with a screen open beside the list the swap's place is kept, empty.
  swapOpen: boolean;
  onSwap: () => void;
  onSend: () => void;
  onSettings: () => void;
  onHistory: () => void;
  // The bell's panel (it shows only when the bell opens it) acts from here exactly as from the supplier list.
  onOpenSupplier: (id: string) => void;
  onOpenPending: (id: string, day: string) => void;
  // What the view starts with when Back brings the person from a card (cardTrip.ts): the search text and the frozen «Ordering» set.
  initial?: { readonly query: string; readonly only: readonly string[] | null };
};

// The flat view, «by ingredient» (step 3f-8b, parity L17, L18, L21): every ingredient of every supplier in ONE A→Z list, each row
// naming the supplier it is ordered from, with the search box and the All / Ordering filter on top. There is no second list of
// quantities: a row is the very line of a supplier's screen (OrderLine), written through the same store call.
//
// ⚠️ ITS SEARCH TEXT AND ITS FILTER ARE ITS OWN, not the supplier list's, and NOT REMEMBERED: leaving the view (or the section)
// ends them. The box is a controlled input in a component that stays mounted (OrdersHead), so a snapshot never remounts it.
export function IngredientsList({ lens, ready, swapOpen, onSwap, onSend, onSettings, onHistory, onOpenSupplier, onOpenPending, initial }: Props) {
  const { t } = useT();
  const store = useOrdersStore();
  const snapshot = useOrders();
  const entries = snapshot.draft.entries;
  const showStock = snapshot.config.showStock;
  const [query, setQuery] = useState(initial?.query ?? '');
  const doors = useCardDoors();
  // ⚠️ THE FROZEN SET: choosing «Ordering» takes the ids with a quantity AT THAT MOMENT and keeps them, so a line taken to 0 does
  // not vanish from under the finger correcting it. Choosing «Ordering» again refreshes the set; «All» drops it. null = «All».
  const [frozen, setFrozen] = useState<ReadonlySet<string> | null>(() => (initial?.only ? new Set(initial.only) : null));

  const view = useMemo(() => flatView(lens, { query, only: frozen }), [lens, query, frozen]);
  const off = useMemo(() => notInUseLines(lens, { query, only: frozen }), [lens, query, frozen]);
  // Whether there is any line at all, whatever the search says: «No ingredients yet» is never said because of a search.
  const anyOff = useMemo(() => notInUseLines(lens, { query: '', only: null }).length > 0, [lens]);
  // Lines with a quantity NOW, live (switched-off ones included): the «Ordering (N)» count.
  const ordering = useMemo(() => orderedIds(lens, entries).size, [lens, entries]);
  const hasQty = (line: FlatLine): boolean => wholeNumber(entries[line.row.ingredient.id]?.qty) > 0;
  // ⚠️ «NOT IN USE» IS CLOSED, BUT OPEN WHEN ONE OF ITS ROWS HAS A QUANTITY: a line switched off with a quantity is in the order
  // (decision T10) and must not hide.
  const group = useFoldedOpen(off.some(hasQty));

  // The head's and the column names' heights: the column names stick right under the head, the letters right under the column names.
  const headHeight = useHeight();
  const columnsHeight = useHeight();

  // Nothing typed anywhere: there is no «just what I'm ordering» to offer — unless it is on (it must be possible to leave it).
  const showFilter = ready && (ordering > 0 || frozen !== null);
  const choose = (only: boolean) => { setFrozen(only ? orderedIds(lens, entries) : null); };

  // Four whole phrases, never a count with « in this order» glued on: Italian puts the words elsewhere.
  // In «Ordering» the lines switched off that are in the set stand in the group at the foot, so they are counted as shown too.
  const shown = view.rows.length + (frozen === null ? 0 : off.length);
  const scope = frozen === null ? view.total : lens.lines.filter(line => frozen.has(line.id) && isShownLine(lens, line)).length;
  const countText = frozen === null
    ? (shown === scope ? t('ord.ingredientsCount', { n: scope }) : t('ord.flat.shown', { shown, n: scope }))
    : (shown === scope ? t('ord.flat.countInOrder', { n: scope }) : t('ord.flat.shownInOrder', { shown, n: scope }));

  const lineOf = (line: FlatLine) => (
    <OrderLine
      key={line.row.ingredient.id}
      row={line.row}
      entry={entries[line.row.ingredient.id]}
      showStock={showStock}
      hint={snapshot.suggester.hint(line.row.ingredient, entries[line.row.ingredient.id])}
      supplierName={line.supplierName}
      doorIn="flat"
      onOpenCard={doors.may ? row => {
        doors.open({
          address: ingredientCardAddress(row.ingredient.id),
          state: fromOrdersList(tabOfLine(row.ingredient)),
          target: { kind: 'name', ingredientId: row.ingredient.id, in: 'flat' },
          flat: { query, only: frozen === null ? null : [...frozen] },
        });
      } : undefined}
      onEdit={(edited, edit) => { store.editLine(line.supplier, edited.ingredient, edit); }}
    />
  );

  // The rows in runs, one per letter: the letter sticks under the column names while ITS rows scroll, then the next one takes over.
  const runs: { key: string; letter: string; lines: FlatLine[] }[] = [];
  const seen = new Map<string, number>();
  for (const line of view.rows) {
    if (line.letter !== '' || runs.length === 0) {
      const again = seen.get(line.letter) ?? 0;
      seen.set(line.letter, again + 1);
      runs.push({ key: `${line.letter}-${again}`, letter: line.letter, lines: [] });
    }
    runs[runs.length - 1]?.lines.push(line);
  }

  const nothingAtAll = view.total === 0 && !anyOff;
  const nothingShown = view.rows.length === 0 && off.length === 0;

  // ⚠️ `data-flat-view` IS THE DRIVERS' HOOK: the emulator drivers find the flat view by it. Nothing in the app reads it.
  return (
    <div className={styles.root} data-flat-view="">
      <OrdersHead
        view="ingredients"
        label={t('ord.searchAnIngredient')}
        query={query}
        onQuery={setQuery}
        ready={ready}
        hasSuppliers={lens.suppliers.length > 0}
        swapOpen={swapOpen}
        onSwap={onSwap}
        onSend={onSend}
        onSettings={onSettings}
        onHistory={onHistory}
        headRef={headHeight.ref}
      >
        {showFilter ? (
          <OrdersFilter
            label={t('ord.whichIngredients')}
            ordering={frozen !== null}
            allText={t('ord.filter.all', { n: view.total })}
            orderingText={t('ord.filter.ordering', { n: ordering })}
            onChoose={choose}
          />
        ) : null}
      </OrdersHead>

      {/* The bell is in the page's bar on the split whatever the list column holds, so its panel must be here too. Only the always-on blocks
          (today's orders, the debt doors, the order lists) stay on the supplier view (F-4). */}
      <PartBoundary>
        <NoticesPanel onOpenSupplier={onOpenSupplier} onOpenPending={onOpenPending} onSend={onSend} />
      </PartBoundary>

      {!ready ? (
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      ) : (
        <>
          <p className={styles.count}>{countText}</p>
          {nothingAtAll ? (
            <p className={styles.nothing}>{t('ord.flat.noIngredients')}</p>
          ) : nothingShown ? (
            <p className={styles.nothing}>{frozen !== null ? t('ord.flat.nothingInOrder') : t('ord.flat.noMatch')}</p>
          ) : (
            <div className={styles.sheet}>
              {view.rows.length === 0 ? null : (
                <div ref={columnsHeight.ref} className={styles.columns} data-stock={showStock} style={{ top: headHeight.px }}>
                  <span />
                  <span className={styles.columnName}>{t('ord.field.order')}</span>
                  {showStock ? <span className={styles.columnName}>{t('ord.field.stock')}</span> : null}
                </div>
              )}
              {runs.map(run => (
                <div key={run.key} className={styles.run}>
                  <h2 className={styles.letter} style={{ top: headHeight.px + columnsHeight.px }}>{run.letter}</h2>
                  <ul className={styles.rows}>{run.lines.map(lineOf)}</ul>
                </div>
              ))}
              {off.length > 0 ? (
                <div className={styles.folded}>
                  <FoldedGroup title={t('ord.notInUseGroup', { n: off.length })} open={group.open} onToggle={group.onToggle}>
                    <ul className={styles.rows}>{off.map(lineOf)}</ul>
                  </FoldedGroup>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// A box's height in CSS pixels, kept current as it changes (the pattern of SupplierOrderScreen). The observer is ended when the box goes
// (L21: it holds the node it watches, so one left running would pin a dead view and keep setting state of a screen that is gone).
function useHeight(): { ref: (node: HTMLElement | null) => void; px: number } {
  const [px, setPx] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (node === null) return;
    const measure = () => { setPx(node.getBoundingClientRect().height); };
    measure();
    if (typeof ResizeObserver === 'function') {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    }
  }, []);
  return { ref, px };
}
