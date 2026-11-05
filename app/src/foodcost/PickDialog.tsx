import { useMemo, useState } from 'react';
import { normalizeSearchText } from '@mise/shared/catalogue-model';
import { isPackaging } from '@mise/shared/ingredient-kind';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { formatRate, pricePerKg } from '@mise/shared/price-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useFoodcost } from './FoodcostContext';
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

type Option = { id: string; name: string; invoiceName: string; meta: string };

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

// The chooser: a search screen, not a menu — there are too many ingredients for a <select> on a
// phone. A dialog (focus kept inside, Escape closes, the focus goes back to the button that opened
// it), mounted only while it is open.
//
// ⚠️ NO PRICE IN «MADE OF»'S LISTS (his decision, 13 Sep 2026: the price is not shown in the
// «made of» section); what a product costs is read once, in «Production cost». The packaging list is
// the one place a price shows, because packaging is counted in pieces and anything priced another
// way must be flagged rather than look like it vanished.
export function PickDialog({ mode, initialQuery = '', onChoose, onClose }: Props) {
  const { t } = useT();
  const money = useMoney();
  const { recipes, ingredients } = useFoodcost();
  const [query, setQuery] = useState(initialQuery);

  const options = useMemo(() => {
    const recipeOptions: Option[] = Object.values(recipes)
      .filter(recipe => String(recipe.name ?? '').trim() !== '')
      .map(recipe => ({ id: recipe.id, name: String(recipe.name).trim(), invoiceName: '', meta: '' }))
      .sort(byName);

    // Active, named, and never packaging: that has its own section.
    const ingredientOptions: Option[] = Object.values(ingredients)
      .filter(item => item.active !== false && !isPackaging(item) && String(item.name ?? '').trim() !== '')
      .map(item => ({
        id: item.id,
        name: ingredientDisplayName(item).trim(),
        invoiceName: String(item.name).trim(),
        meta: String(item.weight ?? '').trim(),
      }))
      .sort(byName);

    // Counted in pieces, so anything priced another way is shown but flagged.
    const packagingOptions: Option[] = Object.values(ingredients)
      .filter(item => item.active !== false && isPackaging(item) && String(item.name ?? '').trim() !== '')
      .map(item => {
        const each = item.priceUnit === 'pcs' ? Number(item.pricePerUnit) : null;
        const meta = each ? t('fc.priceEach', { price: formatRate(each, money) })
          : pricePerKg(item) !== null ? t('fc.pricedByWeight')
            : t('fc.notPriced');
        return { id: item.id, name: ingredientDisplayName(item).trim(), invoiceName: String(item.name).trim(), meta };
      })
      .sort(byName);

    return { recipeOptions, ingredientOptions, packagingOptions };
  }, [recipes, ingredients, t, money]);

  const wanted = normalizeSearchText(query);
  const matches = (option: Option): boolean => wanted === ''
    || normalizeSearchText(option.name).includes(wanted)
    || normalizeSearchText(option.invoiceName).includes(wanted);

  const both = mode === 'line';
  const sections: { heading: string; kind: Choice['kind']; items: Option[] }[] = [];
  if (mode === 'recipe' || both) {
    sections.push({
      heading: both ? t('ui.recipes') : '',
      kind: 'recipe',
      items: options.recipeOptions.filter(matches).map(option => ({ ...option, meta: both ? t('fc.recipeWord') : '' })),
    });
  }
  if (mode === 'ingredient' || both) {
    sections.push({ heading: both ? t('fc.ingredients') : '', kind: 'ingredient', items: options.ingredientOptions.filter(matches) });
  }
  if (mode === 'packaging') {
    sections.push({ heading: '', kind: 'packaging', items: options.packagingOptions.filter(matches) });
  }
  const shown = sections.reduce((count, section) => count + section.items.length, 0);
  const emptyText = query.trim() !== '' ? t('fc.nothingMatches')
    : mode === 'packaging' ? t('fc.noPackagingYet') : t('fc.noRecipesYet');

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
          <section key={section.kind} className={styles.section}>
            {section.heading === '' ? null : <h3 className={styles.heading}>{section.heading}</h3>}
            <ul className={styles.rows}>
              {section.items.map(option => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => { onChoose({ kind: section.kind, id: option.id }); }}
                  >
                    <span className={styles.name}>{option.name}</span>
                    {option.meta === '' ? null : <span className={styles.meta}>{option.meta}</span>}
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
