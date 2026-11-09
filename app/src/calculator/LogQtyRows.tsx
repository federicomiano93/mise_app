import { useId } from 'react';
import { useT } from '../i18n/useT';
import { DROPDOWN_OPTIONS } from './calculatorInput';
import { NumberField } from './NumberField';
import type { QtyRow } from './logVersions';
import boxes from './Boxes.module.css';
import styles from './OrderCards.module.css';
import own from './LogEditor.module.css';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

type Props = {
  rows: readonly QtyRow[];
  // The row at `index` now holds this quantity. By position: the same product ordered by two clients is two rows.
  onChange: (index: number, qty: number) => void;
  // Said when there is no row at all.
  empty: string;
};

type Card = { clientName: string; rows: { row: QtyRow; index: number }[] };

// A client's rows are next to each other (the order the Calculator draws them in).
function cardsOf(rows: readonly QtyRow[]): Card[] {
  const cards: Card[] = [];
  rows.forEach((row, index) => {
    const clientName = String(row.clientName ?? '');
    const last = cards[cards.length - 1];
    if (last && last.clientName === clientName) last.rows.push({ row, index });
    else cards.push({ clientName, rows: [{ row, index }] });
  });
  return cards;
}

// 0, 20 … 100 — and a quantity a log already holds that is not one of them, so the select tells the truth.
function optionsFor(qty: number): number[] {
  return DROPDOWN_OPTIONS.includes(qty) ? [...DROPDOWN_OPTIONS] : [...DROPDOWN_OPTIONS, qty];
}

// The quantities of a hand-made dough, one card per client: «Add dough» and «Edit dough» draw THE SAME rows (as
// js/log-qty.js does for both), so the two cannot drift apart. A number or kilos typed in a box, or 0…100 picked from a
// select for a `dropdown` product; the name with its weight, and «pz» / «kg» after the box.
export function LogQtyRows({ rows, onChange, empty }: Props) {
  const { t } = useT();
  const uid = useId();
  if (rows.length === 0) return <p className={own.hint}>{empty}</p>;

  return (
    <div className={styles.cards}>
      {cardsOf(rows).map((card, cardIndex) => (
        <section key={cardIndex} className={styles.card} aria-labelledby={`${uid}-client-${cardIndex}`}>
          <h3 id={`${uid}-client-${cardIndex}`} className={styles.client}>{card.clientName || t('calc.clientFallback')}</h3>
          <ul className={styles.rows}>
            {card.rows.map(({ row, index }) => {
              const boxId = `${uid}-qty-${index}`;
              const kilos = row.kind === 'kg';
              const qty = num(row.qty);
              return (
                <li key={index} className={styles.row}>
                  <label htmlFor={boxId} className={styles.label}>
                    {String(row.name ?? '')}
                    {kilos ? null : <>{' '}<span className={styles.weight}>{`(${num(row.weightG)}g)`}</span></>}
                  </label>
                  <div className={styles.group}>
                    {row.kind === 'dropdown' ? (
                      <select
                        id={boxId}
                        className={boxes.select}
                        value={String(qty)}
                        aria-describedby={`${uid}-client-${cardIndex}`}
                        onChange={event => { onChange(index, num(event.target.value)); }}
                      >
                        {optionsFor(qty).map(option => <option key={option} value={String(option)}>{option}</option>)}
                      </select>
                    ) : (
                      <NumberField
                        id={boxId}
                        value={String(qty)}
                        inputMode={kilos ? 'decimal' : 'numeric'}
                        min={0}
                        step={kilos ? 0.5 : undefined}
                        describedBy={`${uid}-client-${cardIndex}`}
                        onChange={text => { onChange(index, Math.max(0, num(text))); }}
                        onBlank={() => { onChange(index, 0); }}
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
