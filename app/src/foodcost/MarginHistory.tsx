import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { formatMoney, formatRate } from '@mise/shared/price-model';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { KEEP_FOCUS } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useFoodcost, useFoodcostStore } from './FoodcostContext';
import { productPath } from './foodcostPath';
import type { Origin } from './foodcostPath';
import { cameFromList, cameFromProduct } from './foodcostNav';
import { percentText } from './productRowModel';
import type { StoredDoc } from './foodcostSource';
import styles from './MarginHistory.module.css';

type Loaded =
  | { readonly id: string; readonly status: 'ready'; readonly entries: readonly StoredDoc[] }
  | { readonly id: string; readonly status: 'failed' };

// A product's margin history: each point the food cost, what it cost, what it sold for, and when —
// and, said out loud, that a point exists only where somebody changed something.
//
// ⚠️ READ ONCE, ON DEMAND, NEVER WATCHED (parity 17): a point is added by a save, and a save returns
// to the list. A read still in the air when the screen goes away, or when another product's history
// is asked for, is dropped — its answer must not land on the wrong product.
export function MarginHistory({ id, origin }: { id: string; origin: Origin }) {
  const { t, locale } = useT();
  const money = useMoney();
  const navigate = useNavigate();
  const { state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const store = useFoodcostStore();
  const { products } = useFoodcost();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.getProductHistory(id).then(
      entries => { if (!cancelled) setLoaded({ id, status: 'ready', entries }); },
      (error: unknown) => {
        console.error('Could not read the margin history:', error);
        if (!cancelled) setLoaded({ id, status: 'failed' });
      },
    );
    return () => { cancelled = true; };
  }, [store, id]);

  // Opened from the product (or from the list), the page does not move the focus: it goes here.
  useEffect(() => {
    if (cameFromProduct(state) || cameFromList(state)) title.current?.focus();
  }, []);

  // One level up is the product. On a phone it was opened from the product, so Back is the
  // browser's Back; on the split, or by its address, there is no product entry behind it, so the
  // product takes its place.
  const leave = () => {
    if (!split && cameFromProduct(state)) void navigate(-1);
    else void navigate(productPath(id, origin), { replace: true, state: split ? state : KEEP_FOCUS });
  };

  const product = products.find(candidate => candidate.id === id);
  const name = product?.name ?? '';
  const current = loaded !== null && loaded.id === id ? loaded : null;

  return (
    <section className={styles.history} aria-labelledby={titleId} aria-busy={current === null}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('fc.marginHistory')}
        titleId={titleId}
        titleRef={title}
        sub={<p className={styles.sub}>{name === '' ? t('fc.productWord') : name}</p>}
      />

      <div className={styles.body}>
        {current === null ? (
          <p className={styles.note}>{t('session.loading')}</p>
        ) : current.status === 'failed' ? (
          <p className={styles.note}>{t('fc.couldNotLoadThe')}</p>
        ) : current.entries.length === 0 ? (
          <p className={styles.note}>{t('fc.nothingRecordedYetA')}</p>
        ) : (
          <>
            <ul className={styles.rows}>
              {current.entries.map(entry => (
                <li key={entry.id} className={styles.row}>
                  <span className={styles.pct}>
                    {typeof entry.foodCostPct === 'number' ? percentText(entry.foodCostPct, locale) : '—'}
                  </span>
                  <span className={styles.detail}>
                    {t('fc.histDetail', {
                      cost: typeof entry.unitCost === 'number' ? formatRate(entry.unitCost, money) : '—',
                      price: typeof entry.sellingPrice === 'number' ? formatMoney(entry.sellingPrice, money) : '—',
                      vat: typeof entry.vatRate === 'number' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(entry.vatRate) : '—',
                    })}
                  </span>
                  <span className={styles.when}>{dateText(entry.recordedAt, locale)}</span>
                </li>
              ))}
            </ul>
            {/* ⚠️ SAID OUT LOUD, because the gap is invisible otherwise: ingredient prices drifting
                leave no mark here, so a flat line does not mean a flat margin. */}
            <p className={styles.note}>{t('fc.aPointIsRecorded')}</p>
          </>
        )}
      </div>
    </section>
  );
}

// «14 Oct 2026» in the interface language: day numeric, month short, year numeric.
function dateText(iso: unknown, locale: string): string {
  const date = new Date(String(iso ?? ''));
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
