import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { ToggleButton } from 'react-aria-components';
import { consumption, isClosed, productsOfMonth, progressOf } from '@mise/shared/inventory-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { groupProducts, matches, stillToCount } from './countListModel';
import { ProductRow } from './ProductRow';
import { useStocktake } from './StocktakeContext';
import styles from './CountList.module.css';

type Props = {
  // The month in the address. The list draws the store's month only once it is this one.
  monthId: string;
  // The product open beside the list, if any.
  openProductId: string | null;
  onOpenProduct: (id: string) => void;
  // The two fill-in actions. «Carry forward» is the manager's alone: no handler, no button.
  onCarry: (() => void) | undefined;
  onPurchases: () => void;
};

const NO_STAY: ReadonlySet<string> = new Set();

// The month's counting list: how far the count has got, the two fill-in actions, the search and
// «Still to count», and the products grouped by category with a count box on every row.
//
// Keyed by the month by its parent: another month is a new list, with a new search, never this one
// with its boxes pointed somewhere else.
export function CountList({ monthId, openProductId, onOpenProduct, onCarry, onPurchases }: Props) {
  const { t, locale } = useT();
  const snapshot = useStocktake();
  const { month, ingredients, ingredientsLoaded, monthLoaded } = snapshot;
  const headings = useId();

  const [query, setQuery] = useState('');
  const [onlyTodo, setOnlyTodo] = useState(false);
  // ⚠️ THE ROWS «STILL TO COUNT» HAS SHOWN SINCE THE LAST SEARCH OR PRESS (see stillToCount). Only
  // ever added to while it is on, emptied by a search or a press.
  const [stay, setStay] = useState<ReadonlySet<string>>(NO_STAY);

  // The products of the month on screen. The store answers one render late after the address
  // changes; until it names this month there is nothing to draw it from.
  const ready = snapshot.monthId === monthId && month !== null;
  const products = useMemo(
    () => (ready ? productsOfMonth(month, ingredients) : []),
    [ready, month, ingredients],
  );

  const boxes = useRef(new Map<string, HTMLInputElement>());
  const register = useCallback((id: string, node: HTMLInputElement | null) => {
    if (node) boxes.current.set(id, node);
    else boxes.current.delete(id);
  }, []);

  if (!ready) return <p className={styles.loading}>{t('session.loading')}</p>;

  const closed = isClosed(month);
  const progress = progressOf(month, products.map(product => product.id));

  const matching = products.filter(product => matches(product, query));
  const shown = onlyTodo
    ? stillToCount(matching, stay, id => consumption(month, id).counted)
    : matching;
  // ⚠️ ADJUSTED WHILE DRAWING, not in an effect (the same pattern as the open row of Pastries): a
  // row the filter has shown joins `stay` in the very render that shows it, so there is no frame
  // in which a row counted a moment later could have been dropped.
  if (onlyTodo && shown.some(product => !stay.has(product.id))) {
    setStay(new Set([...stay, ...shown.map(product => product.id)]));
  }

  const groups = groupProducts(shown, locale);
  const order = groups.flatMap(group => group.products.map(product => product.id));

  // Enter in a box moves to the next VISIBLE row's box; the last one just commits.
  const focusAfter = (id: string) => {
    const at = order.indexOf(id);
    const next = at < 0 ? undefined : order[at + 1];
    if (next !== undefined) boxes.current.get(next)?.focus();
  };

  const search = (text: string) => {
    setQuery(text);
    setStay(NO_STAY);
  };
  const toggle = (on: boolean) => {
    setOnlyTodo(on);
    setStay(NO_STAY);
  };

  // The boxes shut for a closed month, and until the month has answered once: a count must never
  // be written into a month that turns out to be closed (stocktakeStore.ts).
  const shut = closed || !monthLoaded;

  return (
    <div className={styles.list}>
      <div className={styles.summary}>
        <p className={styles.summaryLabel}>{t('stock.counted')}</p>
        <p className={styles.summaryValue}>
          {ingredientsLoaded ? t('stock.countedOf', { counted: progress.counted, total: progress.total }) : '—'}
        </p>
        <p className={styles.summaryNote}>{closed ? t('stock.monthClosedNote') : t('stock.emptyIsNotZero')}</p>
      </div>

      {closed ? null : (
        <div className={styles.actions}>
          {onCarry ? <Button onPress={onCarry}>{t('stock.carryShort')}</Button> : null}
          <Button onPress={onPurchases}>{t('stock.purchasesShort')}</Button>
        </div>
      )}

      <div className={styles.tools}>
        <input
          type="search"
          autoComplete="off"
          className={styles.search}
          aria-label={t('stock.searchProducts')}
          placeholder={t('stock.searchProducts')}
          value={query}
          onChange={event => { search(event.target.value); }}
        />
        <ToggleButton className={styles.filter} isSelected={onlyTodo} onChange={toggle}>
          {t('stock.stillToCount')}
        </ToggleButton>
      </div>

      {!ingredientsLoaded ? (
        <p className={styles.loading}>{t('session.loading')}</p>
      ) : groups.length === 0 ? (
        // A search or the filter that matches nothing stays a small line; a venue with NO products
        // at all is the empty state, with no button: the products come from Suppliers.
        query.trim() !== '' || onlyTodo ? (
          <p className={styles.nothing}>{t('stock.nothingMatches')}</p>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{t('stock.empty.title')}</p>
            <p className={styles.emptySub}>{t('stock.empty.sub')}</p>
          </div>
        )
      ) : (
        groups.map((group, index) => {
          const headingId = `${headings}-${index}`;
          return (
            // A group, not a landmark: a venue has a dozen categories, and a region each would bury
            // the page's real landmarks.
            <div key={group.category} role="group" aria-labelledby={headingId} className={styles.group}>
              <h3 id={headingId} className={styles.groupName}>{group.category || t('stock.noCategory')}</h3>
              <ul className={styles.rows}>
                {group.products.map(product => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    month={month}
                    shut={shut}
                    isOpen={product.id === openProductId}
                    onOpen={() => { onOpenProduct(product.id); }}
                    register={register}
                    onEnter={() => { focusAfter(product.id); }}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
