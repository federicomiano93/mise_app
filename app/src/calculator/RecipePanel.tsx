import { useEffect, useId, useState } from 'react';
import type { HTMLAttributes } from 'react';
import {
  doughExtraGrams, formatGrams, getTabProducts, isExtraDoughEnabled, settledTraysText, showsLeaveningKnob, traysGrams,
  usesOrders, usesTrays, usesTypedTotal,
} from '@mise/shared/calculator-config';
import type { Recipe } from '@mise/shared/calculator-config';
import {
  extraKey, extraUnitKey, paramKey, qtyKey, totalKey, traysKey,
} from '@mise/shared/calculator-tab-keys';
import { useT } from '../i18n/useT';
import { useCalculator } from './CalculatorContext';
import { numberOf, knobRange } from './calculatorInput';
import { calculateTab, sourceRecipe } from './calculatorResult';
import { useTabState, useTabVersion } from './TabStateContext';
import { NumberField } from './NumberField';
import { OrderCards } from './OrderCards';
import { ResultCard } from './ResultCard';
import boxes from './Boxes.module.css';
import styles from './RecipePanel.module.css';

type Props = {
  recipe: Recipe;
  // `role`, `id` and `aria-labelledby` when the recipes are tabs; nothing for a lone recipe.
  panelProps?: HTMLAttributes<HTMLDivElement>;
  // Whether the dough was confirmed: the recipe then comes FIRST (the node is moved, never reordered with
  // CSS, so the keyboard and the reading order are the visual order). Confirming arrives with the next
  // slice of the work view; until then every tab is «not confirmed», and the recipe sits after the entries.
  confirmed?: boolean;
};

// One recipe's tab, laid out by its logic:
//   orders      → leavening knob (if shown) · Orders · Extra dough
//   total       → Total dough (g)
//   both        → leavening knob (if shown) · Total dough (g) · Orders · Extra dough
//   trays       → Number of trays (and the grams they make)
//   traysTotal  → Number of trays · Total dough (g)
// and, beside or below them, the scaled recipe.
//
// Every box is kept in the current app's own localStorage keys per keystroke (calculatorTabState.ts), so the
// numbers survive a reload and the other app shows them too. `touched-<rid>` is written wherever the current
// app writes it: on a typed number or a picked option, never when a box merely comes back to its default.
export function RecipePanel({ recipe, panelProps, confirmed = false }: Props) {
  const { t, locale } = useT();
  const { config, linked } = useCalculator();
  const state = useTabState();
  useTabVersion();
  const uid = useId();
  const rid = recipe.id;

  const products = getTabProducts(config, rid);
  const { source } = sourceRecipe(recipe, linked);
  const hasOrders = usesOrders(recipe.logic);
  const hasTrays = usesTrays(recipe.logic);
  const hasTotal = usesTypedTotal(recipe.logic);
  const hasKnob = showsLeaveningKnob(source);

  // What the tab keeps, as text (the current app restores a box from the same key).
  const qtyText = (qtyId: string) => state.read(qtyKey(qtyId)) ?? '0';
  const knobText = state.read(paramKey(rid)) ?? String(recipe.leaveningDefaultPct);
  const totalText = state.read(totalKey(rid)) ?? '0';
  const savedTrays = state.read(traysKey(rid));
  const traysText = savedTrays === null ? '0' : settledTraysText(savedTrays) ?? savedTrays;
  const extraText = state.read(extraKey(rid)) ?? '0';
  const unitText = state.read(extraUnitKey(rid));
  const extraUnit = unitText === 'g' ? 'g' : 'kg';
  const extraShown = hasOrders && isExtraDoughEnabled(config, rid);

  const result = calculateTab(config, recipe, linked, {
    qty: qtyId => numberOf(qtyText(qtyId)),
    extraG: extraShown ? doughExtraGrams(extraText, extraUnit) : 0,
    totalG: hasTotal ? numberOf(totalText) : 0,
    trays: hasTrays ? traysText : 0,
    knob: hasKnob ? knobText : null,
  });

  const set = (key: string, text: string) => { state.set(key, text, rid); };
  // A box left empty goes back to its default: kept, but the tab is not «used» by it.
  const reset = (key: string, text: string) => { state.set(key, text); };

  const range = knobRange(recipe.leaveningDefaultPct);
  const knobName = source.ingredients.find(ingredient => ingredient.key === source.leaveningKey)?.label ?? t('calc.leavening');
  const traysGramsId = `${uid}-trays-grams`;

  const entries = (
    <div key="entries" className={styles.entries}>
      {hasKnob ? (
        <div className={styles.param}>
          <label htmlFor={`${uid}-knob`} className={styles.paramLabel}>{`${knobName} %`}</label>
          <NumberField
            id={`${uid}-knob`}
            value={knobText}
            inputMode="decimal"
            min={range.min}
            max={range.max}
            step={range.step}
            onChange={text => { set(paramKey(rid), text); }}
            onBlank={() => { reset(paramKey(rid), String(recipe.leaveningDefaultPct)); }}
          />
        </div>
      ) : null}

      {hasTrays ? (
        <div className={styles.param}>
          {/* The «= N g» sits BESIDE the label, not inside it: inside, the box's name would change on every
              keystroke. aria-describedby links it, and it stays a polite live region. */}
          <div className={styles.paramStack}>
            <label htmlFor={`${uid}-trays`} className={styles.paramLabel}>{t('calc.trayCount')}</label>
            <span id={traysGramsId} className={styles.traysGrams} aria-live="polite">
              {t('calc.traysEquals', { g: formatGrams(traysGrams(recipe, traysText), locale) })}
            </span>
          </div>
          <NumberField
            id={`${uid}-trays`}
            value={traysText}
            inputMode="numeric"
            min={0}
            step={1}
            describedBy={traysGramsId}
            settle={settledTraysText}
            onChange={text => { set(traysKey(rid), text); }}
            onBlank={() => { reset(traysKey(rid), '0'); }}
          />
        </div>
      ) : null}

      {hasTotal ? (
        <div className={styles.param}>
          <label htmlFor={`${uid}-total`} className={styles.paramLabel}>{t('calc.totalDoughG')}</label>
          <NumberField
            id={`${uid}-total`}
            value={totalText}
            inputMode="numeric"
            min={0}
            step={1}
            onChange={text => { set(totalKey(rid), text); }}
            onBlank={() => { reset(totalKey(rid), '0'); }}
          />
        </div>
      ) : null}

      {hasOrders ? (
        <>
          <h2 className={styles.section}>{t('calc.ordersSection')}</h2>
          <OrderCards
            products={products}
            textOf={qtyText}
            onChange={(qtyId, text) => { set(qtyKey(qtyId), text); }}
            onBlank={qtyId => { reset(qtyKey(qtyId), '0'); }}
          />
        </>
      ) : null}

      {extraShown ? (
        <div className={styles.param}>
          <label htmlFor={`${uid}-extra`} className={styles.paramLabel}>{t('calc.extraDough')}</label>
          <div className={styles.group}>
            <NumberField
              id={`${uid}-extra`}
              value={extraText}
              inputMode="decimal"
              min={0}
              step={0.1}
              onChange={text => { set(extraKey(rid), text); }}
              onBlank={() => { reset(extraKey(rid), '0'); }}
            />
            <select
              className={boxes.select}
              aria-label={t('calc.extraDoughUnit')}
              value={extraUnit}
              onChange={event => { set(extraUnitKey(rid), event.target.value); }}
            >
              <option value="g">g</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );

  // The recipe, hidden when there is nothing to make.
  const recipeCard = (
    <div key="result" className={styles.result}>
      {result.kind === 'none' ? null : (
        <ResultCard
          recipe={recipe}
          result={result}
          config={config}
          products={products}
          qty={qtyId => numberOf(qtyText(qtyId))}
        />
      )}
    </div>
  );

  // ⚠️ WHERE THE RECIPE SITS FOLLOWS WHETHER THE DOUGH WAS CONFIRMED: the first thing in the panel when it was,
  // otherwise just after the entries (where «Reset all fields» will follow it). The node is MOVED in the
  // document, never reordered with CSS `order`, so the keyboard and the reading order are the visual order;
  // the keys keep React from rebuilding it (and losing the divisor) on the way. On the tablet's split the
  // stylesheet puts it on the right whichever it comes first.
  const parts = confirmed ? [recipeCard, entries] : [entries, recipeCard];

  return (
    <div {...panelProps}>
      <ClearedNote rid={rid} />
      <div className={styles.layout}>{parts}</div>
    </div>
  );
}

// The quiet line saying why a tab is empty — shown ONLY for a tab the new-day sweep actually cleared, for 12
// seconds, and kept across redraws: the time is in the tab state, not in this component, which the
// configuration arriving redraws.
function ClearedNote({ rid }: { rid: string }) {
  const { t } = useT();
  const state = useTabState();
  useTabVersion();
  const [, expire] = useState(0);
  const left = state.noteLeft(rid);

  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setTimeout(() => { expire(n => n + 1); }, left);
    return () => { clearTimeout(timer); };
  }, [left]);

  return left > 0 ? <p className={styles.note}>{t('calc.fieldsCleared')}</p> : null;
}
