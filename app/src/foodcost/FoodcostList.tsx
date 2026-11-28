import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { isCakeProductId } from '@mise/shared/cake-model';
import { nameMatches, productsUsingRecipe, semiCardCost, sortByMargin } from '@mise/shared/foodcost-model';
import type { Product, ProductKind } from '@mise/shared/foodcost-model';
import { recipesWithoutProducts } from '@mise/shared/from-recipes';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { CollapsibleGroup } from '../ui/CollapsibleGroup';
import { FormBar } from '../ui/FormBar';
import { useCardCategories } from './useCardCategories';
import { CAKES_GROUP_ID, NO_CATEGORY_KEY, groupRows, grouped, isGroupOpen, kindOf } from './categoriesModel';
import type { Group } from './categoriesModel';
import { semiFigures } from './semiWords';
import { wantsTitleFocus } from './foodcostNav';
import { FROM_BOOK_OPENER, NEW_OPENER, useHandBack } from './handBack';
import { useFoodcost } from './FoodcostContext';
import { FromBookBox } from './FromBookBox';
import { FromBookDialog } from './FromBookDialog';
import { ProductRow } from './ProductRow';
import styles from './FoodcostList.module.css';

// The two lists the page is split in (21 Nov 2026): finished products and semi-finished cards, told apart by `product.kind`.
const KIND_TABS: readonly ProductKind[] = ['finished', 'semi'];
const KIND_TAB_KEY = { finished: 'fc.tab.finished', semi: 'fc.tab.semi' } as const;
const tabId = (kind: ProductKind): string => `fc-kind-tab-${kind}`;
const PANEL_ID = 'fc-kind-panel';

// Where an arrow, Home or End key sends the selection (the tabs of Suppliers and of the Calculator do the same).
function targetOf(key: string, index: number, last: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return index === last ? 0 : index + 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return index === 0 ? last : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

type Props = {
  openProductId: string | null;
  onOpenProduct: (id: string) => void;
  // The kind of card the list is showing: «New product» from «Semi-finished» opens the new card as a semi-finished one.
  onOpenNew: (kind: ProductKind) => void;
  // The recipe whose products the list is narrowed to (`/food-cost?using=`), or null for the whole list.
  using: string | null;
  // «Show all» (the page stops being the recipe's) and Back (to the recipe), for the bar of a narrowed list.
  onShowAll: () => void;
  onBackToRecipe: () => void;
};

// The left column: «New product» over the products, worst food cost first. Settings is the gear beside the page's
// title (FoodcostSection), drawn only for whoever runs the place (`canManage`): it holds a wage figure.
export function FoodcostList({ openProductId, onOpenProduct, onOpenNew, using, onShowAll, onBackToRecipe }: Props) {
  const { t } = useT();
  const { canManage } = useSession();
  const money = useMoney();
  const handBack = useHandBack();
  const { products, productsLoaded, productsFromServer, recipes, recipesLoaded, recipesFromServer, ingredientsLoaded, tables } = useFoodcost();
  const categories = useCardCategories();
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

  // ── Finished products | Semi-finished (21 Nov 2026) ──
  // The kind filter comes AFTER the sort (each list keeps its worst-first order) and BEFORE the groups. The choice lives here only, while the
  // person is in the section: nothing is stored, and a new visit starts on «Finished products».
  const [kindTab, setKindTab] = useState<ProductKind>('finished');
  const kindTabs = useRef(new Map<ProductKind, HTMLButtonElement>());
  const ofKind = useMemo(() => ranked.filter(({ product }) => kindOf(product) === kindTab), [ranked, kindTab]);
  const found = useMemo(() => ofKind.filter(({ product }) => nameMatches(product, query)), [ofKind, query]);
  // What the search finds in the OTHER list, so a search that finds nothing here can say where it would find something.
  const foundElsewhere = useMemo(
    () => (query.trim() === '' ? 0 : ranked.filter(({ product }) => kindOf(product) !== kindTab && nameMatches(product, query)).length),
    [ranked, kindTab, query],
  );
  // ⚠️ CHANGING THE TAB CLEARS THE SEARCH, as in Suppliers: a name typed for one list would hide the other's cards without a word.
  const pickKind = (kind: ProductKind) => {
    if (kind === kindTab) return;
    setKindTab(kind);
    setQuery('');
  };
  function onKindKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = targetOf(event.key, index, KIND_TABS.length - 1);
    const next = target === null ? undefined : KIND_TABS[target];
    if (!next) return;
    event.preventDefault();
    pickKind(next);
    kindTabs.current.get(next)?.focus();
  }
  // ⚠️ A CARD OF THE OTHER KIND OPENED (a link from a recipe, or Cakes opening its semi-finished card) MOVES THE TAB TO ITS KIND, once per
  // card, so Back finds its row in the list and hands it the focus. A tab picked by hand while the card stays open beside is left alone.
  const switchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (openProductId === null) {
      switchedFor.current = null;
      return;
    }
    if (switchedFor.current === openProductId) return;
    const open = products.find(product => product.id === openProductId);
    if (!open) return;
    switchedFor.current = openProductId;
    const kind = kindOf(open);
    if (kind !== kindTab) pickKind(kind);
  }, [openProductId, products]);
  // ⚠️ THE LIST NARROWED TO A RECIPE (`?using=`) STARTS ON «Finished products» if it has any, else on «Semi-finished». Decided once per
  // narrowing, when the products have arrived; «Show all» leaves the tab where it is.
  const narrowedHandled = useRef<string | null>(null);
  useEffect(() => {
    if (using === null) {
      narrowedHandled.current = null;
      return;
    }
    if (!ready || narrowedHandled.current === using) return;
    narrowedHandled.current = using;
    // ⚠️ AN OPEN CARD OF THE NARROWED LIST DECIDES THE TAB: the effect above chose its kind from the same render's stale tab, and
    // two choices in one pass would let the later one win. The card's kind is set here again, and the narrowing counts as handled.
    const open = openProductId === null ? undefined : ranked.find(({ product }) => product.id === openProductId)?.product;
    if (open) {
      pickKind(kindOf(open));
      return;
    }
    const hasFinished = ranked.some(({ product }) => kindOf(product) === 'finished');
    if (!hasFinished && ranked.length > 0) pickKind('semi');
    else if (hasFinished) pickKind('finished');
  }, [using, ready, ranked, openProductId]);

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
  const tabsShown = ready && ranked.length > 0;

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
        <Button ref={newRef} variant="primary" className={styles.add} onPress={() => { onOpenNew(kindTab); }}>
          <Plus aria-hidden="true" />
          {t('fc.newProduct')}
        </Button>
      </div>

      {/* The two lists: finished products and semi-finished cards. Not drawn while there is nothing at all to split. */}
      {tabsShown ? (
        <div role="tablist" aria-label={t('fc.kindTabs')} className={styles.tabs}>
          {KIND_TABS.map((kind, index) => {
            const selected = kind === kindTab;
            return (
              <button
                key={kind}
                ref={node => {
                  if (node) kindTabs.current.set(kind, node);
                  else kindTabs.current.delete(kind);
                }}
                type="button"
                role="tab"
                id={tabId(kind)}
                aria-selected={selected}
                aria-controls={selected ? PANEL_ID : undefined}
                tabIndex={selected ? 0 : -1}
                className={styles.tab}
                onClick={() => { pickKind(kind); }}
                onKeyDown={event => { onKindKey(event, index); }}
              >
                {t(KIND_TAB_KEY[kind])}
              </button>
            );
          })}
        </div>
      ) : null}

      {missing > 0 ? <FromBookBox count={missing} onOpen={openFromBook} buttonRef={fromBookRef} /> : null}
      {choosing ? <FromBookDialog onClose={closeFromBook} /> : null}

      <div
        {...(tabsShown ? { role: 'tabpanel', id: PANEL_ID, 'aria-labelledby': tabId(kindTab) } : {})}
        className={styles.panel}
      >
        {/* ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT: it is a controlled input in a part that stays mounted,
            and only the rows below it are redrawn, so a snapshot landing mid-keystroke finds the text and the keyboard
            where the person left them. Not drawn while there is nothing to search. */}
        {ready && ofKind.length > 0 ? (
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
            <Button onPress={() => { onOpenNew(kindTab); }}>{t('fc.empty.action')}</Button>
          </div>
        )) : ofKind.length === 0 ? (
          <p className={styles.nothing}>{t(kindTab === 'semi' ? 'fc.empty.semi' : 'fc.empty.finished')}</p>
        ) : found.length === 0 ? null : groups === null ? (
          <ul className={styles.rows}>{found.map(rowOf)}</ul>
        ) : (
          <div className={styles.groups}>
            {groups.map((group: Group<(typeof found)[number]>) => (
              <CollapsibleGroup
                key={group.id ?? NO_CATEGORY_KEY}
                name={group.id === CAKES_GROUP_ID ? t('fc.cat.cakes') : group.name ?? t('fc.cat.none')}
                count={t('fc.cat.cards', { n: group.items.length })}
                open={isGroupOpen(group.id, group, { userOpen: openGroups, searching, openProductId })}
                onToggle={() => { toggleGroup(group.id); }}
              >
                <ul className={styles.rows}>{group.items.map(rowOf)}</ul>
              </CollapsibleGroup>
            ))}
          </div>
        )}

        {/* A search that matches nothing stays a small line under the box. The region is drawn before it speaks, so the line is
            announced when it arrives. */}
        <div role="status">
          {ready && ofKind.length > 0 && found.length === 0
            ? (
              <p className={styles.nothing}>
                {foundElsewhere > 0
                  ? t(kindTab === 'semi' ? 'fc.searchNoneOther.semi' : 'fc.searchNoneOther.finished', { q: query.trim(), n: foundElsewhere })
                  : t('fc.searchNone', { q: query.trim() })}
              </p>
            )
            : null}
        </div>
      </div>
    </div>
  );
}
