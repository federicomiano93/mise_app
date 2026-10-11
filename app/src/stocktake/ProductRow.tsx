import { consumption } from '@mise/shared/inventory-model';
import type { InventoryMonth } from '@mise/shared/inventory-model';
import { useT } from '../i18n/useT';
import { CountBox } from './CountBox';
import type { Product } from './countListModel';
import { displayNumber } from './stocktakeFormat';
import { productLabel } from './stocktakeModel';
import styles from './ProductRow.module.css';

type Props = {
  product: Product;
  month: InventoryMonth;
  // The count boxes cannot be typed into: the month is closed, or has not answered yet.
  shut: boolean;
  // This product's own screen is the one open on the right (the tablet's split).
  isOpen: boolean;
  onOpen: () => void;
  register: (id: string, node: HTMLInputElement | null) => void;
  onEnter: () => void;
};

// One product on the counting list: its name, what the month says about it, and the box the count
// is typed into.
//
// ⚠️ THE ROW IS NOT A BUTTON AROUND A BOX: a button cannot contain an input. The name is the
// button and the box is the input, side by side in the row. The button's accessible name is
// «Open {name}», which contains the words it draws (WCAG 2.5.3, axe `label-content-name-mismatch`),
// so the line under the name is a sibling of the button and not inside it; the button is stretched
// over the whole left side by CSS, so a tap on that line opens the product too.
//
// ⚠️ KEYED BY THE PRODUCT'S ID (ProductList), so a count never re-creates a row: the box being
// reached for is still there when the finger lands, and the box being typed into keeps its text.
export function ProductRow({ product, month, shut, isOpen, onOpen, register, onEnter }: Props) {
  const { t, locale } = useT();
  const line = consumption(month, product.id);
  const name = productLabel(product) || t('stock.unnamedProduct');
  const unit = typeof product.unit === 'string' && product.unit !== '' ? product.unit : t('stock.packsShort');

  // What the row says under the name: the two numbers the answer is made of, and the answer. A row
  // nobody has counted says so in words instead — it is not a zero, and must never look like one.
  let sub: string;
  if (line.counted && line.hasOpening) {
    sub = t('stock.hadBoughtUsed', {
      had: displayNumber(line.opening, locale),
      bought: displayNumber(line.purchased, locale),
      used: displayNumber(line.used, locale),
    });
  } else {
    sub = line.counted ? t('stock.noOpeningYet') : t('stock.notCountedYet');
  }

  return (
    <li className={styles.row} data-open={isOpen}>
      <div className={styles.main}>
        <button
          type="button"
          className={styles.open}
          aria-label={t('stock.openProduct', { name })}
          aria-current={isOpen ? 'true' : undefined}
          onClick={onOpen}
        >
          <span className={styles.name}>{name}</span>
        </button>
        <p className={styles.sub} data-todo={!line.counted}>{sub}</p>
      </div>
      <div className={styles.count}>
        <CountBox
          id={product.id}
          label={t('stock.countFor', { name })}
          value={line.closing}
          disabled={shut}
          register={register}
          onEnter={onEnter}
        />
        <span className={styles.unit}>{unit}</span>
      </div>
    </li>
  );
}
