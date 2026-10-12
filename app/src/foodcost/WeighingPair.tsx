import { useId } from 'react';
import { readWeighing } from '@mise/shared/foodcost-weighing';
import type { WeighingState } from '@mise/shared/foodcost-weighing';
import { useT } from '../i18n/useT';
import styles from './WeighingPair.module.css';

type Props = {
  // The recipe as stored (the weighing is read against it).
  recipe: unknown;
  // Named when the product has more than one recipe and the boxes would not say whose dough they are.
  title: string | null;
  state: WeighingState;
  // What a person is typing in each box right now, kept so a half-typed «12.» is never rewritten.
  typed: { raw?: string; cooked?: string };
  // How many OTHER products this recipe is on: the loss belongs to the recipe.
  others: number;
  onRaw: (text: string) => void;
  onCooked: (text: string) => void;
  onBlur: (box: 'raw' | 'cooked') => void;
};

// A recipe's dough weighed before the oven and after, typed on the product (his decision, 13 Sep
// 2026: the weighing moved here from the recipe editor — the number still belongs to the RECIPE, so
// Save writes it there).
//
// ⚠️ THE BOX UNDER THE FINGER IS NEVER REWRITTEN: «12.» is a number half-typed, and putting the parsed
// 12 back would eat the decimal point. While a box is being typed in, it shows what was typed.
export function WeighingPair({ recipe, title, state, typed, others, onRaw, onCooked, onBlur }: Props) {
  const { t } = useT();
  const ids = useId();
  const shown = readWeighing(recipe, state);
  const raw = typed.raw ?? (state.rawTyped ? (state.raw > 0 ? String(state.raw) : '') : shown.rawShown);
  const cooked = typed.cooked ?? (state.weighed && state.cooked > 0 ? String(state.cooked) : '');

  return (
    <div className={styles.weigh}>
      {title === null ? null : <p className={styles.title}>{title}</p>}
      <div className={styles.pair}>
        <div className={styles.cell}>
          <label htmlFor={`${ids}-raw`} className={styles.label}>{t('fc.rawDough')}</label>
          <span className={styles.box}>
            <input
              id={`${ids}-raw`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={styles.input}
              placeholder="—"
              value={raw}
              onChange={event => { onRaw(event.target.value); }}
              onBlur={() => { onBlur('raw'); }}
            />
            <span className={styles.unit}>g</span>
          </span>
        </div>
        <div className={styles.cell}>
          <label htmlFor={`${ids}-cooked`} className={styles.label}>{t('fc.cookedDough')}</label>
          <span className={styles.box}>
            <input
              id={`${ids}-cooked`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={styles.input}
              placeholder="—"
              value={cooked}
              onChange={event => { onCooked(event.target.value); }}
              onBlur={() => { onBlur('cooked'); }}
            />
            <span className={styles.unit}>g</span>
          </span>
        </div>
      </div>
      <p className={styles.out}>{t(shown.message.key, shown.message.params)}</p>
      {/* Present before they speak: text added to a region that was already on the page is announced. */}
      <div className={styles.notes} aria-live="polite">
        {shown.warning === null ? null : (
          <p className={styles.warn}>{t(shown.warning.key, shown.warning.params)}</p>
        )}
        {/* ⚠️ SAID THE MOMENT IT BECOMES TRUE: the loss belongs to the recipe, so a weighing typed on
            this product changes every other product built on it, and nobody opening those would know
            why their cost moved. */}
        {shown.patch !== null && others > 0 ? (
          <p className={styles.shared}>{t('fc.lossSharedWith', { n: others })}</p>
        ) : null}
      </div>
    </div>
  );
}
