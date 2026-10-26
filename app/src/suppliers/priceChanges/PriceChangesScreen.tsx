import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { ToggleButton } from 'react-aria-components';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { periodContains, periodLabel, periodOf, shiftPeriod, summarize } from '@mise/shared/price-changes-model';
import type { Period } from '@mise/shared/price-changes-model';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useDataServices } from '../../data/DataContext';
import { localeOf } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/useT';
import { useSession } from '../../session/SessionContext';
import { useMoney } from '../../session/useMoney';
import { Button } from '../../ui/Button';
import { FormBar } from '../../ui/FormBar';
import { PRICE_CHANGES_OPENER, useHandBack } from '../handBack';
import { pricePerUnitText } from '../priceText';
import { useSuppliers } from '../SuppliersContext';
import { cameFromList, useLeave } from '../suppliersNav';
import { SUPPLIERS_PATH } from '../suppliersPath';
import type { StoredDoc } from '../suppliersSource';
import styles from './PriceChangesScreen.module.css';

// «Price changes»: how supplier prices moved, by week or by month, biggest increases first. A port of
// js/orders/price-changes-screen.js (parity I101–I112). READ-ONLY: the changes are written by the invoice import; this screen
// reads the period on show and draws it, and it holds no edits (no markBusy).
//
// ⚠️ NEVER A FALSE «NO CHANGES» (I103): a read that fails says so and offers a retry; an empty answer from the cache asks for the
// connection; a non-empty one from the cache is flagged. The source (priceChangesSource.ts) does the flagging, this draws it.
// ⚠️ THE SIGN IS ALWAYS TEXT («+10%» / «−4%», U+2212): the colour only repeats it (I111).
// ⚠️ A LATE ANSWER FOR A PERIOD NO LONGER ON SHOW IS DROPPED: every read takes a ticket, and only the newest one may land.

type Body =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly changes: StoredDoc[]; readonly fromCache: boolean };

function todayISO(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// «+10%» / «−4%»: whole percent of the absolute value, the sign in the text.
export function percentText(pct: number): string {
  return `${pct > 0 ? '+' : '−'}${Math.round(Math.abs(pct))}%`;
}

export function PriceChangesScreen() {
  const { t, lang } = useT();
  const { locationId } = useSession();
  if (!locationId) throw new Error('Price changes needs an open venue.');
  const services = useDataServices();
  // Made ONCE when the screen opens: the source belongs to this visit.
  const [source] = useState(() => services.priceChanges(locationId));
  const { weekStartsOn } = useSuppliers();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const leave = useLeave(SUPPLIERS_PATH, () => { handBack.expect(PRICE_CHANGES_OPENER); });

  const [period, setPeriod] = useState<Period>(() => periodOf('month', todayISO(), weekStartsOn));
  const [body, setBody] = useState<Body>({ status: 'loading' });
  // false only when the collection is known to be empty.
  const [anyAtAll, setAnyAtAll] = useState(true);
  const periodNow = useRef(period);
  const ticket = useRef(0);
  // The newest change has been read, so a retry only reloads the period.
  const started = useRef(false);
  // The button under the finger is gone or disabled: the focus is owed to the period label after this render.
  const owesLabel = useRef(false);

  const load = (next: Period) => {
    const mine = ++ticket.current;
    periodNow.current = next;
    setPeriod(next);
    setBody({ status: 'loading' });
    source.listPriceChanges(next.from, next.to).then(
      answer => {
        if (mine !== ticket.current) return;
        setBody({ status: 'ready', changes: answer.docs, fromCache: answer.fromCache });
      },
      (error: unknown) => {
        if (mine !== ticket.current) return;
        console.error('Price changes could not be read:', error);
        setBody({ status: 'error' });
      },
    );
  };

  const start = () => {
    const mine = ++ticket.current;
    setBody({ status: 'loading' });
    source.latestPriceChangeDate().then(
      latest => {
        if (mine !== ticket.current) return;
        setAnyAtAll(latest.date !== '');
        started.current = true;
        load(periodOf(periodNow.current.kind, latest.date || todayISO(), weekStartsOn));
      },
      (error: unknown) => {
        if (mine !== ticket.current) return;
        console.error('The latest price change could not be read:', error);
        setBody({ status: 'error' });
      },
    );
  };

  useEffect(() => {
    start();
    return () => { ticket.current += 1; };
  }, []);

  // Opened from its door the page does not move the focus (FROM_LIST): it goes to this title.
  useEffect(() => {
    if (cameFromList(state) && navigationType !== 'POP') title.current?.focus();
  }, []);

  useEffect(() => {
    if (!owesLabel.current) return;
    owesLabel.current = false;
    label.current?.focus({ preventScroll: true });
  });

  const today = todayISO();
  const holdsToday = periodContains(period, today);

  const setKind = (kind: 'week' | 'month') => {
    if (kind === period.kind) return;
    // The new period holds the day the old one ended on (today, when it holds today), so switching never jumps elsewhere.
    const anchor = holdsToday ? today : period.to;
    load(periodOf(kind, anchor, weekStartsOn));
  };

  const move = (step: number) => {
    const next = shiftPeriod(period, step, weekStartsOn);
    // «Next» is disabled on the period that holds today: the finger's button goes, the label takes the focus.
    if (periodContains(next, today)) owesLabel.current = true;
    load(next);
  };

  const retry = () => {
    owesLabel.current = true;
    if (started.current) load(periodNow.current);
    else start();
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('sup.pc.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        <div role="group" aria-label={t('sup.pc.groupBy')} className={styles.segments}>
          <KindButton kind="week" labelKey="sup.pc.week" current={period.kind} onPick={setKind} />
          <KindButton kind="month" labelKey="sup.pc.month" current={period.kind} onPick={setKind} />
        </div>
        <div className={styles.nav}>
          <Button className={styles.arrow} aria-label={t('sup.pc.previous')} onPress={() => { move(-1); }}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span ref={label} tabIndex={-1} aria-live="polite" className={styles.period}>{periodLabel(period, lang)}</span>
          <Button className={styles.arrow} aria-label={t('sup.pc.next')} isDisabled={holdsToday} onPress={() => { move(1); }}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <Results body={body} anyAtAll={anyAtAll} onRetry={retry} />
      </div>
    </section>
  );
}

function KindButton({ kind, labelKey, current, onPick }: {
  kind: 'week' | 'month'; labelKey: MessageKey; current: string; onPick: (kind: 'week' | 'month') => void;
}) {
  const { t } = useT();
  return (
    <ToggleButton className={styles.segment} isSelected={current === kind} onChange={() => { onPick(kind); }}>
      {t(labelKey)}
    </ToggleButton>
  );
}

function Results({ body, anyAtAll, onRetry }: { body: Body; anyAtAll: boolean; onRetry: () => void }) {
  const { t } = useT();
  if (body.status === 'loading') return <p role="status" className={styles.note}>{t('sup.pc.loading')}</p>;
  if (body.status === 'error') {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <div className={styles.block}>
        <p role="alert" className={styles.error}>{t(offline ? 'sup.pc.offline' : 'sup.pc.error')}</p>
        <Button onPress={onRetry}>{t('sup.pc.retry')}</Button>
      </div>
    );
  }
  const { increases, decreases, counts } = summarize<StoredDoc & { name?: unknown; pct?: unknown }>(body.changes);
  // ⚠️ An empty answer from the cache is not «no changes»: the cache may simply not hold them.
  if (counts.total === 0 && body.fromCache) return <p role="status" className={styles.error}>{t('sup.pc.needConnection')}</p>;
  if (counts.total === 0) {
    return (
      <div className={styles.block}>
        <p className={styles.note}>{t('sup.pc.empty')}</p>
        {anyAtAll ? null : <p className={styles.note}>{t('sup.pc.emptyAll')}</p>}
      </div>
    );
  }
  return (
    <div className={styles.block}>
      {body.fromCache ? <p role="status" className={styles.note}>{t('sup.pc.cacheNote')}</p> : null}
      <p className={styles.summary}>{t('sup.pc.up', { n: counts.increases })} · {t('sup.pc.down', { n: counts.decreases })}</p>
      <Section titleKey="sup.pc.increases" list={increases} />
      <Section titleKey="sup.pc.decreases" list={decreases} />
    </div>
  );
}

function Section({ titleKey, list }: { titleKey: MessageKey; list: StoredDoc[] }) {
  const { t } = useT();
  if (list.length === 0) return null;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t(titleKey)}</h3>
      <ul className={styles.list}>
        {list.map(change => <Row key={change.id} change={change} />)}
      </ul>
    </section>
  );
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function Row({ change }: { change: StoredDoc }) {
  const { t, lang } = useT();
  const money = useMoney();
  const { suppliers, ingredients } = useSuppliers();
  // The live ingredient's name; one that was deleted stays as history under the name frozen on the change.
  const live = ingredients.find(item => item.id === change.ingredientId);
  const name = live ? ingredientDisplayName(live) : text(change.name);
  const supplier = suppliers.find(candidate => candidate.id === change.supplierId);
  const date = dayText(text(change.date), localeOf(lang));
  const meta = supplier ? t('sup.pc.meta', { supplier: supplierLabel(supplier), date }) : t('sup.pc.metaNoSupplier', { date });
  const priceLine = t('sup.pc.priceLine', {
    old: pricePerUnitText({ priceUnit: change.priceUnit, pricePerUnit: change.oldPrice }, money, t),
    new: pricePerUnitText({ priceUnit: change.priceUnit, pricePerUnit: change.newPrice }, money, t),
  });
  const pct = Number(change.pct);
  const oldPack = text(change.oldPack);
  const newPack = text(change.newPack);
  return (
    <li className={styles.row}>
      <div className={styles.top}>
        <div className={styles.main}>
          <p className={styles.name}>{name}</p>
          <p className={styles.meta}>{meta}</p>
        </div>
        <span className={styles.pct} data-tone={pct > 0 ? 'warn' : 'ok'}>{percentText(pct)}</span>
      </div>
      <p className={styles.price}>{priceLine}</p>
      {oldPack !== '' && newPack !== '' && oldPack !== newPack ? (
        <p className={styles.meta}>{t('sup.pc.packDiffers', { old: oldPack, new: newPack })}</p>
      ) : null}
    </li>
  );
}

// «5 Sept 2026» in the interface language (Finding I-K: the original's rows followed a second source).
function dayText(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
