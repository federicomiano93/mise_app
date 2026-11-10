import { BLOCKER_TEXT } from '@mise/shared/foodcost-model';
import type { ProductPreview, SaleUnit } from '@mise/shared/foodcost-model';
import { fcMoney, fcNumber } from '@mise/shared/fc-number';
import type { Money } from '@mise/shared/currency';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { statusWord } from './productRowModel';
import styles from './PreviewPanel.module.css';

// Keys, resolved when the panel is drawn: a `t()` here at module load would freeze the language the page
// booted in.
const UNIT_TEXT = {
  piece: 'fc.perPiece',
  kg: 'fc.perKg',
  pack: 'fc.perPack',
} as const satisfies Record<SaleUnit, MessageKey>;

const DASH = '—';

// «per piece» / «per kg» / «per pack» — what every figure of the panel is per; «Summary» alone while the
// product has no way of selling yet.
export function previewCaption(t: (key: MessageKey, params?: Record<string, string>) => string, preview: ProductPreview): string {
  return preview.unit === null
    ? t('fc.preview.captionNoUnit')
    : t('fc.preview.caption', { unit: t(UNIT_TEXT[preview.unit]) });
}

type Props = {
  preview: ProductPreview;
  money: Money;
};

// The figures of one product at a glance (Federico, 7 Nov 2026; current app preview-view.js, the eight-figure
// panel of e81a2617 and 39f192ac), drawn in the dialog a tap on the list opens on a phone.
//
// ⚠️ EVERY FIGURE COMES FROM productPreview() (shared/foodcost-model) and nothing is added up here, so the
// panel can never disagree with the list or the card. This file only chooses the words and the format.
// ⚠️ UNKNOWN IS A DASH, NEVER 0: a product with no price or no cost shows «—», because a zero would read as
// «free» or «no margin». The labour row is the one exception: it is owner/manager-only data (null for
// everybody else) and the whole row is left out then.
// ⚠️ THE LIGHT IS A DOT AND A WORD, NEVER COLOUR ALONE (P18): the status word follows the food cost, as in
// the list's rows; the dot is hidden from a screen reader because the word already says it.
export function PreviewPanel({ preview, money }: Props) {
  const { t } = useT();
  const hasLabour = preview.labourUnitCost !== null;
  const shown = (value: number | null): string => (value === null ? DASH : fcMoney(value, money));

  const foodCostText = preview.foodCostPct === null
    ? DASH
    : preview.targetPct === null
      ? t('fc.preview.noTarget', { pct: fcNumber(preview.foodCostPct, money) })
      : t('fc.preview.vsTarget', { pct: fcNumber(preview.foodCostPct, money), target: fcNumber(preview.targetPct, money) });

  return (
    <div className={styles.panel}>
      <dl className={styles.list}>
        <Row label={t('fc.preview.price')} value={shown(preview.sellingPrice)} />
        <Row label={t('fc.preview.materials')} value={shown(preview.materialsUnitCost)} />
        <Row
          label={t('fc.preview.packaging')}
          value={preview.hasPackaging ? shown(preview.packagingUnitCost) : t('fc.preview.noPackaging')}
        />
        {hasLabour ? <Row label={t('fc.preview.labour')} value={shown(preview.labourUnitCost)} /> : null}
        <Row label={t('fc.preview.total')} value={shown(preview.totalUnitCost)} />
        <div className={styles.row} data-status={preview.status ?? 'none'}>
          <dt>{t('fc.preview.foodCost')}</dt>
          <dd className={styles.foodCost}>
            {preview.foodCostPct === null ? null : <span className={styles.dot} aria-hidden="true" />}
            <span>{foodCostText}</span>
            {preview.foodCostPct === null || preview.status === null
              ? null
              : <span className={styles.word}>{statusWord(t, preview.status)}</span>}
          </dd>
        </div>
        <Row label={hasLabour ? t('fc.preview.marginNoLabour') : t('fc.preview.margin')} value={shown(preview.margin)} />
        <Row label={t('fc.preview.idealGross')} value={shown(preview.idealGross)} ideal />
        <Row label={t('fc.preview.idealNet')} value={shown(preview.idealNet)} ideal />
      </dl>

      {preview.idealNet !== null && preview.targetPct !== null
        ? <p className={styles.note}>{t('fc.preview.idealBasis', { target: fcNumber(preview.targetPct, money) })}</p>
        : null}
      {/* ⚠️ A PARTIAL COST MUST NEVER LOOK COMPLETE: every figure above is too LOW. */}
      {preview.partial ? <p className={styles.partial}>{t('fc.costPartial')}</p> : null}
      {preview.missing.length === 0 ? null : (
        <>
          <p className={styles.missingTitle}>{t('fc.preview.missing')}</p>
          <ul className={styles.missing}>
            {preview.missing.map(key => <li key={key}>{t(BLOCKER_TEXT[key])}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function Row({ label, value, ideal = false }: { label: string; value: string; ideal?: boolean }) {
  return (
    <div className={styles.row} data-ideal={ideal}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
