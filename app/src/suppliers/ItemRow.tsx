import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { allergenState } from '@mise/shared/allergen-model';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { isPackaging } from '@mise/shared/ingredient-kind';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { pricePerUnitText } from './priceText';
import type { StoredDoc } from './suppliersSource';
import styles from './ItemRow.module.css';

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
// here at render because the venue's allergen switch can be thrown while the screen is open, and never drawn on packaging
// (a box has no allergens to declare).
export function ItemRow({ item, supplier, onOpen, isOpen, opener, register, inNotInUse = false }: Props) {
  const { t } = useT();
  const { location } = useSession();
  const money = useMoney();
  const packaging = isPackaging(item);
  const meta = [
    supplier === undefined ? '' : (supplier === '' ? t('sup.noSupplier') : supplier),
    typeof item.brand === 'string' ? item.brand : '',
    pricePerUnitText(item, money, t),
  ].filter(part => part !== '').join(' · ');
  const off = item.active === false;
  const offTag = off && !inNotInUse;
  const node = useCallback((button: HTMLButtonElement | null) => { register(opener, button); }, [register, opener]);
  const undeclared = !packaging && allergensOn(location) && allergenState(item) === 'unknown';

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
          {meta !== '' ? <span className={styles.meta}>{meta}</span> : null}
          {(supplier === undefined && packaging) || offTag || undeclared ? (
            <span className={styles.tags}>
              {supplier === undefined && packaging ? <span className={styles.tag}>{t('sup.packagingTag')}</span> : null}
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
