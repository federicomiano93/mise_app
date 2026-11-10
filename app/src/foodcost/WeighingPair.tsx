import { useId } from 'react';
import type { Ref } from 'react';
import { weighingParams } from '@mise/shared/fc-number';
import { readWeighing } from '@mise/shared/foodcost-weighing';
import type { WeighingState } from '@mise/shared/foodcost-weighing';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
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
  // The cooked box, for Save to point at when its warning stands.
  cookedRef?: Ref<HTMLInputElement>;
};

// A recipe's dough weighed before the oven and after, typed on the product (his decision, 13 Sep
// 2026: the weighing moved here from the recipe editor — the number still belongs to the RECIPE, so
// Save writes it there).
//
// ⚠️ THE BOX UNDER THE FINGER IS NEVER REWRITTEN: «12.» is a number half-typed, and putting the parsed
// 12 back would eat the decimal point. While a box is being typed in, it shows what was typed.
export function WeighingPair({ recipe, title, state, typed, others, onRaw, onCooked, onBlur, cookedRef }: Props) {
  const { t } = useT();
  const money = useMoney();
  const ids = useId();
  const shown = readWeighing(recipe, state);
  // ⚠️ BOTH BOXES START EMPTY unless the recipe was weighed: the raw box no longer follows the recipe's total (df7e6313).
  const raw = typed.raw ?? (state.raw > 0 ? String(state.raw) : '');
  const cooked = typed.cooked ?? (state.cooked > 0 ? String(state.cooked) : '');
  // ⚠️ THE COOKED BOX STAYS RED FOR AS LONG AS ITS WARNING STANDS (owner, Nov 2026: «deve restare rosso»): both warnings
  // (cooked heavier than raw, a loss past the cap) are about the cooked weight, and the sentence alone was easy to miss.
  const invalid = shown.warning !== null;

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
              placeholder="0"
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
              ref={cookedRef}
              className={styles.input}
              placeholder="0"
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? `${ids}-warn` : undefined}
              data-invalid={invalid}
              value={cooked}
              onChange={event => { onCooked(event.target.value); }}
              onBlur={() => { onBlur('cooked'); }}
            />
            <span className={styles.unit}>g</span>
          </span>
        </div>
      </div>
      <p className={styles.out}>{t(shown.message.key, weighingParams(shown.message.params, money))}</p>
      {/* Present before they speak: text added to a region that was already on the page is announced. */}
      <div className={styles.notes} aria-live="polite">
        {shown.warning === null ? null : (
          <p id={`${ids}-warn`} className={styles.warn}>{t(shown.warning.key, weighingParams(shown.warning.params, money))}</p>
        )}
        {/* ⚠️ SAID THE MOMENT IT BECOMES TRUE: the loss belongs to the recipe, so a weighing typed on
            this product changes every other product built on it, and nobody opening those would know
            why their cost moved. A wrong pair only KEEPS the two numbers typed (keepsOnly): the stored loss stays,
            so no other product moves and the sentence would be false (foodcost-editor.js df7e6313). */}
        {shown.patch !== null && !shown.keepsOnly && others > 0 ? (
          <p className={styles.shared}>{t('fc.lossSharedWith', { n: others })}</p>
        ) : null}
      </div>
    </div>
  );
}
