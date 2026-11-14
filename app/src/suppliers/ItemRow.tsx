import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { allergenState } from '@mise/shared/allergen-model';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { isFood, kindOf } from '@mise/shared/ingredient-kind';
import type { IngredientKind } from '@mise/shared/ingredient-kind';
import { allergensOn } from '@mise/shared/venue-features';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { fromInvoice } from './invoiceTag';
import { pricePerUnitText } from './priceText';
import { useSuppliers } from './SuppliersContext';
import { useMayWritePrices } from './useMayWritePrices';
import type { StoredDoc } from './suppliersSource';
import styles from './ItemRow.module.css';

// The tag of an item that is not an ingredient, on a supplier's own screen.
const KIND_TAG = {
  packaging: 'sup.packagingTag',
  resale: 'sup.resaleTag',
  other: 'sup.otherTag',
} as const satisfies Record<Exclude<IngredientKind, 'ingredient'>, MessageKey>;

// The card the item rows stand in.
export function ItemRows({ children }: { children: ReactNode }) {
  return <ul className={styles.rows}>{children}</ul>;
}

type Props = {
  item: StoredDoc;
  // The supplier's label, or '' when the item's supplierId names no supplier («No supplier»). ⚠️ undefined means «on the
  // supplier's own screen»: the supplier is not named again, and a packaging item says so with a tag. A deleted
  // supplier must never read as undefined (found driving the current app: every such item looked like one on its
  // supplier's own screen).
  supplier: string | undefined;
  // Opens the item's card. The row is a button; tapping the one already open does nothing.
  onOpen: (id: string) => void;
  isOpen: boolean;
  // The name Back from the card hands the focus back to (handBack.ts), and where it registers itself.
  opener: string;
  register: (name: string, node: HTMLElement | null) => void;
  // The row stands in the folded «Not in use» group, whose heading already says it: the «Switched off» tag is not drawn (the
  // row stays dimmed). Never set for anything else.
  inNotInUse?: boolean;
};

// One ingredient or packaging item.
//
// The whole row is the button that opens the item's card (step 3e-2), like a supplier's row.
//
// ⚠️ A SWITCHED-OFF ITEM IS DIMMED AND SAYS SO IN A WORD (P18: never colour alone). «Not declared» is a word too, read
// here at render because the venue's allergen switch can be thrown while the screen is open, and drawn only on food (a box,
// a bottle of water sold as it is or a detergent has no allergens to declare here).
export function ItemRow({ item, supplier, onOpen, isOpen, opener, register, inNotInUse = false }: Props) {
  const { t } = useT();
  const { location } = useSession();
  const money = useMoney();
  const kind = kindOf(item);
  const mayPrice = useMayWritePrices();
  const { pricesReadable } = useSuppliers();
  const price = pricePerUnitText(item, money, t);
  const named = [
    supplier === undefined ? '' : (supplier === '' ? t('sup.noSupplier') : supplier),
    typeof item.brand === 'string' ? item.brand : '',
  ].filter(part => part !== '');
  const meta = [...named, price].filter(part => part !== '').join(' · ');
  // ⚠️ THE ROWS DRAW BEFORE THE PRICES, AND A PRICE CAN WRAP ITS LINE (port of current-app fix 76be75d1; measured in Mise 2:
  // rows below moved by up to 325 px at 360 px when an owner's prices landed). So until the prices have answered, a row
  // without a price yet keeps the room for one, unseen: a sample price at the end of the meta line. An employee (no price
  // reader) never gets it, so no empty gap; a row that turns out to have no price gives the room back.
  const room = price === '' && mayPrice && !pricesReadable
    ? `${named.length > 0 ? ' · ' : ''}${pricePerUnitText({ pricePerUnit: 12.5, priceUnit: 'kg' }, money, t)}`
    : '';
  const off = item.active === false;
  const offTag = off && !inNotInUse;
  const node = useCallback((button: HTMLButtonElement | null) => { register(opener, button); }, [register, opener]);
  // On a supplier's own screen, where every kind sits in one list, an item that is not an ingredient says what it is (packaging,
  // and since 14 Nov 2026 resale and other, the same way).
  const kindTag = supplier === undefined && kind !== 'ingredient' ? KIND_TAG[kind] : null;
  const invoiceTag = fromInvoice(item);
  const undeclared = isFood(item) && allergensOn(location) && allergenState(item) === 'unknown';

  return (
    <li className={styles.item}>
      <button
        ref={node}
        type="button"
        className={styles.row}
        aria-current={isOpen ? 'true' : undefined}
        data-open={isOpen}
        data-off={off}
        onClick={() => { if (!isOpen) onOpen(item.id); }}
      >
        <span className={styles.main}>
          <span className={styles.name}>{ingredientDisplayName(item)}</span>
          {meta !== '' || room !== '' ? (
            <span className={styles.meta}>
              {meta}
              {room !== '' ? <span className={styles.priceRoom} aria-hidden="true" data-price-room="">{room}</span> : null}
            </span>
          ) : null}
          {kindTag !== null || invoiceTag || offTag || undeclared ? (
            <span className={styles.tags}>
              {kindTag !== null ? <span className={styles.tag}>{t(kindTag)}</span> : null}
              {invoiceTag ? <span className={styles.tag}>{t('sup.fromInvoice')}</span> : null}
              {offTag ? <span className={styles.tag}>{t('sup.switchedOff')}</span> : null}
              {undeclared ? <span className={styles.tag} data-tone="todo">{t('sup.notDeclared')}</span> : null}
            </span>
          ) : null}
        </span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </button>
    </li>
  );
}
