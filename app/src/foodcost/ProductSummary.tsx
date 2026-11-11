import { useMemo, useState } from 'react';
import { productPreview, productionCost } from '@mise/shared/foodcost-model';
import type { CostTables, ProductPreview } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { foodcostTranslate } from './foodcostWords';
import { useMoney } from '../session/useMoney';
import { MissingList, PreviewPanel, previewCaption } from './PreviewPanel';
import { summaryExtras } from './summaryExtras';
import styles from './ProductSummary.module.css';

type Props = {
  // The product as typed (normalised) — or as stored, in the read view — and the tables its figures are worked out from.
  product: unknown;
  tables: CostTables;
};

type Shown = { preview: ProductPreview; costed: boolean };

// The summary at the top of the product's card (Federico, 7 Nov 2026; current app paintSummary): the same panel the phone's
// dialog shows, with the same numbers, so the two can never disagree.
//
// ⚠️ NOTHING COSTED YET: NO BOX FULL OF DASHES — a small card with only «Still missing:» and its checklist takes its place
// (11 Nov 2026: the card's old «Calculated costs» box, which used to say it, is gone).
// ⚠️ A FAULT HERE MUST NOT TAKE THE CARD DOWN (P17): the summary is a reading aid, and the form is drawn beside it.
// ⚠️ IT STAYS MOUNTED when there is nothing to show, so whether «Details» is open survives the product being un-costed for a
// moment (a cleared price) and costed again.
export function ProductSummary({ product, tables }: Props) {
  const { t } = useT();
  const money = useMoney();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // …and whether its «Which?» list is: the panel is drawn again whenever the product changes, this is not.
  const [whichOpen, setWhichOpen] = useState(false);
  const shown = useMemo((): Shown | null => {
    try {
      const costed = productionCost(product, tables).batchCost !== null;
      return { preview: productPreview(product, tables, foodcostTranslate(t)), costed };
    } catch {
      return null;
    }
  }, [product, tables, t]);
  const extras = useMemo(() => (shown !== null && shown.costed ? summaryExtras(product, tables) : null), [shown, product, tables]);

  if (shown === null) return null;
  if (!shown.costed) {
    if (shown.preview.missing.length === 0) return null;
    return (
      <div className={styles.summary}>
        <MissingList missing={shown.preview.missing} />
      </div>
    );
  }
  return (
    <div className={styles.summary} role="group" aria-label={previewCaption(t, shown.preview)}>
      <PreviewPanel
        preview={shown.preview}
        money={money}
        extras={extras}
        caption
        detailsOpen={detailsOpen}
        onDetailsToggle={setDetailsOpen}
        whichOpen={whichOpen}
        onWhichToggle={setWhichOpen}
      />
    </div>
  );
}
