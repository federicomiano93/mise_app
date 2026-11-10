import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { BLOCKER_TEXT } from '@mise/shared/foodcost-model';
import type { ProductPreview, SaleUnit } from '@mise/shared/foodcost-model';
import { fcMoney, fcNumber } from '@mise/shared/fc-number';
import type { Money } from '@mise/shared/currency';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
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
  // The caption line («Summary per piece»). The phone's dialog says it as its description instead.
  caption?: boolean;
  // «Still missing:» and its checklist. The card has the same checklist in its answer panel, so it leaves them out here.
  showMissing?: boolean;
  // Whether «Details» is open, when the CALLER keeps it (the card draws this panel afresh when nothing is costed and
  // again when something is; a box that snapped shut meanwhile would be one more thing to fight with). Left out, the
  // panel keeps it itself.
  detailsOpen?: boolean;
  onDetailsToggle?: (open: boolean) => void;
};

// The figures of one product at a glance (Federico, 7 Nov 2026; current app preview-view.js after 39080577 and
// 56b2c90c), in the dialog a tap on the list opens on a phone and at the top of the product's card.
//
// His choice on the lab tablet («ci sono troppe voci»): FIVE rows in sight — selling price, cost, margin, food cost
// against its target, ideal price (with VAT, and without it underneath) — and the rest (raw materials, packaging,
// labour) behind a closed «Details».
//
// ⚠️ EVERY FIGURE COMES FROM productPreview() (shared/foodcost-model) and nothing is added up here, so the
// panel can never disagree with the list or the card. This file only chooses the words and the format.
// ⚠️ UNKNOWN IS A DASH, NEVER 0: a product with no price or no cost shows «—», because a zero would read as
// «free» or «no margin». The labour row is the one exception: it is owner/manager-only data (null for
// everybody else) and the whole row is left out then.
// ⚠️ THE LIGHT IS A DOT AND A WORD, NEVER COLOUR ALONE (P18): the status word follows the food cost, as in
// the list's rows; the dot is hidden from a screen reader because the word already says it.
// ⚠️ «DETAILS» IS A BUTTON, NOT <details>: the phone shows this panel inside the app's dialog, whose focus trap
// walks buttons, fields and links — a <summary> there could not be reached from a keyboard. aria-expanded tells a
// screen reader whether it is open.
export function PreviewPanel({
  preview, money, caption = false, showMissing = true, detailsOpen, onDetailsToggle,
}: Props) {
  const { t } = useT();
  const moreId = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = detailsOpen ?? ownOpen;
  const toggle = () => {
    setOwnOpen(!open);
    onDetailsToggle?.(!open);
  };
  const hasLabour = preview.labourUnitCost !== null;
  const shown = (value: number | null): string => (value === null ? DASH : fcMoney(value, money));

  const foodCostText = preview.foodCostPct === null
    ? DASH
    : preview.targetPct === null
      ? t('fc.preview.noTarget', { pct: fcNumber(preview.foodCostPct, money) })
      : t('fc.preview.vsTarget', { pct: fcNumber(preview.foodCostPct, money), target: fcNumber(preview.targetPct, money) });

  return (
    <div className={styles.panel}>
      {caption ? <p className={styles.caption}>{previewCaption(t, preview)}</p> : null}
      <dl className={styles.list}>
        <Row label={t('fc.preview.price')} value={shown(preview.sellingPrice)} />
        {/* Materials and packaging, plus the work where there is a figure for it. */}
        <Row label={t('fc.preview.cost')} value={shown(preview.totalUnitCost)} />
        {/* The app's margin: net price less materials and packaging — so, where a labour row exists in «Details», the
            label says the labour is left out of it. */}
        <Row label={hasLabour ? t('fc.preview.marginNoLabour') : t('fc.preview.margin')} value={shown(preview.margin)} />
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
        <Row label={t('fc.preview.ideal')} value={shown(preview.idealGross)} ideal />
      </dl>
      {/* Under the ideal price: the same price without VAT, and the target it is for — or nothing, while there is no
          net figure to give. */}
      {preview.idealNet !== null && preview.targetPct !== null ? (
        <p className={styles.sub}>
          {t('fc.preview.idealSub', { net: fcMoney(preview.idealNet, money), target: fcNumber(preview.targetPct, money) })}
        </p>
      ) : null}
      {/* ⚠️ A PARTIAL COST MUST NEVER LOOK COMPLETE: every figure above is too LOW. */}
      {preview.partial ? <p className={styles.partial}>{t('fc.costPartial')}</p> : null}
      {showMissing && preview.missing.length > 0 ? (
        <>
          <p className={styles.missingTitle}>{t('fc.preview.missing')}</p>
          <ul className={styles.missing}>
            {preview.missing.map(key => <li key={key}>{t(BLOCKER_TEXT[key])}</li>)}
          </ul>
        </>
      ) : null}
      {/* Where the card has a checklist of its own, a missing target is still said here: it is why there is no net price. */}
      {!showMissing && preview.idealNet === null && preview.missing.includes('no-target') && preview.totalUnitCost !== null
        ? <p className={styles.note}>{t(BLOCKER_TEXT['no-target'])}</p>
        : null}
      <div className={styles.more}>
        <Button variant="bare" className={styles.moreButton} aria-expanded={open} aria-controls={moreId} onPress={toggle}>
          <span>{t('fc.preview.details')}</span>
          <ChevronDown aria-hidden="true" className={styles.chevron} />
        </Button>
        <dl id={moreId} className={styles.list} hidden={!open}>
          <Row label={t('fc.preview.materials')} value={shown(preview.materialsUnitCost)} />
          <Row
            label={t('fc.preview.packaging')}
            value={preview.hasPackaging ? shown(preview.packagingUnitCost) : t('fc.preview.noPackaging')}
          />
          {hasLabour ? <Row label={t('fc.preview.labour')} value={shown(preview.labourUnitCost)} /> : null}
        </dl>
      </div>
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
