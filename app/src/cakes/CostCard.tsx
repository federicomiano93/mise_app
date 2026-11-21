import { useId, useMemo, useState } from 'react';
import { BookOpen, ListChecks, TriangleAlert } from 'lucide-react';
import type { CakeTotals } from '@mise/shared/cake-model';
import { costProduct, vatRatesFor } from '@mise/shared/foodcost-model';
import { fcMoney, fcNumber } from '@mise/shared/fc-number';
import { countryOf } from '@mise/shared/market';
import { useFoodcost } from '../foodcost/FoodcostContext';
import { lineName } from '../foodcost/lineNotes';
import { NumberBox } from '../foodcost/NumberBox';
import { percentText, statusWord } from '../foodcost/productRowModel';
import { SuggestedPrice } from '../foodcost/SuggestedPrice';
import { VatGuideDialog } from '../foodcost/VatGuideDialog';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { vatFromSelect } from './cakeEditorModel';
import styles from './CostCard.module.css';

// What the cake's cost and price boxes are filled with (typed text: a half-typed «12.» must stay as typed).
export interface PriceTexts {
  price: string;
  target: string;
  vatSelect: string;
  vatOther: string;
}

export type PriceField = 'sellingPrice' | 'vatRate' | 'foodCostTarget';

type Props = {
  // The cake's costs (cakeTotals of the working copy), and the cake's own price, VAT and target as the cost engine reads them.
  totals: CakeTotals;
  sellingPrice: number | null;
  texts: PriceTexts;
  // Food cost shows the labour only to somebody who may read the labour rate.
  showLabour: boolean;
  // The box Save refused (highlighted).
  invalid: PriceField | null;
  slices: number;
  onPrice: (text: string) => void;
  onTarget: (text: string) => void;
  onVatSelect: (value: string) => void;
  onVatOther: (text: string) => void;
  // A rate chosen in the VAT guide.
  onVatGuide: (rate: number) => void;
  registerBox: (field: PriceField, node: HTMLInputElement | null) => void;
  // «Open “What you need”»: the dialog is the form's, so the working copy it reads is the form's.
  // Given the button itself: a tap does not always focus a button (Safari), so the opener cannot be read from the page's focus.
  onOpenNeeds: (opener: HTMLElement) => void;
};

// Keys, resolved when the menu is drawn.
const VAT_WORDS: Readonly<Record<string, MessageKey>> = {
  'fc.vat.standard': 'fc.vat.standard',
  'fc.vat.reduced': 'fc.vat.reduced',
  'fc.vat.minimum': 'fc.vat.minimum',
  'fc.vat.zero': 'fc.vat.zero',
};

// What the cake costs and what it is sold for: the raw materials, the labour (only where Food cost shows it), the cost of a slice, the
// price with its VAT and target, the food cost with its light, and the price that would hit the target.
//
// ⚠️ A FIGURE SHOWN ALONE IS ALWAYS THE MATERIALS (Food cost's rule since PR #589): «Raw materials» and the slice's cost never turn into
// «materials + labour» for somebody who can read the labour rate; the total is a line of its own, and the slice's total says so.
// ⚠️ A CARD WITH NO PRICE MAKES THE COST «INCOMPLETE»: the figures wear «+?», the food cost reads «?», and the card is named — a cost too
// low must never look like a good one.
export function CostCard({ totals, sellingPrice, texts, showLabour, invalid, slices, onPrice, onTarget, onVatSelect, onVatOther, onVatGuide, registerBox, onOpenNeeds }: Props) {
  const { t } = useT();
  const money = useMoney();
  const ids = useId();
  const { location } = useSession();
  const { tables, productsLoaded, recipesLoaded, ingredientsLoaded } = useFoodcost();
  const [guideOpen, setGuideOpen] = useState(false);
  const country = countryOf(location);

  const result = useMemo(() => costProduct(totals.product, tables), [totals.product, tables]);
  const partial = totals.partial || totals.unpricedIds.length > 0 || totals.missingLines > 0;
  const more = partial ? ' +?' : '';
  const amount = (value: number | null): string => (value === null ? '—' : `${fcMoney(value, money)}${more}`);
  const labourShown = showLabour && totals.labour !== null;

  const loaded = { recipes: recipesLoaded, ingredients: ingredientsLoaded, products: productsLoaded };
  // ⚠️ A CARD THAT NO LONGER EXISTS IS NOT «WITHOUT A PRICE»: it has no name to put in that sentence, so it gets its own line.
  const named = [...new Set(totals.unpricedIds)].map(id => lineName(t, { key: '', kind: 'semi', productId: id, qty: '' }, tables, loaded));
  const goneCount = named.filter(name => name.missing).length;
  const unpriced = named.filter(name => !name.missing && name.text !== '');
  const unpricedNames = unpriced.map(name => name.text).join(', ');

  const target = totals.product.foodCostTarget;
  const foodCost = partial ? '?' : result.foodCostPct === null ? '—' : percentText(result.foodCostPct, money);
  const light = partial || result.foodCostPct === null ? 'none' : (result.status ?? 'none');
  // What stops the food cost from being worked out, in the person's own words (the cake is always sold by the piece, so only these three apply).
  const blocked = result.foodCostPct !== null ? null
    : result.blockers.includes('no-components') ? t('cakes.cost.needCards')
      : result.blockers.includes('no-vat') ? t('fc.chooseTheVatRate')
        : result.blockers.includes('no-price') ? t('fc.enterTheSellingPrice')
          : null;

  const vatOptionText = (key: string, rate: number): string => {
    const word = VAT_WORDS[key];
    return word === undefined ? `${rate}%` : t(word, { rate: String(rate) });
  };

  return (
    <section className={styles.card} aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className={styles.title}>{t('cakes.cost.title')}</h3>

      <div className={styles.kv}>
        <span>{t('cakes.cost.materials')}<span className={styles.muted}>{t('cakes.cost.materialsSub')}</span></span>
        <b className={styles.num}>{amount(totals.materials)}</b>
      </div>
      {labourShown ? (
        <>
          <div className={styles.kv}>
            <span>
              {t('cakes.cost.labour')}
              <span className={styles.muted}>
                {t('cakes.cost.labourSub', { semi: fcMoney(totals.labourSemis ?? 0, money), own: fcMoney(totals.labourAssembly ?? 0, money) })}
              </span>
            </span>
            <span className={styles.num}>{amount(totals.labour)}</span>
          </div>
          <div className={`${styles.kv} ${styles.total}`}>
            <span>{t('cakes.cost.total')}<span className={styles.muted}>{t('cakes.cost.totalSub')}</span></span>
            <span className={styles.num}>{amount(totals.total)}</span>
          </div>
        </>
      ) : null}

      <div className={styles.slice}>
        <span>{t('cakes.cost.perSlice', { n: slices })}</span>
        <span className={styles.num}>
          {[
            totals.perSlice.cost === null ? null : `${t('cakes.cost.sliceCost', { cost: fcMoney(totals.perSlice.cost, money) })}${more}`,
            totals.perSlice.price === null ? null : t('cakes.cost.slicePrice', { price: fcMoney(totals.perSlice.price, money) }),
          ].filter((part): part is string => part !== null).join(' · ')}
        </span>
        {labourShown && totals.perSlice.total !== null ? (
          <span className={styles.num}>{t('cakes.cost.sliceTotal', { total: `${fcMoney(totals.perSlice.total, money)}${more}` })}</span>
        ) : null}
      </div>

      <div className={styles.pricebox}>
        <div className={styles.field}>
          <label htmlFor={`${ids}-price`} className={styles.label}>{t('cakes.cost.priceLabel', { currency: money.symbol })}</label>
          <NumberBox
            id={`${ids}-price`}
            value={texts.price}
            invalid={invalid === 'sellingPrice'}
            inputRef={node => { registerBox('sellingPrice', node); }}
            onChange={onPrice}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={`${ids}-vat`} className={styles.label}>{t('fc.vatRate')}</label>
          <div className={styles.row}>
            <select
              id={`${ids}-vat`}
              className={styles.select}
              value={texts.vatSelect}
              onChange={event => { onVatSelect(event.target.value); }}
            >
              <option value="">{t('fc.choose')}</option>
              {vatRatesFor(country).map(choice => (
                <option key={choice.rate} value={String(choice.rate)}>{vatOptionText(choice.key, choice.rate)}</option>
              ))}
              <option value="other">{t('fc.anotherRate')}</option>
            </select>
            <Button variant="bare" className={styles.guide} aria-label={t('fc.vatGuide.open')} onPress={() => { setGuideOpen(true); }}>
              <BookOpen aria-hidden="true" />
            </Button>
          </div>
          {texts.vatSelect === 'other' ? (
            <NumberBox
              id={`${ids}-vatother`}
              label={t('fc.anotherVatRateAs')}
              value={texts.vatOther}
              invalid={invalid === 'vatRate'}
              inputRef={node => { registerBox('vatRate', node); }}
              onChange={onVatOther}
            />
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor={`${ids}-target`} className={styles.label}>{t('fc.foodCostTarget')}</label>
          <NumberBox
            id={`${ids}-target`}
            value={texts.target}
            invalid={invalid === 'foodCostTarget'}
            inputRef={node => { registerBox('foodCostTarget', node); }}
            onChange={onTarget}
          />
        </div>

        <div className={styles.foodCost}>
          <span>
            {t('cakes.cost.foodCost')}
            <span className={styles.muted}>
              {target === null ? t('cakes.cost.foodCostNoTarget') : t('cakes.cost.foodCostSub', { target: fcNumber(target, money) })}
            </span>
          </span>
          <span className={styles.figure}>
            <span className={styles.dot} data-status={light} aria-hidden="true" />
            <span className={styles.text}>
              <span className={styles.big} data-costed={light !== 'none'}>{foodCost}</span>
              {light === 'none' ? null : <span className={styles.word}>{statusWord(t, result.status)}</span>}
            </span>
          </span>
        </div>
        {blocked === null ? null : <p className={styles.note}>{blocked}</p>}

        <SuggestedPrice product={totals.product} tables={tables} sellingPrice={sellingPrice} onUse={price => { onPrice(String(price)); }} />
      </div>

      {unpricedNames === '' ? null : (
        <p className={styles.warn} role="note">
          <TriangleAlert aria-hidden="true" />
          <span>{t('cakes.cost.incomplete', { n: unpriced.length, names: unpricedNames })}</span>
        </p>
      )}
      {totals.missingLines === 0 ? null : (
        <p className={styles.warn} role="note">
          <TriangleAlert aria-hidden="true" />
          <span>{t('cakes.cost.noGrams', { n: totals.missingLines })}</span>
        </p>
      )}
      {goneCount === 0 ? null : (
        <p className={styles.warn} role="note">
          <TriangleAlert aria-hidden="true" />
          <span>{t('cakes.cost.cardsGone', { n: goneCount })}</span>
        </p>
      )}

      <div className={styles.needs}>
        <p className={styles.note}>{t('cakes.need.openNote')}</p>
        <Button onPress={event => { const target = event.target; onOpenNeeds(target.closest('button') ?? (target as HTMLElement)); }}>
          <ListChecks aria-hidden="true" />
          {t('cakes.need.open')}
        </Button>
      </div>

      {guideOpen ? (
        <VatGuideDialog
          country={country}
          currentRate={vatFromSelect(texts.vatSelect, texts.vatOther)}
          onUse={rate => { setGuideOpen(false); onVatGuide(rate); }}
          onClose={() => { setGuideOpen(false); }}
        />
      ) : null}
    </section>
  );
}
