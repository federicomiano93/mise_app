import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';
import rowMenuCss from './RowMenu.module.css?raw';
import viewCss from './RecipeView.module.css?raw';

// Item 32 (the current app's 70325def, 7 Nov 2026): a tap on an ingredient row opens the row's menu — «Split into 2 parts» and «Order» —
// and the full screen opens from its button only. The trip to Orders and back is in orders/OrdersSection.fromRecipe.spec.tsx.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const FOCACCIA = recipe('r1', {
  name: 'Focaccia',
  ingredients: [
    { label: 'Flour', grams: 1250, unit: 'g', kind: 'ingredient', refId: 'i-flour' },
    { label: 'Salt', grams: 1, unit: 'g', kind: 'ingredient', refId: 'i-salt' },
    { label: 'Pepper', grams: 0, unit: 'to taste' },
    { label: 'Cream', grams: 200, unit: 'g', kind: 'recipe', refId: 'r2' },
    { label: 'Yeast', grams: 10, unit: 'g', kind: 'ingredient', refId: 'i-yeast' },
    { label: 'Eggs', grams: 3, unit: 'pcs' },
  ],
});
const INGREDIENTS = [
  { id: 'i-flour', name: 'Flour', supplierId: 's-alp' },
  { id: 'i-salt', name: 'Salt', supplierId: 's-alp', active: false },
  { id: 'i-yeast', name: 'Yeast' },
];
const SUPPLIERS = [{ id: 's-alp', name: 'Alpine Mills' }];

const main = () => within(screen.getByRole('main'));
const table = () => main().getByRole('table', { name: /^(Ingredients|Ingredienti)$/ });
const rowButton = (name: string) => within(table()).getByRole('button', { name });
const menu = () => screen.getByRole('menu');

async function open(options: Parameters<typeof renderRecipes>[1] = {}) {
  const source = fakeRecipesSource({ recipes: [FOCACCIA], ingredients: INGREDIENTS, suppliers: SUPPLIERS });
  const view = renderRecipes('/recipes/r1', { source, ...options });
  await screen.findByRole('table', undefined, LOAD);
  // The ingredients and suppliers arrive after the recipe: «Order» is judged on them.
  await waitFor(() => { expect(source.ingredients.size).toBeGreaterThan(0); });
  return { ...view, source };
}

describe('a tap on an ingredient row', () => {
  it('⚠️ opens the row’s menu — never the full screen', async () => {
    const { user } = await open();
    await user.click(rowButton('Flour'));
    expect(menu()).toHaveAccessibleName('Actions for Flour');
    expect(within(menu()).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Split into 2 parts', 'Order']);
    expect(screen.queryByRole('dialog', { name: 'Focaccia' })).not.toBeInTheDocument();
  });

  it('opens it from a tap on the amount too, the whole row being the target', async () => {
    const { user } = await open();
    await user.click(within(table()).getByText('1250'));
    expect(menu()).toHaveAccessibleName('Actions for Flour');
    expect(screen.queryByRole('dialog', { name: 'Focaccia' })).not.toBeInTheDocument();
  });

  it('opens it from the keyboard (Enter), moves with the arrows, and Escape closes it and gives the focus back to the row', async () => {
    const { user } = await open();
    rowButton('Flour').focus();
    await user.keyboard('{Enter}');
    const items = within(menu()).getAllByRole('menuitem');
    await waitFor(() => { expect(items[0]).toHaveFocus(); });
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('menu')).not.toBeInTheDocument(); });
    expect(rowButton('Flour')).toHaveFocus();
  });

  it('the row is a button that says it opens a menu, and the table stays a table', async () => {
    const { user } = await open();
    const rows = table();
    const button = rowButton('Flour');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(within(rows).getAllByRole('rowheader').map(cell => cell.textContent)).toContain('Flour');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('the Total row is a plain row, not a button', async () => {
    await open();
    expect(within(table()).queryByRole('button', { name: 'Total' })).not.toBeInTheDocument();
  });
});

describe('the full screen', () => {
  it('opens from its button only, and a tap on a row no longer opens it', async () => {
    const { user } = await open();
    await user.click(rowButton('Salt'));
    expect(screen.queryByRole('dialog', { name: 'Focaccia' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(main().getByRole('button', { name: 'Full screen' }));
    expect(await screen.findByRole('dialog', { name: 'Focaccia' })).toBeInTheDocument();
  });
});

describe('«Split into 2 parts»', () => {
  it('shows the two parts under the row, in its own unit, and puts the split back with the same item', async () => {
    const { user } = await open();
    await user.click(rowButton('Flour'));
    await user.click(within(menu()).getByRole('menuitem', { name: 'Split into 2 parts' }));
    await waitFor(() => { expect(screen.queryByRole('menu')).not.toBeInTheDocument(); });
    expect(within(table()).getByText('→ 625 g + 625')).toBeInTheDocument();
    // The focus is back on the row, the split is on screen only: the total is unchanged.
    expect(rowButton('Flour')).toHaveFocus();
    expect(within(table()).getByText('Total').closest('tr')).toHaveTextContent(/^Total1461g$/);

    await user.click(rowButton('Flour'));
    await user.click(within(menu()).getByRole('menuitem', { name: 'Remove the split' }));
    await waitFor(() => { expect(within(table()).queryByText(/→/)).not.toBeInTheDocument(); });
  });

  it('draws the split in the full screen too', async () => {
    const { user } = await open();
    await user.click(rowButton('Flour'));
    await user.click(within(menu()).getByRole('menuitem', { name: 'Split into 2 parts' }));
    await user.click(main().getByRole('button', { name: 'Full screen' }));
    const view = within(await screen.findByRole('dialog', { name: 'Focaccia' }));
    expect(view.getByText('→ 625 g + 625 g')).toBeInTheDocument();
  });

  it('saves nothing: the recipe document is untouched', async () => {
    const { user, source } = await open();
    await user.click(rowButton('Flour'));
    await user.click(within(menu()).getByRole('menuitem', { name: 'Split into 2 parts' }));
    expect(source.recipes.get('r1')).toEqual(FOCACCIA);
    expect(window.localStorage.getItem('catalogue-scaled')).toBeNull();
  });

  it('each reason it cannot, said on the item', async () => {
    const { user } = await open();
    await user.click(rowButton('Salt'));
    expect(within(menu()).getByRole('menuitem', { name: /Split into 2 parts/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu()).getByText('Too small to split')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(rowButton('Pepper'));
    expect(within(menu()).getByText('There is no amount to split')).toBeInTheDocument();
  });
});

describe('«Order»', () => {
  it('each reason it cannot, said on the item', async () => {
    const { user } = await open();
    const reason = async (row: string, text: string) => {
      await user.click(rowButton(row));
      const item = within(menu()).getByRole('menuitem', { name: new RegExp(`^Order`) });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(within(item).getByText(text)).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => { expect(screen.queryByRole('menu')).not.toBeInTheDocument(); });
    };
    await reason('Salt', 'Marked “not in use” in Suppliers');
    await reason('Cream', 'A recipe from the Recipe book: not ordered');
    await reason('Yeast', 'No supplier linked to this ingredient');
    await reason('Eggs', 'No supplier linked to this ingredient');
  });

  it('⚠️ is absent — not disabled — where the venue does not use Orders', async () => {
    const { user } = await open({ session: { location: { sections: { orders: false } } } });
    await user.click(rowButton('Flour'));
    expect(within(menu()).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Split into 2 parts']);
  });

  it('is there for the kitchen owner, who is let into Orders', async () => {
    const { user } = await open({ session: { role: 'owner-kitchen', canManage: true, canManageVenue: false, isOwner: true } });
    await user.click(rowButton('Flour'));
    expect(within(menu()).getAllByRole('menuitem')).toHaveLength(2);
  });

});

describe('the words and the look', () => {
  it('speaks Italian with the current app’s words', async () => {
    const source = fakeRecipesSource({ recipes: [FOCACCIA], ingredients: INGREDIENTS, suppliers: SUPPLIERS });
    const { user } = renderRecipes('/recipes/r1', { source, lang: 'it', session: { language: 'it' } });
    await screen.findByRole('table', undefined, LOAD);
    await waitFor(() => { expect(source.suppliers.size).toBeGreaterThan(0); });
    expect(screen.getByRole('button', { name: 'Schermo intero' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Salt' }));
    expect(screen.getByRole('menu')).toHaveAccessibleName('Azioni per Salt');
    expect(within(screen.getByRole('menu')).getByText('Troppo poco da dividere')).toBeInTheDocument();
    expect(within(screen.getByRole('menu')).getByText('Segnato “non in uso” in Fornitori')).toBeInTheDocument();
  });

  it('has every new word in both languages, worded as the current app', () => {
    const words: Record<string, [string, string]> = {
      'cat.fullScreen': ['Full screen', 'Schermo intero'],
      'cat.rowMenu.label': ['Actions for {name}', 'Azioni per {name}'],
      'cat.split.do': ['Split into 2 parts', 'Dividi in 2 parti'],
      'cat.split.undo': ['Remove the split', 'Togli la divisione'],
      'cat.split.toTaste': ['There is no amount to split', 'Non c’è una quantità da dividere'],
      'cat.split.tooSmall': ['Too small to split', 'Troppo poco da dividere'],
      'cat.split.line': ['→ {a} + {b}', '→ {a} + {b}'],
      'cat.order.do': ['Order', 'Ordina'],
      'cat.order.noSupplier': ['No supplier linked to this ingredient', 'Nessun fornitore collegato a questo ingrediente'],
      'cat.order.isRecipe': ['A recipe from the Recipe book: not ordered', 'È una ricetta del Ricettario: non si ordina'],
      'cat.order.notInUse': ['Marked “not in use” in Suppliers', 'Segnato “non in uso” in Fornitori'],
      'ord.fromRecipe.notFound': ['This ingredient is not in any order list', 'Questo ingrediente non è in nessun elenco d’ordine'],
    };
    for (const [key, [english, italianText]] of Object.entries(words)) {
      expect((en as Record<string, unknown>)[key], `en ${key}`).toBe(english);
      expect((italian as Record<string, unknown>)[key], `it ${key}`).toBe(italianText);
    }
  });

  const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('a row and a menu item are at least a thumb tall, hover only for a real mouse, and no Chrome-newer feature', () => {
    const css = withoutComments(rowMenuCss);
    expect(css).toMatch(/\.name \{[^}]*min-height: var\(--hit\)/);
    expect(css).toMatch(/\.item \{[^}]*min-height: var\(--hit\)/);
    expect(css.replace(/@media \(hover: hover\) \{[^@]*?\}\s*\}/g, '')).not.toContain(':hover');
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.name:hover/);
    expect(css).not.toMatch(/:has\(|color-mix|@container|showPopover|\[popover/);
  });

  it('the name wraps instead of pushing the amount off a 296px phone, and the table no longer promises a tap-to-zoom', () => {
    expect(withoutComments(rowMenuCss)).toMatch(/\.name \{[^}]*overflow-wrap: anywhere/);
    expect(withoutComments(viewCss)).not.toMatch(/cursor: zoom/);
    expect(withoutComments(viewCss)).toMatch(/\.table \{[^}]*width: 100%;/);
  });

  it('the menu box shows a ring when it takes the focus itself (every item disabled)', () => {
    expect(withoutComments(rowMenuCss)).toMatch(/\.menu:focus-visible \{[^}]*outline: 3px solid var\(--accent\)/);
  });

  it('the pointer is for the row, not for the second line of a split row', () => {
    expect(withoutComments(viewCss)).toMatch(/\.table tbody tr\.splitSecond \{[^}]*cursor: default/);
  });
});
