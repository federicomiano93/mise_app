import { useCallback, useMemo } from 'react';
import { Plus, Settings } from 'lucide-react';
import { sortByMargin } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { NEW_OPENER, SETTINGS_OPENER, useHandBack } from './handBack';
import { useFoodcost } from './FoodcostContext';
import { ProductRow } from './ProductRow';
import styles from './FoodcostList.module.css';

type Props = {
  openProductId: string | null;
  onOpenProduct: (id: string) => void;
  onOpenNew: () => void;
  onOpenSettings: () => void;
};

// The left column: «New product» (and, for whoever runs the place, Settings) over the products,
// worst food cost first.
//
// ⚠️ SETTINGS IS DRAWN ONLY FOR WHOEVER RUNS THE PLACE (`canManage`): it holds a wage figure. The
// session is known before this screen exists (SectionRoute), so the button is never drawn and then
// taken away.
export function FoodcostList({ openProductId, onOpenProduct, onOpenNew, onOpenSettings }: Props) {
  const { t } = useT();
  const { canManage } = useSession();
  const money = useMoney();
  const handBack = useHandBack();
  const { products, productsLoaded, recipesLoaded, ingredientsLoaded, tables } = useFoodcost();
  // ⚠️ A ROW IS COSTED FROM THREE STORES: until recipes and prices have answered, a product would read
  // «not priced yet» only because its numbers are still on their way.
  const ready = productsLoaded && recipesLoaded && ingredientsLoaded;

  // The same object until a product, a recipe or a price changes: the sort costs every product.
  const ranked = useMemo(() => sortByMargin(products, tables), [products, tables]);

  const newRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(NEW_OPENER, node); }, [handBack]);
  const settingsRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);

  return (
    <div className={styles.column}>
      <div className={styles.actions}>
        <Button ref={newRef} variant="primary" className={styles.add} onPress={onOpenNew}>
          <Plus aria-hidden="true" />
          {t('fc.newProduct')}
        </Button>
        {canManage ? (
          <Button ref={settingsRef} variant="secondary" className={styles.settings} onPress={onOpenSettings}>
            <Settings aria-hidden="true" />
            {t('section.settings')}
          </Button>
        ) : null}
      </div>

      {!ready ? (
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      ) : ranked.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('fc.empty.title')}</p>
          <p className={styles.emptySub}>{t('fc.empty.sub')}</p>
          <Button onPress={onOpenNew}>{t('fc.empty.action')}</Button>
        </div>
      ) : (
        <ul className={styles.rows}>
          {ranked.map(({ product, result }) => (
            <ProductRow
              key={product.id}
              id={product.id}
              name={product.name}
              result={result}
              money={money}
              isOpen={product.id === openProductId}
              onOpen={() => onOpenProduct(product.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
