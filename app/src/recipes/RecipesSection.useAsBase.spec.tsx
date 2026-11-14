import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { normalizeCatalogueRecipe } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { DataProvider } from '../data/DataContext';
import type { DataServices } from '../data/DataContext';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { SessionProvider } from '../session/SessionContext';
import { fakeStore } from '../testing/fakeSession';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';
import { StatusMessageProvider } from '../ui/StatusMessage';
import { BatchCard } from './BatchCard';
import { RecipesProvider } from './RecipesContext';

// «Use as base recipe» (Mise 2 only, 14 Nov 2026): the batch on screen becomes the recipe as written.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// Every kind of row, each with a row id, a link where it has one, a divider and the fields the editor does not own around it.
const MIXED = recipe('m', {
  name: 'Mixed',
  ingredients: [
    { label: 'Flour', grams: 250, unit: 'g', kind: 'ingredient', refId: 'flour', rid: 'r1', dividerAfter: true },
    { label: 'Eggs', grams: 3, unit: 'pcs', rid: 'r2' },
    { label: 'Milk', grams: 0.5, unit: 'l', rid: 'r3' },
    { label: 'Cream', grams: 120, unit: 'ml', rid: 'r4' },
    { label: 'Butter', grams: 0.2, unit: 'kg', rid: 'r5' },
    { label: 'Sugar', grams: 2, unit: 'tbsp', rid: 'r6' },
    { label: 'Salt', grams: 0, unit: 'to taste', rid: 'r7' },
    { label: 'Base dough', grams: 330, unit: 'g', kind: 'recipe', refId: 'base', rid: 'r8' },
  ],
  lossPct: 12,
  rawGrams: 1000,
  cookedGrams: 880,
  netWeightG: 250,
  shelfLifeDays: 3,
  steps: [{ id: 's1', text: 'Mix', rows: ['r1', 'r2'] }],
  endNote: 'Done',
  category: 'Bread',
  labelName: 'Mixed bread',
  archived: true,
});
// 1,720 g of dough, all in grams.
const FOCACCIA = recipe('f', { name: 'Focaccia' });

const main = () => within(screen.getByRole('main'));
const table = () => main().getByRole('table', { name: /^(Ingredients|Ingredienti)$/ });
const rowsOf = () => within(table()).getAllByRole('row').map(row => Array.from(row.children).map(cell => cell.textContent));
const gramsBox = () => main().getByRole('spinbutton', { name: /^(Total dough weight in grams|Peso totale dell’impasto in grammi)$/ });
const useAsBase = () => main().queryByRole('button', { name: /^(Use as base recipe|Usa come ricetta base)$/ });
const question = () => within(screen.getByRole('alertdialog'));
const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};
const scaled = (id: string, target: number) => {
  window.localStorage.setItem('catalogue-scaled', JSON.stringify({ [id]: { target, ts: Date.now() - 60_000 } }));
};

async function open(recipes = [MIXED, FOCACCIA], id = 'm', options = {}) {
  const source = sourceWith(recipes);
  const view = renderRecipes(`/recipes/${id}`, { source, ...options });
  await screen.findByRole('table', undefined, LOAD);
  return view;
}

// What the mixed recipe reads at 2000 g: 250 g + 0.5 l + 120 ml + 0.2 kg + 330 g = 1400 g weighable, so ×(2000 / 1400).
const MIXED_AT_2000 = [
  ['Flour', '357', 'g'],
  ['Eggs', '4', 'pcs'],
  ['Milk', '0.714', 'l'],
  ['Cream', '171', 'ml'],
  ['Butter', '0.286', 'kg'],
  ['Sugar', '3', 'tbsp'],
  ['Salt', '', 'to taste'],
  ['Base dough', '471', 'g'],
];

describe('«Use as base recipe»', () => {
  it('is not there without a batch applied, and comes right under «Clear» once one is', async () => {
    const { user } = await open([FOCACCIA], 'f');
    expect(useAsBase()).not.toBeInTheDocument();
    await user.type(gramsBox(), '3440');
    await user.click(main().getByRole('button', { name: 'Calculate' }));
    await user.click(question().getByRole('button', { name: 'Calculate' }));
    const clear = main().getByRole('button', { name: 'Clear — back to base recipe' });
    const button = useAsBase()!;
    expect(button).toBeInTheDocument();
    // Right after Clear in the page's order, nothing between them.
    expect(clear.nextElementSibling).toBe(button.parentElement);
    await user.click(clear);
    expect(useAsBase()).not.toBeInTheDocument();
  });

  it('asks first, with both totals, and Cancel saves nothing and keeps the batch', async () => {
    scaled('f', 4500);
    const { user, source } = await open([FOCACCIA], 'f');
    await user.click(useAsBase()!);
    const dialog = question();
    expect(dialog.getByText('Use as base recipe?')).toBeInTheDocument();
    expect(dialog.getByText('The quantities of this recipe become the calculated ones: total 4500 g (was 1720 g). This cannot be undone. Continue?'))
      .toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Use as base' })).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
    expect(rowsOf().at(-1)).toEqual(['Total', '4500', 'g']);
    expect(useAsBase()).toBeInTheDocument();
  });

  it('⚠️ saves EXACTLY the amounts on screen — grams, pieces, litres, ml, kg, spoons and a sub-recipe row — and nothing else', async () => {
    scaled('m', 2000);
    const { user, source } = await open();
    expect(rowsOf().slice(0, -1)).toEqual(MIXED_AT_2000);
    expect(rowsOf().at(-1)).toEqual(['Total', '2000', 'g']);
    await user.click(useAsBase()!);
    // The total the recipe will have: the rows as shown added up (each rounded in its own unit), not the batch typed.
    expect(question().getByText('The quantities of this recipe become the calculated ones: total 1999 g (was 1400 g). This cannot be undone. Continue?'))
      .toBeInTheDocument();
    await user.click(question().getByRole('button', { name: 'Use as base' }));

    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    const write = source.recipeWrites[0]!;
    expect(write.id).toBe('m');
    // Only what the editor itself sends: the name, the rows, the label weight and shelf life as they were. The oven loss, its
    // weighings, the steps, the category, the label text and the archived flag are NOT sent, so they stay as stored.
    expect(Object.keys(write.data!).sort()).toEqual(['ingredients', 'name', 'netWeightG', 'shelfLifeDays']);
    expect(write.data!.name).toBe('Mixed');
    expect(write.data!.netWeightG).toBe(250);
    expect(write.data!.shelfLifeDays).toBe(3);
    // Every row exactly as it was but its amount, which is the number that was on screen.
    expect(write.data!.ingredients).toEqual([
      { label: 'Flour', grams: 357, unit: 'g', kind: 'ingredient', refId: 'flour', rid: 'r1', dividerAfter: true },
      { label: 'Eggs', grams: 4, unit: 'pcs', rid: 'r2' },
      { label: 'Milk', grams: 0.714, unit: 'l', rid: 'r3' },
      { label: 'Cream', grams: 171, unit: 'ml', rid: 'r4' },
      { label: 'Butter', grams: 0.286, unit: 'kg', rid: 'r5' },
      { label: 'Sugar', grams: 3, unit: 'tbsp', rid: 'r6' },
      { label: 'Salt', grams: 0, unit: 'to taste', rid: 'r7' },
      { label: 'Base dough', grams: 471, unit: 'g', kind: 'recipe', refId: 'base', rid: 'r8' },
    ]);
    const stored = source.recipes.get('m')!;
    for (const key of ['lossPct', 'rawGrams', 'cookedGrams', 'steps', 'endNote', 'category', 'labelName', 'archived'] as const) {
      expect(stored[key], key).toEqual(MIXED[key]);
    }

    // The batch is gone: the recipe as written now reads what was on screen.
    await says('Recipe saved.');
    expect(rowsOf().slice(0, -1)).toEqual(MIXED_AT_2000);
    expect(rowsOf().at(-1)).toEqual(['Total', '1999', 'g']);
    expect(JSON.parse(window.localStorage.getItem('catalogue-scaled') ?? '{}')).toEqual({});
    expect(gramsBox()).toHaveValue(null);
    expect(useAsBase()).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Clear — back to base recipe' })).not.toBeInTheDocument();
    await waitFor(() => { expect(gramsBox()).toHaveFocus(); });
  });

  it('all in grams: the rows saved add up to the batch to the gram', async () => {
    scaled('f', 4500);
    const { user, source } = await open([FOCACCIA], 'f');
    const shown = rowsOf();
    await user.click(useAsBase()!);
    await user.click(question().getByRole('button', { name: 'Use as base' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    const rows = source.recipeWrites[0]!.data!.ingredients as { grams: number }[];
    expect(rows.map(row => String(row.grams))).toEqual(shown.slice(0, -1).map(row => row[1]));
    expect(rows.reduce((sum, row) => sum + row.grams, 0)).toBe(4500);
    expect(rowsOf()).toEqual(shown);
  });

  it('⚠️ a refused save puts the recipe back as it was and says so', async () => {
    scaled('f', 4500);
    const { user, source } = await open([FOCACCIA], 'f');
    source.refuseRecipeWrites.save = true;
    await user.click(useAsBase()!);
    await user.click(question().getByRole('button', { name: 'Use as base' }));
    await says('Couldn’t save “Focaccia” — check your connection.');
    expect(source.recipeWrites).toEqual([]);
    expect(source.recipes.get('f')!.ingredients).toEqual(FOCACCIA.ingredients);
    await waitFor(() => { expect(rowsOf()).toEqual([['Flour', '1000', 'g'], ['Water', '700', 'g'], ['Salt', '20', 'g'], ['Total', '1720', 'g']]); });
  });

  it('⚠️ a change of the recipe while the question is open closes it, and nothing is saved', async () => {
    scaled('f', 4500);
    const { user, source } = await open([FOCACCIA], 'f');
    await user.click(useAsBase()!);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    act(() => {
      source.recipes.set('f', { ...FOCACCIA, ingredients: [{ label: 'Flour', grams: 1200, unit: 'g' }] });
      source.push();
    });
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.recipeWrites).toEqual([]);
  });

  it('⚠️ refuses a batch so small that a row with an amount would be saved as 0, and names it', async () => {
    // 2 g of yeast in a 400 g batch of a 1722 g recipe reads 0 g: saved, it would be gone from every later batch.
    const SMALL = recipe('y', { name: 'Test', ingredients: [
      { label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Water', grams: 700, unit: 'g' }, { label: 'Salt', grams: 20, unit: 'g' },
      { label: 'Yeast', grams: 2, unit: 'g' },
    ] });
    scaled('y', 400);
    const { user, source } = await open([SMALL], 'y');
    expect(rowsOf()[3]).toEqual(['Yeast', '0', 'g']);
    await user.click(useAsBase()!);
    const notice = within(screen.getByRole('alertdialog'));
    expect(notice.getByText('This batch can’t become the base recipe: the amount of Yeast would go down to 0. Calculate a bigger batch first.'))
      .toBeInTheDocument();
    await user.click(notice.getByRole('button', { name: 'OK' }));
    expect(source.recipeWrites).toEqual([]);
    // The batch is still there.
    expect(rowsOf().at(-1)).toEqual(['Total', '400', 'g']);
    expect(useAsBase()).toBeInTheDocument();
  });

  it('refuses a recipe with no name (the database would), and asks for one', async () => {
    const NAMELESS = recipe('n', { name: '' });
    scaled('n', 3440);
    const { user, source } = await open([NAMELESS], 'n');
    await user.click(useAsBase()!);
    expect(within(screen.getByRole('alertdialog')).getByText('This recipe has no name. Give it one with Edit first.')).toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
  });

  it('a save of ANOTHER recipe in the venue does not close the question', async () => {
    scaled('f', 4500);
    const { user, source } = await open([FOCACCIA, MIXED], 'f');
    await user.click(useAsBase()!);
    act(() => {
      source.recipes.set('m', { ...MIXED, name: 'Mixed 2' });
      source.push();
    });
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(question().getByRole('button', { name: 'Use as base' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
  });

  it('says it all in Italian', async () => {
    scaled('f', 4500);
    const { user } = await open([FOCACCIA], 'f', { lang: 'it', session: { language: 'it' } });
    await user.click(useAsBase()!);
    const dialog = question();
    expect(dialog.getByText('Usare come ricetta base?')).toBeInTheDocument();
    expect(dialog.getByText('Le quantità di questa ricetta diventano quelle calcolate: totale 4500 g (prima 1720 g). Non si può annullare. Continuare?'))
      .toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Usa come base' }));
    await says('Ricetta salvata.');
  });

  it('is offered to an employee, who sees the recipe’s «Edit» too: the one flag draws both', async () => {
    scaled('f', 4500);
    await open([FOCACCIA], 'f', { session: { role: 'employee', canManage: false } });
    expect(main().getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(useAsBase()).toBeInTheDocument();
  });
});

// The card on its own, for the one case the whole app cannot reach today: somebody who sees a recipe but may not edit it.
describe('the batch card for somebody who may not edit the recipe', () => {
  it('draws no «Use as base recipe», even with a batch applied', async () => {
    scaled('f', 4500);
    const source = fakeRecipesSource({ recipes: [FOCACCIA] });
    const held = normalizeCatalogueRecipe(FOCACCIA) as CatalogueRecipe;
    const services = { recipes: () => source } as unknown as DataServices;
    const draw = (canEdit: boolean) => (
      <I18nProvider initialLanguage="en" initialMessages={en}>
        <SessionProvider store={fakeStore()}>
          <DataProvider services={services}>
            <StatusMessageProvider>
              <RecipesProvider>
                <BatchCard recipe={held} target={4500} canEdit={canEdit} />
              </RecipesProvider>
            </StatusMessageProvider>
          </DataProvider>
        </SessionProvider>
      </I18nProvider>
    );
    const view = render(draw(false));
    expect(screen.getByRole('button', { name: 'Clear — back to base recipe' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use as base recipe' })).not.toBeInTheDocument();
    view.rerender(draw(true));
    expect(screen.getByRole('button', { name: 'Use as base recipe' })).toBeInTheDocument();
  });
});
