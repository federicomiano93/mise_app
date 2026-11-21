import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { ChevronRight, Plus, Search, Settings, Tags } from 'lucide-react';
import { isCakeProductId } from '@mise/shared/cake-model';
import { nameMatches, productsUsingRecipe, semiCardCost, sortByMargin } from '@mise/shared/foodcost-model';
import { recipesWithoutProducts } from '@mise/shared/from-recipes';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { CategoriesDialog } from './CategoriesDialog';
import { CAKES_GROUP_ID, NO_CATEGORY_KEY, groupRows, grouped, isGroupOpen } from './categoriesModel';
import type { Group } from './categoriesModel';
import { semiFigures } from './semiWords';
import { wantsTitleFocus } from './foodcostNav';
import { FROM_BOOK_OPENER, NEW_OPENER, SETTINGS_OPENER, useHandBack } from './handBack';
import { useFoodcost } from './FoodcostContext';
import { FromBookBox } from './FromBookBox';
import { FromBookDialog } from './FromBookDialog';
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
  const { products, productsLoaded, productsFromServer, recipes, recipesLoaded, recipesFromServer, ingredientsLoaded, tables, categories } = useFoodcost();
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

  // ── Categories (model 4, 20 Nov 2026) ──
  // The list is drawn in groups once the venue has at least one category: the categories in their order, then «Cakes» (every cake's
  // card, display only), then «No category» last, a group with no cards not drawn. With no category the list is flat. ⚠️ EVERY GROUP STARTS CLOSED (his explicit ask) and a tap opens or closes one; the group of the
  // card that is open opens by itself; while a search is typed the matching cards show with their groups open, and clearing it
  // returns to the person's own taps. The taps live in this component's state only — nothing is stored.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const searching = query.trim() !== '';
  const groups = useMemo(() => (grouped(categories) ? groupRows(found, categories) : null), [found, categories]);
  const toggleGroup = (id: string | null) => {
    const key = id ?? NO_CATEGORY_KEY;
    setOpenGroups(before => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  // ⚠️ THE GROUP OF THE CARD THAT WAS OPEN STAYS OPEN once the card is left: Back hands the focus to that card's row, and a row inside a
  // closed group cannot take it (the focus would fall to the page). The group is remembered as the person's own tap, the moment it opens by
  // itself for the open card.
  useEffect(() => {
    if (openProductId === null || groups === null) return;
    const home = groups.find(group => group.items.some(row => row.product.id === openProductId));
    if (!home) return;
    const key = home.id ?? NO_CATEGORY_KEY;
    setOpenGroups(before => (before.has(key) ? before : new Set(before).add(key)));
  }, [openProductId, groups]);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const categoriesRef = useRef<HTMLButtonElement>(null);
  const closeCategories = () => {
    setCategoriesOpen(false);
    // The dialog gives the focus back to its button on its own; this keeps it there when the list changed meanwhile.
    requestAnimationFrame(() => { categoriesRef.current?.focus(); });
  };

  // One row of the list: a semi-finished card shows its cost per kilo, a finished product its food cost (as before).
  const rowOf = ({ product, result }: (typeof found)[number]) => (
    <ProductRow
      key={product.id}
      id={product.id}
      name={product.name}
      result={result}
      money={money}
      isOpen={product.id === openProductId}
      onOpen={() => onOpenProduct(product.id)}
      semi={product.kind === 'semi' ? semiFigures(t, money, semiCardCost(product, tables)) : null}
      cake={isCakeProductId(product.id)}
    />
  );
  const groupHeadId = useId();

  // The entry's decision lands here by a replace: the narrowed list's title takes the focus (the page
  // itself keeps it, KEEP_FOCUS). Not on Back to it (a POP): the row that opened a product is owed it.
  useEffect(() => {
    if (using !== null && navigationType === 'REPLACE' && wantsTitleFocus(state)) title.current?.focus();
  }, [using]);

  const recipeName = using === null ? '' : String(recipes[using]?.name ?? '').trim();

  // ⚠️ THE BOX IS NEVER DECIDED ON A LIST THAT HAS NOT ARRIVED (current app b5cf999e): a product's id comes from its recipe and a
  // save writes the WHOLE document, so a list still empty would offer every recipe. BOTH LISTS MUST HAVE COME FROM THE SERVER:
  // `productsLoaded` is already true at start-up from the phone's own copy, which is older than the current app's «live» test
  // (hasLiveProducts / hasLiveRecipes) allows. This also hides the box offline, where Create is certain to fail. Only the people
  // who run the place see it (they are the ones who may create a product from the book), and not while the list is narrowed to a
  // recipe. The create itself asks the server again (foodcostStore.createProductsFromRecipes), whatever this count says.
  const missing = useMemo(
    () => (canManage && productsFromServer && recipesFromServer && using === null ? recipesWithoutProducts(recipes, products).create.length : 0),
    [canManage, productsFromServer, recipesFromServer, using, recipes, products],
  );
  // The choice screen is a dialog, mounted only while it is open, so its lists are a snapshot taken at the tap.
  const [choosing, setChoosing] = useState(false);
  const closing = useRef(false);
  const openFromBook = () => {
    handBack.expect(FROM_BOOK_OPENER);
    setChoosing(true);
  };
  // Closed unused: the box's button takes the focus back. After products were made the box goes (the live list brings them in),
  // so the focus goes to «New product», which is always there.
  const closeFromBook = (made: boolean) => {
    if (made) handBack.expect(NEW_OPENER);
    closing.current = true;
    setChoosing(false);
  };
  useEffect(() => {
    if (choosing || !closing.current) return;
    closing.current = false;
    // After the dialog's own focus restore, which runs on the next frame: the last word is ours.
    requestAnimationFrame(() => { handBack.deliver(); });
  }, [choosing, handBack]);

  const newRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(NEW_OPENER, node); }, [handBack]);
  const fromBookRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(FROM_BOOK_OPENER, node); }, [handBack]);
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
        <Button ref={categoriesRef} variant="secondary" className={styles.settings} onPress={() => { setCategoriesOpen(true); }}>
          <Tags aria-hidden="true" />
          {t('fc.cat.button')}
        </Button>
        {canManage ? (
          <Button ref={settingsRef} variant="secondary" className={styles.settings} onPress={onOpenSettings}>
            <Settings aria-hidden="true" />
            {t('section.settings')}
          </Button>
        ) : null}
      </div>

      {missing > 0 ? <FromBookBox count={missing} onOpen={openFromBook} buttonRef={fromBookRef} /> : null}
      {choosing ? <FromBookDialog onClose={closeFromBook} /> : null}
      {categoriesOpen ? <CategoriesDialog onClose={closeCategories} /> : null}

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
      )) : found.length === 0 ? null : groups === null ? (
        <ul className={styles.rows}>{found.map(rowOf)}</ul>
      ) : (
        <div className={styles.groups}>
          {groups.map((group: Group<(typeof found)[number]>) => {
            const open = isGroupOpen(group.id, group, { userOpen: openGroups, searching, openProductId });
            const key = group.id ?? NO_CATEGORY_KEY;
            const bodyId = `${groupHeadId}-${key}`;
            return (
              <section key={key} className={styles.group}>
                {/* The header is a button (48px and more): the group opens and closes on a tap. */}
                <h2 className={styles.groupHeading}>
                  <button
                    type="button"
                    className={styles.groupButton}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => { toggleGroup(group.id); }}
                  >
                    <ChevronRight aria-hidden="true" className={styles.chevron} data-open={open} />
                    <span className={styles.groupName}>{group.id === CAKES_GROUP_ID ? t('fc.cat.cakes') : group.name ?? t('fc.cat.none')}</span>
                    <span className={styles.groupCount}>{t('fc.cat.cards', { n: group.items.length })}</span>
                  </button>
                </h2>
                <ul id={bodyId} className={styles.rows} hidden={!open}>{group.items.map(rowOf)}</ul>
              </section>
            );
          })}
        </div>
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
