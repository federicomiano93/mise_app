import { formatGrams } from '@mise/shared/calculator-config';
import type { LogLine, LogVersion, OccasionalClient } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import styles from './LogOrder.module.css';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

const unit = (kind: unknown): string => (kind === 'kg' ? 'kg' : 'pz');

// The order a version holds, as the current app draws it (js/log-view.js `renderOrder`): a log from before the
// structured model keeps only its grouped text, split here into client headers and item lines; every other log is
// rebuilt from its lines, grouped by client with the zero ones left out, then the occasional clients, the trays and
// the extra dough. ⚠️ EVERY FIELD IS READ DEFENSIVELY: a hand-made or damaged document draws what it can and never
// throws (a list of fifty must not die for one).
export function LogOrder({ version }: { version: LogVersion | null }) {
  if (!version) return <div />;
  return version.legacy || !version.sheet ? <LegacyText text={version.text} /> : <Items version={version} />;
}

function LegacyText({ text }: { text: unknown }) {
  const { t } = useT();
  const lines = String(text ?? '').split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) return <div className={styles.order}><p className={styles.item}>{t('calc.empty')}</p></div>;
  return (
    <div className={styles.order}>
      {lines.map((line, index) => (!/^\s/.test(line) && line.endsWith(':')
        ? <p key={index} className={styles.customer}>{line.slice(0, -1)}</p>
        : <p key={index} className={styles.item}>{line.trim()}</p>))}
    </div>
  );
}

function Items({ version }: { version: LogVersion }) {
  const { t, locale } = useT();
  const groups = new Map<string, LogLine[]>();
  for (const line of list<LogLine>(version.items)) {
    if (!line || num(line.qty) <= 0) continue;
    const key = String(line.clientName || t('calc.clientFallback'));
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const occasional = list<OccasionalClient>(version.occasional)
    .map(occ => ({ occ, products: list<NonNullable<OccasionalClient['products']>[number]>(occ?.products).filter(p => p && num(p.qty) > 0) }))
    .filter(entry => entry.products.length > 0);

  const sheet = version.sheet;
  const trays = sheet && num(sheet.trayWeight_g) > 0 && sheet.trays !== undefined ? num(sheet.trays) : null;
  const typed = trays === null || !sheet ? 0 : num(sheet.total_g) - trays * num(sheet.trayWeight_g);
  const extra = sheet ? num(sheet.extra_g) : 0;
  const empty = groups.size === 0 && occasional.length === 0 && trays === null && extra <= 0;

  return (
    <div className={styles.order}>
      {[...groups].map(([client, lines]) => (
        <div key={client} className={styles.group}>
          <p className={styles.customer}>{client}</p>
          {lines.map((line, index) => (
            <p key={index} className={styles.item}>{`${String(line.name ?? '')}: `}<strong>{`${num(line.qty)} ${unit(line.kind)}`}</strong></p>
          ))}
        </div>
      ))}
      {occasional.map(({ occ, products }, index) => (
        <div key={`occasional-${index}`} className={styles.group}>
          <p className={styles.customer}>{t('calc.occasionalLabel', { name: String(occ.name || t('calc.logOccasionalClient')) })}</p>
          {products.map((product, at) => (
            <p key={at} className={styles.item}>{`${String(product.name ?? '')}: `}<strong>{`${num(product.qty)} ${unit(product.unit)}`}</strong></p>
          ))}
        </div>
      ))}
      {trays === null ? null : (
        <div className={styles.group}>
          <p className={styles.item}>
            <strong>{t('calc.traysOfWeight', { n: trays, trays: formatGrams(trays, locale), g: formatGrams(num(sheet?.trayWeight_g), locale) })}</strong>
          </p>
          {typed > 0 ? <p className={styles.item}>{t('calc.traysTypedPart', { g: formatGrams(typed, locale) })}</p> : null}
        </div>
      )}
      {extra > 0 ? <p className={styles.item}>{`${t('calc.logExtraDough')}${formatGrams(extra, locale)} g`}</p> : null}
      {empty ? <p className={styles.item}>{t('calc.noProductsEntered')}</p> : null}
    </div>
  );
}
