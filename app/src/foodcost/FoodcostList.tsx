import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { Plus, Search, Settings } from 'lucide-react';
import { nameMatches, productsUsingRecipe, sortByMargin } from '@mise/shared/foodcost-model';
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

  // The search over the NAMES (Federico, 7 Nov 2026), applied AFTER the sort so the rows that stay keep the worst-first order. Its text lives
  // here, in a part that stays mounted from one address to the next, so Back from a product finds the same search.
  const [query, setQuery] = useState('');
  const found = useMemo(() => ranked.filter(({ product }) => nameMatches(product, query)), [ranked, query]);

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

      {/* ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT: it is a controlled input in a part that stays mounted,
          and only the rows below it are redrawn, so a snapshot landing mid-keystroke finds the text and the keyboard
          where the person left them. Not drawn while there is nothing to search. */}
      {ready && ranked.length > 0 ? (
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <input
            type="search"
            autoComplete="off"
            className={styles.input}
            aria-label={t('fc.search')}
            placeholder={t('fc.search')}
            value={query}
            onChange={event => { setQuery(event.target.value); }}
          />
        </div>
      ) : null}

      {!ready ? (
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      ) : ranked.length === 0 ? (using !== null ? null : (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('fc.empty.title')}</p>
          <p className={styles.emptySub}>{t('fc.empty.sub')}</p>
          <Button onPress={onOpenNew}>{t('fc.empty.action')}</Button>
        </div>
      )) : found.length === 0 ? null : (
        <ul className={styles.rows}>
          {found.map(({ product, result }) => (
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

      {/* A search that matches nothing stays a small line under the box. The region is drawn before it speaks, so the line is
          announced when it arrives. */}
      <div role="status">
        {ready && ranked.length > 0 && found.length === 0
          ? <p className={styles.nothing}>{t('fc.searchNone', { q: query.trim() })}</p>
          : null}
      </div>
    </div>
  );
}
