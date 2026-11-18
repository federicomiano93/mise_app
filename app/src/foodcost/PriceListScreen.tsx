import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Navigate, useBlocker, useLocation } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { fcMoney } from '@mise/shared/fc-number';
import { itemIsStale, itemsToStore, priceItemOf, readPriceList } from '@mise/shared/price-list';
import type { PriceItem, PriceList } from '@mise/shared/price-list';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useFoodcost } from './FoodcostContext';
import { FOODCOST_PATH } from './foodcostPath';
import { cameFromList, useLeave } from './foodcostNav';
import { PRICE_LIST_OPENER, useHandBack } from './handBack';
import styles from './PriceListScreen.module.css';

// «Listino prenotazioni» (bookings step 2, 18 Nov 2026): the owner ticks which Food cost products the counter may book, and
// PUBLISHES them — one document, `price-list/bookings`, with each ticked product's name and selling price (VAT included) and
// nothing else (shared/src/price-list.ts). The counter's booking editor prices its lines from it.
//
// ⚠️ ONLY WHOEVER RUNS THE PLACE REACHES THIS SCREEN (the rules let only them publish: cardAccess 'manage'); an employee shown
// Food cost who types the address is sent to the list.
// ⚠️ NOTHING REACHES THE COUNTER UNTIL «Pubblica»: ticking is a working copy (P20), and leaving with ticks not published asks.
// A product whose name or price changed after the last publish is marked, so the owner knows to publish again: the counter
// keeps the PUBLISHED price until then.
export function PriceListScreen() {
  const { t } = useT();
  const { canManage, locationId } = useSession();
  const services = useDataServices();
  const { productsLoaded } = useFoodcost();
  const [published, setPublished] = useState<PriceList | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canManage || !locationId) return undefined;
    return services.foodcost(locationId).watchPriceList(
      data => { setPublished(readPriceList(data)); setFailed(false); },
      () => { setFailed(true); },
    );
  }, [canManage, locationId, services]);

  if (!canManage) return <Navigate to={FOODCOST_PATH} replace state={KEEP_FOCUS} />;
  if (!productsLoaded || (published === null && !failed)) {
    return (
      <section className={styles.screen} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return <PriceListForm published={published ?? { items: [], publishedAtMs: null }} readFailed={failed} />;
}

function PriceListForm({ published, readFailed }: { published: PriceList; readFailed: boolean }) {
  const { t, locale } = useT();
  const { products } = useFoodcost();
  const { locationId } = useSession();
  const services = useDataServices();
  const money = useMoney();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const [confirm, confirmDialog] = useConfirm();
  const { state } = useLocation();
  const ids = useId();
  const title = useRef<HTMLHeadingElement>(null);

  // What each product would be on the list NOW, A→Z; the products that cannot be (no selling price, no «sold by») are counted.
  const { items, unpriced } = useMemo(() => {
    const all = products.map(product => priceItemOf(product));
    const priced = all.filter((item): item is PriceItem => item !== null).sort((a, b) => a.name.localeCompare(b.name, locale));
    return { items: priced, unpriced: all.length - priced.length };
  }, [products, locale]);
  const publishedById = useMemo(() => new Map(published.items.map(item => [item.productId, item])), [published]);
  const currentById = useMemo(() => new Map(items.map(item => [item.productId, item])), [items]);

  // The working copy: the ticks, copied ONCE from the published list (a colleague publishing meanwhile never moves a tick under
  // somebody's finger).
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(published.items.map(item => item.productId)));
  const chosen = items.filter(item => ticked.has(item.productId));
  // Unpublished: the ticks differ from what is published, or a ticked product's name or price changed since.
  const differs = chosen.length !== published.items.length
    || chosen.some(item => { const was = publishedById.get(item.productId); return was === undefined || itemIsStale(was, item); });
  const dirty = differs;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leavingClean = useRef(false);
  // Published products no longer on the list of priced products (deleted, price removed): the next publish drops them.
  const gone = published.items.filter(item => !currentById.has(item.productId)).length;

  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Opened from the list, the page leaves the focus alone (FROM_LIST): it goes to this title.
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const onLeaving = useCallback(() => { handBack.expect(PRICE_LIST_OPENER); }, [handBack]);
  const leave = useLeave(FOODCOST_PATH, onLeaving);

  const discardQuestion = useCallback(() => confirm({
    title: t('fc.discardChanges'),
    message: t('fc.priceList.discardBody'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  // Every way out goes through the router's blocker (the browser's Back, a product picked beside, the rail).
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const askingLeave = useRef(false);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked' || askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else { handBack.forget(); current.reset(); }
      } finally {
        askingLeave.current = false;
      }
    })();
  });

  const asking = useRef(false);
  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF (FoodcostSettings says why: the blocker fails silently on a POP to an entry it did not make).
  async function back() {
    if (asking.current || askingLeave.current) return;
    if (dirtyRef.current) {
      asking.current = true;
      try {
        if (!(await discardQuestion()) || !mounted.current) return;
      } finally {
        asking.current = false;
      }
      leavingClean.current = true;
    }
    leave();
  }

  function toggle(id: string) {
    setTicked(before => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function publish() {
    if (asking.current || askingLeave.current) return;
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('fc.priceList.publishQ'),
        message: t('fc.priceList.publishBody', { n: chosen.length }),
        okLabel: t('fc.priceList.publish'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current || !locationId) return;
    } finally {
      asking.current = false;
    }
    // Never awaited (local-first): Firestore shows the new list at once and sends it when it can; only a refusal is said.
    services.foodcost(locationId).publishPriceList(itemsToStore(chosen)).catch((err: unknown) => {
      console.error('Publishing the price list failed:', err);
      say(t('fc.priceList.notPublished'), 5000);
    });
    say(t('fc.priceList.published'));
  }

  const priceText = (item: PriceItem): string => {
    const amount = fcMoney(item.price, money);
    if (item.per === 'kg') return t('fc.priceList.perKg', { price: amount });
    if (item.per === 'piece') return t('fc.priceList.perPiece', { price: amount });
    const size = `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(item.packSize ?? 0)} ${item.packUnit === 'pcs' ? t('bookings.unit.pcs') : item.packUnit ?? ''}`;
    return t('fc.priceList.perPack', { price: amount, size });
  };

  const when = published.publishedAtMs === null
    ? t('fc.priceList.never')
    : t('fc.priceList.publishedOn', {
      date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(published.publishedAtMs),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(published.publishedAtMs),
      n: published.items.length,
    });

  return (
    <section className={styles.screen} aria-labelledby={`${ids}-title`}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t('fc.priceList.title')}
        titleId={`${ids}-title`}
        titleRef={title}
        sub={<span className={styles.dirty} data-dirty={dirty ? 'true' : undefined} aria-live="polite">{dirty ? t('fc.priceList.unpublished') : ''}</span>}
        action={<Button variant="primary" className={styles.publish} onPress={() => { void publish(); }}>{t('fc.priceList.publish')}</Button>}
      />
      <div className={styles.body}>
        <p className={styles.intro}>{t('fc.priceList.intro')}</p>
        <p className={styles.when}>{when}</p>
        {readFailed ? <p className={styles.warn}>{t('fc.priceList.readFailed')}</p> : null}
        {gone > 0 ? <p className={styles.warn}>{t('fc.priceList.gone', { n: gone })}</p> : null}
        {items.length === 0 ? (
          <p className={styles.empty}>{t('fc.priceList.none')}</p>
        ) : (
          <ul className={styles.rows} aria-label={t('fc.priceList.title')}>
            {items.map(item => {
              const was = publishedById.get(item.productId);
              const changed = was !== undefined && itemIsStale(was, item);
              return (
                <li key={item.productId}>
                  <label className={styles.row} data-checked={ticked.has(item.productId) ? 'true' : undefined}>
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={ticked.has(item.productId)}
                      onChange={() => { toggle(item.productId); }}
                    />
                    <span className={styles.text}>
                      <span className={styles.name}>{item.name}</span>
                      <span className={styles.price}>{priceText(item)}</span>
                      {changed ? <span className={styles.changed}>{t('fc.priceList.changed', { price: fcMoney(was.price, money) })}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {unpriced > 0 ? <p className={styles.hint}>{t('fc.priceList.unpriced', { n: unpriced })}</p> : null}
      </div>
      {confirmDialog}
    </section>
  );
}
