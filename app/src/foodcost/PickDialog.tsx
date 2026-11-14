import { useMemo, useState } from 'react';
import { normalizeSearchText } from '@mise/shared/catalogue-model';
import { isFood, isPackaging } from '@mise/shared/ingredient-kind';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { fcMoney } from '@mise/shared/fc-number';
import { pricePerKg } from '@mise/shared/price-model';
import { withoutArchived } from '@mise/shared/recipe-shelf';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useFoodcost } from './FoodcostContext';
import { supplierOf } from './supplierOf';
import styles from './PickDialog.module.css';

// What the chooser offers: recipes, ingredients, both (a line of «Made of»), or packaging.
export type PickMode = 'recipe' | 'ingredient' | 'line' | 'packaging';

export type Choice = { kind: 'recipe' | 'ingredient' | 'packaging'; id: string };

type Props = {
  mode: PickMode;
  // Opened already searching (the name's «See all»).
  initialQuery?: string;
  onChoose: (choice: Choice) => void;
  // Escape, Back: nothing was chosen.
  onClose: () => void;
};

const TITLE = {
  recipe: 'fc.pickRecipe',
  ingredient: 'fc.pickIngredient',
  line: 'fc.pickRecipeOrIngredient',
  packaging: 'fc.pickPackaging',
} as const satisfies Record<PickMode, MessageKey>;

// `supplier`: whom an ingredient is bought from (supplierOf), '' for a recipe, for packaging and for an ingredient with none.
type Option = { id: string; name: string; invoiceName: string; meta: string; supplier: string };

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

// The chooser: a search screen, not a menu — there are too many ingredients for a <select> on a
// phone. A dialog (focus kept inside, Escape closes, the focus goes back to the button that opened
// it), mounted only while it is open.
//
// ⚠️ NO PRICE IN «MADE OF»'S LISTS (his decision, 13 Sep 2026: the price is not shown in the
// «made of» section); what a product costs is read once, in «Production cost». The packaging list is
// the one place a price shows, because packaging is counted in pieces and anything priced another
// way must be flagged rather than look like it vanished.
//
// POST-SWITCH (step 4 of the Food cost plan, 11 Nov 2026; his words: «quando scegli un ingrediente deve dirti il fornitore»): an
// ingredient says its supplier on a second, smaller line under its name, so two packs of the same flour from two suppliers can be
// told apart. Not a recipe (bought from nobody) and not packaging (its line already says its price). An ingredient with no
// supplier, or whose supplier has not arrived yet, has no second line at all: the chooser never waits for the suppliers.
export function PickDialog({ mode, initialQuery = '', onChoose, onClose }: Props) {
  const { t } = useT();
  const money = useMoney();
  const { recipes, ingredients, suppliers } = useFoodcost();
  const [query, setQuery] = useState(initialQuery);

  const options = useMemo(() => {
    const named = (item: (typeof ingredients)[string]): boolean => String(item.name ?? '').trim() !== '';
    const ingredientOption = (item: (typeof ingredients)[string]): Option => ({
      id: item.id,
      name: ingredientDisplayName(item).trim(),
      invoiceName: String(item.name).trim(),
      meta: String(item.weight ?? '').trim(),
      supplier: supplierOf(item, suppliers),
    });
    const packagingOption = (item: (typeof ingredients)[string]): Option => {
      const each = item.priceUnit === 'pcs' ? Number(item.pricePerUnit) : null;
      const meta = each ? t('fc.priceEach', { price: fcMoney(each, money) })
        : pricePerKg(item) !== null ? t('fc.pricedByWeight')
          : t('fc.notPriced');
      return { id: item.id, name: ingredientDisplayName(item).trim(), invoiceName: String(item.name).trim(), meta, supplier: '' };
    };
    // ⚠️ AN ARCHIVED RECIPE IS NOT OFFERED (a NEW line); a line already made of one keeps costing and naming it elsewhere.
    const recipeOptions: Option[] = withoutArchived(Object.values(recipes))
      .filter(recipe => String(recipe.name ?? '').trim() !== '')
      .map(recipe => ({ id: recipe.id, name: String(recipe.name).trim(), invoiceName: '', meta: '', supplier: '' }))
      .sort(byName);

    // Active, named, and FOOD only: packaging has its own section; resale and other (drinks, detergents) are never
    // offered here (14 Nov 2026) — isFood, never «not packaging», or they would leak in.
    const ingredientOptions: Option[] = Object.values(ingredients)
      .filter(item => item.active !== false && isFood(item) && named(item))
      .map(ingredientOption)
      .sort(byName);

    // Counted in pieces, so anything priced another way is shown but flagged.
    const packagingOptions: Option[] = Object.values(ingredients)
      .filter(item => item.active !== false && isPackaging(item) && named(item))
      .map(packagingOption)
      .sort(byName);

    // 3e-5b: the ones switched off with «Not in use at the moment» are offered LAST, never hidden.
    const inactiveIngredientOptions: Option[] = Object.values(ingredients)
      .filter(item => item.active === false && isFood(item) && named(item))
      .map(ingredientOption)
      .sort(byName);
    const inactivePackagingOptions: Option[] = Object.values(ingredients)
      .filter(item => item.active === false && isPackaging(item) && named(item))
      .map(packagingOption)
      .sort(byName);

    const everyRecipeArchived = Object.keys(recipes).length > 0 && withoutArchived(Object.values(recipes)).length === 0;
    return { everyRecipeArchived, recipeOptions, ingredientOptions, packagingOptions, inactiveIngredientOptions, inactivePackagingOptions };
  }, [recipes, ingredients, suppliers, t, money]);

  const wanted = normalizeSearchText(query);
  const matches = (option: Option): boolean => wanted === ''
    || normalizeSearchText(option.name).includes(wanted)
    || normalizeSearchText(option.invoiceName).includes(wanted);

  const both = mode === 'line';
  const sections: { key: string; heading: string; kind: Choice['kind']; items: Option[] }[] = [];
  if (mode === 'recipe' || both) {
    sections.push({
      key: 'recipe',
      heading: both ? t('ui.recipes') : '',
      kind: 'recipe',
      items: options.recipeOptions.filter(matches).map(option => ({ ...option, meta: both ? t('fc.recipeWord') : '' })),
    });
  }
  if (mode === 'ingredient' || both) {
    sections.push({ key: 'ingredient', heading: both ? t('fc.ingredients') : '', kind: 'ingredient', items: options.ingredientOptions.filter(matches) });
  }
  if (mode === 'packaging') {
    sections.push({ key: 'packaging', heading: '', kind: 'packaging', items: options.packagingOptions.filter(matches) });
  }
  // The switched-off ones come after everything else, under their own heading, and are chosen like any other. Each row says it
  // too: a keyboard or screen-reader user tabs past the heading.
  const markedOff = (option: Option): Option => ({ ...option, meta: [option.meta, t('ui.notInUse')].filter(Boolean).join(' · ') });
  if (mode === 'ingredient' || both) {
    sections.push({ key: 'ingredient-off', heading: t('ui.notInUse'), kind: 'ingredient', items: options.inactiveIngredientOptions.filter(matches).map(markedOff) });
  }
  if (mode === 'packaging') {
    sections.push({ key: 'packaging-off', heading: t('ui.notInUse'), kind: 'packaging', items: options.inactivePackagingOptions.filter(matches).map(markedOff) });
  }
  const shown = sections.reduce((count, section) => count + section.items.length, 0);
  const emptyText = query.trim() !== '' ? t('fc.nothingMatches')
    : mode === 'packaging' ? t('fc.noPackagingYet')
      // Recipes exist but all are archived: say that, rather than «no recipes yet».
      : (mode === 'recipe' || both) && options.everyRecipeArchived ? t('cat.shelf.allArchived')
        : t('fc.noRecipesYet');

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t(TITLE[mode])}
      actions={<Button onPress={onClose}>{t('ui.back')}</Button>}
    >
      <input
        type="search"
        autoFocus
        autoComplete="off"
        className={styles.search}
        placeholder={t('fc.searchPick')}
        aria-label={t('fc.searchPick')}
        value={query}
        onChange={event => { setQuery(event.target.value); }}
      />
      <div className={styles.list}>
        {sections.map(section => (section.items.length === 0 ? null : (
          <section key={section.key} className={styles.section}>
            {section.heading === '' ? null : <h3 className={styles.heading}>{section.heading}</h3>}
            <ul className={styles.rows}>
              {section.items.map(option => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => { onChoose({ kind: section.kind, id: option.id }); }}
                  >
                    {/* The supplier is IN the button, so it is part of the option's accessible name: «Flour 00, Molino Rossi»
                        (the comma is for the ear only, so the two names are not read as one). It is cut short with «…» rather
                        than wrapped or pushed sideways at 296px; the whole name is still what is spoken. */}
                    <span className={styles.label}>
                      <span className={styles.name}>{option.name}</span>
                      {option.supplier === '' ? null : (
                        <span className={styles.supplier}>
                          {/* The space stays OUTSIDE the hidden comma: inside it, it is dropped from the spoken name. At the start of
                              its own line it is never drawn. */}
                          <span className="visually-hidden">,</span>
                          {` ${option.supplier}`}
                        </span>
                      )}
                    </span>
                    {/* With a supplier before it, the weight gets a comma for the ear too: «Flour, Molino Rossi, 25 kg», never a supplier
                        heard as «Molino Rossi 25 kg». Without one the option is spoken as before. */}
                    {option.meta === '' ? null : (
                      <span className={styles.meta}>
                        {option.supplier === '' ? null : <span className="visually-hidden">,</span>}
                        {option.supplier === '' ? option.meta : ` ${option.meta}`}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )))}
        {shown === 0 ? <p className={styles.empty}>{emptyText}</p> : null}
      </div>
    </Dialog>
  );
}
