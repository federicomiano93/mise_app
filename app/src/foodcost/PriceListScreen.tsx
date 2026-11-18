import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Navigate, useBlocker, useLocation } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { fcMoney } from '@mise/shared/fc-number';
import { localNumber } from '@mise/shared/currency';
import { itemIsStale, itemsToStore, priceItemOf, readPriceList, sharedNames } from '@mise/shared/price-list';
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
  // ⚠️ ONLY THE SERVER'S ANSWER OPENS THE FORM (review, 18 Nov 2026). The ticks are copied once from what is published: a copy
  // taken from this device's own database — empty on a phone that never read the list, offline — would offer «Never published»
  // with nothing ticked, and a Publish would replace the counter's real list. So the form waits for the server, and without it
  // says so instead of drawing anything that could be published (the labour rate's own rule: foodcostStore.ts settingsLoaded).
  const [published, setPublished] = useState<PriceList | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canManage || !locationId) return undefined;
    return services.foodcost(locationId).watchPriceList(
      (data, meta) => {
        if (!meta.fromServer) return;
        setPublished(readPriceList(data));
        setFailed(false);
      },
      () => { setFailed(true); },
    );
  }, [canManage, locationId, services]);

  if (!canManage) return <Navigate to={FOODCOST_PATH} replace state={KEEP_FOCUS} />;
  if (!productsLoaded || published === null) {
    return (
      <section className={styles.screen} aria-busy={!failed}>
        <p className={styles.loading}>{failed ? t('fc.priceList.readFailed') : t('fc.priceList.waiting')}</p>
      </section>
    );
  }
  return <PriceListForm published={published} />;
}

function PriceListForm({ published }: { published: PriceList }) {
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
  const [startTicks, setStartTicks] = useState<ReadonlySet<string>>(() => new Set(published.items.map(item => item.productId)));
  const [ticked, setTicked] = useState<ReadonlySet<string>>(startTicks);
  const chosen = items.filter(item => ticked.has(item.productId));
  // «Not published yet»: what the counter sees is not what this screen would publish — the ticks differ from the published list,
  // or a ticked product's name or price changed in Food cost since.
  const needsPublish = chosen.length !== published.items.length
    || chosen.some(item => { const was = publishedById.get(item.productId); return was === undefined || itemIsStale(was, item); });
  // ⚠️ «Unsaved» is narrower: only ticks THIS PERSON changed. A price changed elsewhere is something to publish, not something to
  // lose by leaving, so it neither holds the app's busy marker nor asks «Discard changes?» (review, 18 Nov 2026).
  const dirty = ticked.size !== startTicks.size || [...ticked].some(id => !startTicks.has(id));
  // Two ticked products with the same name: the counter could book only the first, so Publish refuses them together.
  const clashes = sharedNames(chosen);
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
    if (clashes.length > 0) {
      say(t('fc.priceList.clash', { names: clashes.join(', ') }), 5000);
      return;
    }
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
    // Published: what is ticked now is the new start, so nothing is unsaved and leaving asks nothing.
    dirtyRef.current = false;
    setStartTicks(new Set(ticked));
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
    // The pack's size in the venue's own number layout, as every Food cost figure.
    const size = `${localNumber(String(item.packSize ?? 0), money)} ${item.packUnit === 'pcs' ? t('fc.unit.pieces') : item.packUnit ?? ''}`;
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
        sub={<span className={styles.dirty} data-dirty={needsPublish ? 'true' : undefined} aria-live="polite">{needsPublish ? t('fc.priceList.unpublished') : ''}</span>}
        action={<Button variant="primary" className={styles.publish} onPress={() => { void publish(); }}>{t('fc.priceList.publish')}</Button>}
      />
      <div className={styles.body}>
        <p className={styles.intro}>{t('fc.priceList.intro')}</p>
        <p className={styles.when}>{when}</p>
        {clashes.length > 0 ? <p className={styles.warn}>{t('fc.priceList.clash', { names: clashes.join(', ') })}</p> : null}
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
