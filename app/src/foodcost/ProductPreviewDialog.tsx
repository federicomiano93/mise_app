import { useEffect, useMemo } from 'react';
import { productPreview } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { foodcostTranslate } from './foodcostWords';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useFoodcost } from './FoodcostContext';
import { PreviewPanel, previewCaption } from './PreviewPanel';

type Props = {
  // The product whose figures are shown.
  id: string;
  // «Open the card»: the product's own screen.
  onOpen: () => void;
  // «Close», Escape or a press on the backdrop: back to the list, the focus on the row that opened this.
  onClose: () => void;
};

// What a tap on a product of the list shows on a phone, before the whole card (Federico, 7 Nov 2026; current
// app openFromList in foodcost-main.js): the figures that decide its price, in a dialog whose main button
// opens the card. From 1000px the card opens beside the list instead and this is never drawn.
//
// ⚠️ NOTHING TAKES THE FOCUS BUT THE DIALOG ITSELF, so a tall preview on a short phone opens at its top, with
// the price in sight (the current app had to scroll its box back up after focusing its last button).
//
// ⚠️ THE FIGURES ARE WORKED OUT ON EVERY DRAW from the product as the store holds it now, so a price or a
// recipe that arrives while the dialog is open moves the numbers, and a product deleted elsewhere closes it
// with the message «Product deleted.» instead of showing a card for nothing.
export function ProductPreviewDialog({ id, onOpen, onClose }: Props) {
  const { t } = useT();
  const money = useMoney();
  const say = useStatusMessage();
  const { products, tables } = useFoodcost();
  const product = useMemo(() => products.find(candidate => candidate.id === id) ?? null, [products, id]);
  const preview = useMemo(() => (product === null ? null : productPreview(product, tables, foodcostTranslate(t))), [product, tables, t]);

  const gone = product === null;
  useEffect(() => {
    if (!gone) return;
    say(t('fc.productDeleted'));
    onClose();
  }, [gone]);

  if (product === null || preview === null) return null;

  return (
    <Dialog
      isOpen
      dismissable
      onClose={onClose}
      title={product.name === '' ? t('fc.untitledProduct') : product.name}
      message={previewCaption(t, preview)}
      actions={
        <>
          <Button onPress={onClose}>{t('fc.preview.close')}</Button>
          <Button variant="primary" onPress={onOpen}>{t('fc.preview.open')}</Button>
        </>
      }
    >
      <PreviewPanel preview={preview} money={money} />
    </Dialog>
  );
}
