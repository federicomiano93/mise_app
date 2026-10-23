import { useId } from 'react';
import type { ReactNode, Ref } from 'react';
import { useT } from '../i18n/useT';
import type { LegacyBox, LegacyView } from './legacyPriceModel';
import styles from './IngredientCard.module.css';

type Props = {
  view: LegacyView;
  // The price box a refused Save pointed at, or null.
  refused: LegacyBox | null;
  // One ref per box, so a refusal can focus it.
  boxRefs: Readonly<Record<LegacyBox, Ref<HTMLInputElement>>>;
  onUnit(unit: string): void;
  onBox(box: LegacyBox, text: string): void;
  onItemUnit(unit: string): void;
  onVat(vat: string): void;
  // The price history block (existing items only).
  history: ReactNode;
};

// The price block of the card of before (step 3e-5, parity C82): «How it is bought» beside the rate (or, by the case, the case
// price), the «Contains [count] × [size] [unit]» row, the permanent «net of VAT» note, the piece weight, the VAT menu, the live
// summary and the history — drawn from a LegacyView (legacyPriceModel.ts). It holds no state of its own, like PriceSection.
export function LegacyPriceSection({ view, refused, boxRefs, onUnit, onBox, onItemUnit, onVat, history }: Props) {
  const { t } = useT();
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;
  const invalid = (box: LegacyBox) => ({
    'aria-invalid': refused === box ? true : undefined,
    'aria-describedby': refused === box ? id(`${box}-error`) : undefined,
  });
  const error = (box: LegacyBox) => (
    <p id={id(`${box}-error`)} role="status" className={refused === box ? styles.error : styles.quiet}>
      {refused === box ? t('sup.price.notANumber') : ''}
    </p>
  );
  const box = (name: LegacyBox, value: string, extra: { label?: string; placeholder?: string; className?: string; fieldId?: string }) => (
    <input
      ref={boxRefs[name]}
      id={extra.fieldId}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={extra.className ?? styles.box}
      aria-label={extra.label}
      placeholder={extra.placeholder}
      {...invalid(name)}
      value={value}
      onChange={event => { onBox(name, event.target.value); }}
    />
  );

  const row = view.caseRow;
  return (
    <div className={styles.priceBlock}>
      <div className={styles.pair}>
        <div className={styles.field}>
          <label htmlFor={id('unit')} className={styles.label}>{view.unit.label}</label>
          <select id={id('unit')} className={styles.box} value={view.unit.value} onChange={event => { onUnit(event.target.value); }}>
            {view.unit.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        {/* The right cell is ALWAYS the price: the rate, or by the case the case price. */}
        {view.rate.shown ? (
          <div className={styles.field}>
            <label htmlFor={id('rate')} className={styles.label}>{view.rate.label}</label>
            {box('rate', view.rate.value, { placeholder: view.rate.placeholder, fieldId: id('rate') })}
            {error('rate')}
          </div>
        ) : null}
        {view.casePrice.shown ? (
          <div className={styles.field}>
            <label htmlFor={id('casePrice')} className={styles.label}>{view.casePrice.label}</label>
            {box('casePrice', view.casePrice.value, { fieldId: id('casePrice') })}
            {error('casePrice')}
          </div>
        ) : null}
      </div>

      {row.shown ? (
        <div role="group" aria-labelledby={id('contains-label')} className={styles.field}>
          <span id={id('contains-label')} className={styles.label}>{row.label}</span>
          <div className={styles.caseRow}>
            {box('caseCount', row.count.value, { label: row.count.label, className: `${styles.box} ${styles.count}` })}
            {row.times ? <span aria-hidden="true" className={styles.times}>×</span> : null}
            {row.size.shown
              ? box('caseSize', row.size.value, { label: row.size.label, className: `${styles.box} ${styles.count}` })
              : null}
            <div className={styles.inner}>
              <select
                className={styles.box}
                aria-label={row.item.label}
                value={row.item.value}
                onChange={event => { onItemUnit(event.target.value); }}
              >
                {row.item.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          {error('caseCount')}
          {row.size.shown ? error('caseSize') : null}
        </div>
      ) : null}
      {view.packChangedNote === null ? null : <p className={styles.hint}>{view.packChangedNote}</p>}

      <p className={styles.hint}>{view.exVatNote}</p>

      {view.pieceWeight.shown ? (
        <div className={styles.field}>
          <label htmlFor={id('piece')} className={styles.label}>{view.pieceWeight.label}</label>
          <input
            ref={boxRefs.pieceKg}
            id={id('piece')}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className={styles.box}
            placeholder={view.pieceWeight.placeholder}
            {...invalid('pieceKg')}
            aria-describedby={[id('piece-hint'), refused === 'pieceKg' ? id('pieceKg-error') : ''].filter(Boolean).join(' ')}
            value={view.pieceWeight.value}
            onChange={event => { onBox('pieceKg', event.target.value); }}
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
