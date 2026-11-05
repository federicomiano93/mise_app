import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { Plus, Settings } from 'lucide-react';
import { productsUsingRecipe, sortByMargin } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { wantsTitleFocus } from './foodcostNav';
import { NEW_OPENER, SETTINGS_OPENER, useHandBack } from './handBack';
import { useFoodcost } from './FoodcostContext';
import { ProductRow } from './ProductRow';
import styles from './FoodcostList.module.css';

type Props = {
  openProductId: string | null;
  onOpenProduct: (id: string) => void;
  onOpenNew: () => void;
  onOpenSettings: () => void;
  // The recipe whose products the list is narrowed to (`/food-cost?using=`), or null for the whole list.
  using: string | null;
  // «Show all» (the page stops being the recipe's) and Back (to the recipe), for the bar of a narrowed list.
  onShowAll: () => void;
  onBackToRecipe: () => void;
};

// The left column: «New product» (and, for whoever runs the place, Settings) over the products,
// worst food cost first.
//
// ⚠️ SETTINGS IS DRAWN ONLY FOR WHOEVER RUNS THE PLACE (`canManage`): it holds a wage figure. The
// session is known before this screen exists (SectionRoute), so the button is never drawn and then
// taken away.
export function FoodcostList({ openProductId, onOpenProduct, onOpenNew, onOpenSettings, using, onShowAll, onBackToRecipe }: Props) {
  const { t } = useT();
  const { canManage } = useSession();
  const money = useMoney();
  const handBack = useHandBack();
  const { products, productsLoaded, recipes, recipesLoaded, ingredientsLoaded, tables } = useFoodcost();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const title = useRef<HTMLHeadingElement>(null);
  // ⚠️ A ROW IS COSTED FROM THREE STORES: until recipes and prices have answered, a product would read
  // «not priced yet» only because its numbers are still on their way.
  const ready = productsLoaded && recipesLoaded && ingredientsLoaded;

  // The same object until a product, a recipe or a price changes: the sort costs every product.
  const shown = useMemo(() => (using === null ? products : productsUsingRecipe(products, using)), [products, using]);
  const ranked = useMemo(() => sortByMargin(shown, tables), [shown, tables]);

  // The entry's decision lands here by a replace: the narrowed list's title takes the focus (the page
  // itself keeps it, KEEP_FOCUS). Not on Back to it (a POP): the row that opened a product is owed it.
  useEffect(() => {
    if (using !== null && navigationType === 'REPLACE' && wantsTitleFocus(state)) title.current?.focus();
  }, [using]);

  const recipeName = using === null ? '' : String(recipes[using]?.name ?? '').trim();

  const newRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(NEW_OPENER, node); }, [handBack]);
  const settingsRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);

  return (
    <div className={styles.column}>
      {using === null ? null : (
        <FormBar
          backLabel={t('ui.back')}
          onBack={onBackToRecipe}
          title={recipeName === '' ? t('fc.productsWithThisRecipe') : t('fc.productsWithRecipe', { name: recipeName })}
          titleRef={title}
          action={<Button variant="secondary" onPress={onShowAll}>{t('fc.showAll')}</Button>}
        />
      )}
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
      ) : ranked.length === 0 ? (using !== null ? null : (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('fc.empty.title')}</p>
          <p className={styles.emptySub}>{t('fc.empty.sub')}</p>
          <Button onPress={onOpenNew}>{t('fc.empty.action')}</Button>
        </div>
      )) : (
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
