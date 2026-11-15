import { useId } from 'react';
import { formatGrams } from '@mise/shared/calculator-config';
import type { LogSheet as Sheet } from '@mise/shared/log-model';
import { useT } from '../i18n/useT';
import styles from './ResultCard.module.css';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

// The scaled recipe a log was saved with, read-only: the SAME look as the live result card (it borrows its
// stylesheet, so the two cannot drift apart), rebuilt from the sheet snapshot the version stores, never from
// today's configuration. The divisor shows the number of crates it was saved with, as a figure, not a box to change.
export function LogSheet({ sheet }: { sheet: Sheet | null | undefined }) {
  const { t, locale } = useT();
  const titleId = useId();
  if (!sheet) return null;
  const grams = (n: unknown) => formatGrams(Math.round(num(n)), locale);
  const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const ingredients = list<Sheet['ingredients'][number]>(sheet.ingredients);
  const crates = list<Sheet['crates'][number]>(sheet.crates);
  const divisor = sheet.divisor;

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <header className={styles.head}>
        <h3 id={titleId} className={styles.title}>{t('calc.doughTitle', { name: String(sheet.dough ?? '') })}</h3>
        <span className={styles.badge}>{t('calc.gramsRaw', { g: grams(sheet.total_g) })}</span>
      </header>
      <ul className={styles.rows}>
        {ingredients.map((row, index) => (
          <li key={index} className={styles.row}>
            <span className={styles.name}>{String(row?.name ?? '')}</span>
            <span className={styles.figure}>{`${grams(row?.grams)} g`}</span>
          </li>
        ))}
      </ul>
      <div className={styles.total}>
        <span>{t('calc.totalDough')}</span>
        <span className={styles.figure}>{`${grams(sheet.total_g)} g`}</span>
      </div>

      {divisor ? (
        <div className={styles.divisor}>
          <p className={styles.divisorNames}>{list<unknown>(divisor.names).map(String).join(', ')}</p>
          <div className={styles.divisorRow}>
            <span>{`${grams(divisor.total)} g`}</span>
            <span aria-hidden="true">÷</span>
            <span>{num(divisor.n)}</span>
            <span aria-hidden="true">=</span>
            <span className={styles.divisorResult}>{`${grams(divisor.result)} g`}</span>
          </div>
        </div>
      ) : null}

      {crates.length > 0 ? (
        <ul className={styles.crates}>
          {crates.map((crate, index) => (
            <li key={index} className={styles.crate}>
              <span className={styles.crateName}>{String(crate?.name ?? '')}</span>
              <span className={styles.crateCount}>
                {`${oneDecimal.format(num(crate?.count))} ${t('calc.crateUnit', { n: num(crate?.count) })}`}
              </span>
              <span className={styles.crateSub}>{t('calc.gramsEachBox', { g: grams(crate?.eachBoxG) })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
