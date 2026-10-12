import { useId } from 'react';
import type { TabProduct } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { DROPDOWN_OPTIONS } from './calculatorInput';
import { NumberField } from './NumberField';
import boxes from './Boxes.module.css';
import styles from './OrderCards.module.css';

type Props = {
  // The tab's products, grouped by the client that orders them, in address-book order.
  products: readonly TabProduct[];
  // The text kept for a (client, product) pair.
  textOf: (qtyId: string) => string;
  onChange: (qtyId: string, text: string) => void;
  onBlank: (qtyId: string) => void;
  // The tab is confirmed: every box and select is locked.
  disabled?: boolean;
};

type Card = { clientId: string; clientName: string; rows: TabProduct[] };

// One card per client, a row per product: the same product ordered by two clients is two independent boxes.
function cardsOf(products: readonly TabProduct[]): Card[] {
  const cards: Card[] = [];
  for (const product of products) {
    const last = cards[cards.length - 1];
    if (last && last.clientId === product.clientId) last.rows.push(product);
    else cards.push({ clientId: product.clientId, clientName: product.clientName, rows: [product] });
  }
  return cards;
}

// The orders of a recipe tab: what each client wants of it, typed as pieces (or kilos, for a legacy `kg`
// product, or picked from 0…100 for a `dropdown` one). A recipe with no product says so quietly: that is
// true whether there are no clients, no products on this recipe, or every one of them is paused.
export function OrderCards({ products, textOf, onChange, onBlank, disabled }: Props) {
  const { t } = useT();
  const uid = useId();

  if (products.length === 0) return <p className={styles.hint}>{t('calc.empty.noProducts.sub')}</p>;

  return (
    <div className={styles.cards}>
      {cardsOf(products).map((card, cardIndex) => (
        // The heading names the group, so the same product under two clients is told apart.
        <section key={card.clientId} className={styles.card} aria-labelledby={`${uid}-client-${cardIndex}`}>
          <h3 id={`${uid}-client-${cardIndex}`} className={styles.client}>{card.clientName}</h3>
          <ul className={styles.rows}>
            {card.rows.map(product => {
              const boxId = `${uid}-qty-${product.qtyId}`;
              const kilos = product.kind === 'kg';
              const text = textOf(product.qtyId);
              return (
                <li key={product.qtyId} className={styles.row}>
                  <label htmlFor={boxId} className={styles.label}>
                    {product.name}
                    {kilos ? null : <span className={styles.weight}>{` (${product.weight}g)`}</span>}
                  </label>
                  <div className={styles.group}>
                    {product.kind === 'dropdown' ? (
                      <select
                        id={boxId}
                        className={boxes.select}
                        value={text}
                        disabled={disabled}
                        onChange={event => { onChange(product.qtyId, event.target.value); }}
                      >
                        {optionsFor(text).map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : (
                      <NumberField
                        id={boxId}
                        value={text}
                        inputMode={kilos ? 'decimal' : 'numeric'}
                        min={0}
                        step={kilos ? 0.5 : undefined}
                        disabled={disabled}
                        onChange={next => { onChange(product.qtyId, next); }}
                        onBlank={() => { onBlank(product.qtyId); }}
                      />
                    )}
                    <span className={styles.unit}>{kilos ? 'kg' : t('calc.unitPieces')}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// 0, 20 … 100 — and a number the tab already keeps that is not one of them (typed in the other app, or left
// by a product whose kind changed), so the select tells the truth about what is being calculated.
function optionsFor(text: string): string[] {
  const options = DROPDOWN_OPTIONS.map(String);
  return options.includes(text) ? options : [...options, text];
}
