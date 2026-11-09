import { useId } from 'react';
import type { ReactNode, Ref } from 'react';
import type { PriceBasis } from '@mise/shared/price-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import type { PriceView } from './priceCardModel';
import styles from './IngredientCard.module.css';

export type PriceBox = 'rate' | 'box' | 'pieceKg';

type Props = {
  view: PriceView;
  // The price box a refused Save pointed at, or null.
  refused: PriceBox | null;
  rateRef: Ref<HTMLInputElement>;
  boxRef: Ref<HTMLInputElement>;
  pieceRef: Ref<HTMLInputElement>;
  onUnit(unit: string): void;
  onRate(text: string): void;
  onBox(text: string): void;
  onPieceKg(text: string): void;
  onVat(vat: string): void;
  onBasis(basis: PriceBasis): void;
  onRecompute(): void;
  // The price history block (existing items only).
  history: ReactNode;
};

// The price on the ingredient card, drawn from a PriceView (parity C58–C79, C86): the order of C79 — the pair of boxes, the
// basis segments, the notes, the permanent «net of VAT» note, the piece weight, the VAT menu, the summary, the VAT line and the
// history. It holds no state of its own: priceCardModel.ts owns it.
export function PriceSection({
  view, refused, rateRef, boxRef, pieceRef, onUnit, onRate, onBox, onPieceKg, onVat, onBasis, onRecompute, history,
}: Props) {
  const { t } = useT();
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;
  const invalid = (box: PriceBox) => ({
    'aria-invalid': refused === box ? true : undefined,
    'aria-describedby': refused === box ? id(`${box}-error`) : undefined,
  });
  const error = (box: PriceBox) => (
    <p id={id(`${box}-error`)} role="status" className={refused === box ? styles.error : styles.quiet}>
      {refused === box ? t('sup.price.notANumber') : ''}
    </p>
  );

  return (
    <div className={styles.priceBlock}>
      <div className={styles.pair}>
        {view.typedForm ? (
          <>
            <div className={styles.field}>
              <label htmlFor={id('unit')} className={styles.label}>{view.unit.label}</label>
              <select id={id('unit')} className={styles.box} value={view.unit.value} onChange={event => { onUnit(event.target.value); }}>
                {view.unit.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor={id('rate')} className={styles.label}>{view.rate.label}</label>
              <input
                ref={rateRef}
                id={id('rate')}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={styles.box}
                placeholder={view.rate.placeholder}
                {...invalid('rate')}
                value={view.rate.value}
                onChange={event => { onRate(event.target.value); }}
              />
              {error('rate')}
            </div>
          </>
        ) : (
          <div className={styles.field}>
            <label id={id('box-label')} htmlFor={id('box')} className={styles.label}>{view.box.label}</label>
            <input
              ref={boxRef}
              id={id('box')}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={styles.box}
              placeholder={view.box.placeholder}
              {...invalid('box')}
              value={view.box.value}
              onChange={event => { onBox(event.target.value); }}
            />
            {error('box')}
          </div>
        )}
      </div>

      {view.segments.length === 0 ? null : (
        <div role="group" aria-labelledby={id('box-label')} className={styles.segments}>
          {view.segments.map(segment => (
            <button
              key={segment.value}
              type="button"
              className={styles.segment}
              aria-pressed={segment.pressed}
              onClick={() => { onBasis(segment.value); }}
            >
              {segment.label}
            </button>
          ))}
        </div>
      )}

      {view.changedNote === null ? null : (
        <div className={styles.priceNote}>
          <p className={styles.hint}>{view.changedNote.text}</p>
          {view.changedNote.showRecompute ? (
            <Button variant="quiet" onPress={onRecompute}>{t('sup.price.case.recompute')}</Button>
          ) : null}
        </div>
      )}
      {view.keepsNote === null ? null : <p className={styles.hint}>{view.keepsNote}</p>}
      {view.priceAgainNote === null ? null : <p className={styles.hint}>{view.priceAgainNote}</p>}
      <p className={styles.hint}>{view.exVatNote}</p>

      {view.pieceWeight.shown ? (
        <div className={styles.field}>
          <label htmlFor={id('piece')} className={styles.label}>{view.pieceWeight.label}</label>
          <input
            ref={pieceRef}
            id={id('piece')}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className={styles.box}
            placeholder={view.pieceWeight.placeholder}
            {...invalid('pieceKg')}
            aria-describedby={[id('piece-hint'), refused === 'pieceKg' ? id('pieceKg-error') : ''].filter(Boolean).join(' ')}
            value={view.pieceWeight.value}
            onChange={event => { onPieceKg(event.target.value); }}
          />
          <p id={id('piece-hint')} className={styles.hint}>{view.pieceWeight.hint}</p>
          {error('pieceKg')}
        </div>
      ) : null}

      <div className={styles.pair}>
        <div className={styles.field}>
          <label htmlFor={id('vat')} className={styles.label}>{view.vat.label}</label>
          <select id={id('vat')} className={styles.box} value={view.vat.value} onChange={event => { onVat(event.target.value); }}>
            {view.vat.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      <div className={view.summary.muted ? styles.summaryMuted : styles.summary}>
        <p>{view.summary.main}</p>
        {view.summary.note === '' ? null : <p className={styles.hint}>{view.summary.note}</p>}
      </div>
      {view.vatLine === '' ? null : <p className={styles.hint}>{view.vatLine}</p>}

      {history}
    </div>
  );
}
