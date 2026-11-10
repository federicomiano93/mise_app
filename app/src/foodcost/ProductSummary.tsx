import { useMemo, useState } from 'react';
import { productPreview, productionCost } from '@mise/shared/foodcost-model';
import type { CostTables, ProductPreview } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { PreviewPanel, previewCaption } from './PreviewPanel';
import styles from './ProductSummary.module.css';

type Props = {
  // The product as typed (normalised) — or as stored, in the read view — and the tables its figures are worked out from.
  product: unknown;
  tables: CostTables;
};

// The summary at the top of the product's card (Federico, 7 Nov 2026; current app paintSummary): the same panel the phone's
// dialog shows, with the same numbers, so the two can never disagree.
//
// ⚠️ NOTHING COSTED YET: NO BOX AT ALL, never a frame full of dashes — the answer panel below says what is missing.
// ⚠️ A FAULT HERE MUST NOT TAKE THE CARD DOWN (P17): the summary is a reading aid, and the form is drawn beside it.
// ⚠️ IT STAYS MOUNTED when there is nothing to show, so whether «Details» is open survives the product being un-costed for a
// moment (a cleared price) and costed again.
export function ProductSummary({ product, tables }: Props) {
  const { t } = useT();
  const money = useMoney();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const preview = useMemo((): ProductPreview | null => {
    try {
      return productionCost(product, tables).batchCost === null ? null : productPreview(product, tables);
    } catch {
      return null;
    }
  }, [product, tables]);

  if (preview === null) return null;
  return (
    <div className={styles.summary} role="group" aria-label={previewCaption(t, preview)}>
      <PreviewPanel
        preview={preview}
        money={money}
        caption
        showMissing={false}
        detailsOpen={detailsOpen}
        onDetailsToggle={setDetailsOpen}
      />
    </div>
  );
}
