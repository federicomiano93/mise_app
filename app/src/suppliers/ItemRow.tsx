import type { ReactNode } from 'react';
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
};

// One ingredient or packaging item.
//
// ⚠️ NOT INTERACTIVE IN THIS SLICE: its card is step 3e-2. A plain list item, no button, no chevron, nothing focusable —
// a row that looks tappable and does nothing is worse than a row that does not pretend.
//
// ⚠️ A SWITCHED-OFF ITEM IS DIMMED AND SAYS SO IN A WORD (P18: never colour alone). «Not declared» is a word too, read
// here at render because the venue's allergen switch can be thrown while the screen is open, and never drawn on packaging
// (a box has no allergens to declare).
export function ItemRow({ item, supplier }: Props) {
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
  const undeclared = !packaging && allergensOn(location) && allergenState(item) === 'unknown';

  return (
    <li className={styles.item} data-off={off}>
      <span className={styles.name}>{ingredientDisplayName(item)}</span>
      {meta !== '' ? <span className={styles.meta}>{meta}</span> : null}
      {(supplier === undefined && packaging) || off || undeclared ? (
        <span className={styles.tags}>
          {supplier === undefined && packaging ? <span className={styles.tag}>{t('sup.packagingTag')}</span> : null}
          {off ? <span className={styles.tag}>{t('sup.switchedOff')}</span> : null}
          {undeclared ? <span className={styles.tag} data-tone="todo">{t('sup.notDeclared')}</span> : null}
        </span>
      ) : null}
    </li>
  );
}
