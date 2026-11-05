import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronRight, List, Search, Settings, Share } from 'lucide-react';
import { spellShortDate, todayISO } from '@mise/shared/day';
import { isFutureDay, nextDeliveryAfter } from '@mise/shared/order-day';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOrders } from './OrdersContext';
import { dayTranslate, deliveryDaysText } from './dayWords';
import { CLEAR_OPENER, PLACE_ALL_OPENER, SEND_OPENER, SETTINGS_OPENER, itemsOpener, supplierOpener, useHandBack } from './handBack';
import { orderingCount, supplierListGroups } from './ordersLens';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import styles from './OrdersList.module.css';

type Props = {
  lens: OrdersLens;
  // Suppliers, ingredients and the draft have all arrived (or failed): before that nothing may say «no suppliers» (parity L8).
  ready: boolean;
  // The supplier open beside the list (the tablet's split), marked as the current one.
  openId: string | null;
  onOpenSupplier: (id: string) => void;
  onOpenItems: (id: string) => void;
  // The two buttons under the list: the picker of the suppliers to record together, and the one to clear.
  onPlaceAll: () => void;
  onClearAll: () => void;
  // The arrow beside the search box: the send screen.
  onSend: () => void;
  // The gear at the end of the head: the Orders settings (step 3f-4).
  onSettings: () => void;
};

const HEADING_KEY = {
  'orders.favourites.title': 'ord.favourites.title',
  'orders.favourites.others': 'ord.favourites.others',
} as const satisfies Record<string, MessageKey>;

// The left column: the search box and the All / Ordering filter (they stay put while the rows scroll), over the suppliers.
//
// ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT: it is a controlled input in a component that stays mounted, and
// only the rows below it are redrawn, so a snapshot landing mid-keystroke finds the text and the keyboard where the person
// left them (the current app built the box once for the same reason).
export function OrdersList({ lens, ready, openId, onOpenSupplier, onOpenItems, onPlaceAll, onClearAll, onSend, onSettings }: Props) {
  const { t } = useT();
  const { config, draft, suppliersBroken, ingredientsBroken } = useOrders();
  const [query, setQuery] = useState('');
  const [orderingOnly, setOrderingOnly] = useState(false);
  const radios = useRef(new Map<boolean, HTMLButtonElement>());
  const handBack = useHandBack();
  // Back from a picker hands the focus back to the button that opened it.
  const placeAllNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(PLACE_ALL_OPENER, node); }, [handBack]);
  const clearNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(CLEAR_OPENER, node); }, [handBack]);
  const sendNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SEND_OPENER, node); }, [handBack]);
  const settingsNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);

  const ordering = orderingCount(lens);
  const groups = useMemo(
    () => supplierListGroups(lens, { query, orderingOnly, favourites: config.favouriteSuppliers }),
    [lens, query, orderingOnly, config.favouriteSuppliers],
  );
  const shown = groups.reduce((n, group) => n + group.suppliers.length, 0);
  const broken = suppliersBroken || ingredientsBroken;

  // Nothing typed anywhere: there is no «just what I'm ordering» to offer — unless it is on (it must be possible to leave it).
  const showFilter = ordering > 0 || orderingOnly;
  function chooseFilter(only: boolean) {
    setOrderingOnly(only);
    radios.current.get(only)?.focus();
  }
  function onRadioKey(event: KeyboardEvent<HTMLButtonElement>, only: boolean) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      chooseFilter(!only);
    }
  }

  const today = todayISO();
  const dt = dayTranslate(t);

  return (
    <div className={styles.column}>
      <div className={styles.head}>
        <div className={styles.top}>
          <div className={styles.search}>
            <Search aria-hidden="true" />
            <input
              type="search"
              autoComplete="off"
              className={styles.input}
              aria-label={t('ord.searchASupplier')}
              placeholder={t('ord.searchASupplier')}
              value={query}
              onChange={event => { setQuery(event.target.value); }}
            />
          </div>
          {/* ⚠️ AN ARROW OUT OF A TRAY, NOT A WHATSAPP MARK: the screen it opens offers several roads. Here only once the list
              is ready and has suppliers, so it never offers to send what has not arrived. */}
          {ready && lens.suppliers.length > 0 ? (
            <Button ref={sendNode} className={styles.send} onPress={onSend}>
              <Share aria-hidden="true" />
              {t('ord.send.action')}
            </Button>
          ) : null}
          {/* Always there, even with no supplier yet: the settings are not about the suppliers. */}
          <Button ref={settingsNode} className={styles.gear} aria-label={t('ord.settings.open')} onPress={onSettings}>
            <Settings aria-hidden="true" />
          </Button>
        </div>
        {showFilter ? (
          <div role="radiogroup" aria-label={t('ord.whichSuppliers')} className={styles.filter}>
            {([false, true] as const).map(only => (
              <button
                key={String(only)}
                ref={node => {
                  if (node) radios.current.set(only, node);
                  else radios.current.delete(only);
                }}
                type="button"
                role="radio"
                aria-checked={orderingOnly === only}
                tabIndex={orderingOnly === only ? 0 : -1}
                className={styles.radio}
                onClick={() => { setOrderingOnly(only); }}
                onKeyDown={event => { onRadioKey(event, only); }}
              >
                {only ? t('ord.filter.ordering', { n: ordering }) : t('ord.filter.all', { n: lens.suppliers.length })}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!ready ? (
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      ) : lens.suppliers.length === 0 ? (
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
                const filled = lens.filledFor(supplier.id);
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
                    onOpenSupplier={onOpenSupplier}
                    onOpenItems={onOpenItems}
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
  onOpenSupplier: (id: string) => void;
  onOpenItems: (id: string) => void;
};

// ⚠️ TWO BUTTONS, NOT ONE WITH SOMETHING CLICKABLE INSIDE IT: a button in a button is invalid, and a tap on the inner one ran
// the outer one's handler too. The row is a plain container holding two siblings: the wide one opens the order, the narrow
// one opens the read-only list of what the supplier sells.
function SupplierRow({ supplier, meta, count, tag, isOpen, onOpenSupplier, onOpenItems }: RowProps) {
  const { t } = useT();
  const handBack = useHandBack();
  const id = supplier.id;
  const label = supplierLabel(supplier);
  // Back from the supplier's screen hands the focus back to its button; so does Back from «What they sell».
  const openNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(supplierOpener(id), node); }, [handBack, id]);
  const itemsNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(itemsOpener(id), node); }, [handBack, id]);
  return (
    <li className={styles.item} data-open={isOpen}>
      <button
        ref={openNode}
        type="button"
        className={styles.open}
        aria-current={isOpen ? 'true' : undefined}
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
    </li>
  );
}
