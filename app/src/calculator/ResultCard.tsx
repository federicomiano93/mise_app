import { useId, useState } from 'react';
import {
  crateCount, DIVISOR_MAX, divisorTotal, formatGrams, getCratePerBox, getDivisorProducts, isCrateEnabled,
  splitDough,
} from '@mise/shared/calculator-config';
import type { CalculatorConfig, Recipe, TabProduct } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import type { TabResult } from './calculatorResult';
import boxes from './Boxes.module.css';
import styles from './ResultCard.module.css';

type Props = {
  recipe: Recipe;
  // Never `none`: a tab with nothing to make shows no card.
  result: Exclude<TabResult, { kind: 'none' }>;
  config: CalculatorConfig;
  products: readonly TabProduct[];
  // The quantity typed for a (client, product) pair.
  qty: (qtyId: string) => number;
};

// The scaled recipe of a tab: how much of each ingredient for the dough to make, the total, the split into
// crates and the crates the orders fill.
//
// ⚠️ A TAB THAT CANNOT BE CALCULATED SHOWS NO NUMBER AT ALL, and says why: an answer that looks complete and is
// not is worse than none. «Still loading» and «gone» are different sentences.
export function ResultCard({ recipe, result, config, products, qty }: Props) {
  const { t, locale } = useT();
  const titleId = useId();
  const grams = (n: number) => formatGrams(n, locale);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <header className={styles.head}>
        <h2 id={titleId} className={styles.title}>{t('calc.doughTitle', { name: recipe.name })}</h2>
        {result.kind === 'ready' ? (
          <span className={styles.badge}>{t('calc.gramsRaw', { g: grams(Math.round(result.target)) })}</span>
        ) : null}
      </header>

      {result.kind === 'loading' ? <p className={styles.problem}>{t('calc.sourceLoading')}</p> : null}
      {result.kind === 'problem' ? (
        <p className={styles.problem}>
          {result.problem === 'unweighable'
            ? t('calc.sourceUnweighable', { row: result.row })
            : t(result.problem === 'missing' ? 'calc.sourceMissing' : 'calc.sourceEmpty')}
        </p>
      ) : null}

      {result.kind === 'ready' ? (
        <>
          <ul className={styles.rows}>
            {result.rows.map((row, index) => (
              <li key={index} className={styles.row}>
                <span className={styles.name}>{row.name}</span>
                <span className={styles.figure}>{`${grams(Math.round(row.grams))} g`}</span>
              </li>
            ))}
          </ul>
          <div className={styles.total}>
            <span>{t('calc.totalDough')}</span>
            <span className={styles.figure}>{`${grams(result.totalG)} g`}</span>
          </div>
          <Divisor config={config} recipe={recipe} qty={qty} grams={grams} />
          <Crates products={products} qty={qty} />
        </>
      ) : null}
    </section>
  );
}

// The divisor box (display only, never touches the recipe or the log): the dough of the products ticked in
// Settings, split into 0…4 crates. Hidden when nothing ticked has a quantity.
//
// ⚠️ NEVER LOCKED. Confirming a dough locks the quantities so they cannot drift from the log that was saved;
// the divisor is not a quantity, it is a split that touches neither the recipe nor the log — and it is
// useful exactly after the dough is made.
function Divisor({ config, recipe, qty, grams }: {
  config: CalculatorConfig;
  recipe: Recipe;
  qty: (qtyId: string) => number;
  grams: (n: number) => string;
}) {
  const { t } = useT();
  const [crates, setCrates] = useState(0);
  const active = getDivisorProducts(config, recipe.id).filter(product => qty(product.qtyId) > 0);
  if (active.length === 0) return null;

  const names = [...new Set(active.map(product => product.name))];
  const total = divisorTotal(config, recipe.id, qty);
  return (
    <div className={styles.divisor}>
      <p className={styles.divisorNames}>{names.join(', ')}</p>
      <div className={styles.divisorRow}>
        <span>{`${grams(Math.round(total))} g`}</span>
        <span aria-hidden="true">÷</span>
        <select
          className={boxes.select}
          aria-label={t('calc.numberOfCrates')}
          value={crates}
          onChange={event => { setCrates(Number(event.target.value)); }}
        >
          {Array.from({ length: DIVISOR_MAX + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span aria-hidden="true">=</span>
        <span className={styles.divisorResult}>{`${grams(Math.round(splitDough(total, crates)))} g`}</span>
      </div>
    </div>
  );
}

// The crate boxes (display only): per product that opted in and has a quantity, how many crates the order
// fills and what each holds.
function Crates({ products, qty }: { products: readonly TabProduct[]; qty: (qtyId: string) => number }) {
  const { t, locale } = useT();
  const shown = products.filter(product => isCrateEnabled(product) && qty(product.qtyId) > 0);
  if (shown.length === 0) return null;
  const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <ul className={styles.crates}>
      {shown.map(product => {
        const perBox = getCratePerBox(product);
        const count = crateCount(qty(product.qtyId), perBox);
        return (
          <li key={product.qtyId} className={styles.crate}>
            <span className={styles.crateName}>{product.name}</span>
            <span className={styles.crateCount}>
              {`${oneDecimal.format(Math.round(count * 10) / 10)} ${t('calc.crateUnit', { n: count })}`}
            </span>
            <span className={styles.crateSub}>{t('calc.gramsEachBox', { g: formatGrams(perBox * product.weight, locale) })}</span>
          </li>
        );
      })}
    </ul>
  );
}
