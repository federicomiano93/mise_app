import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// «Calculate from this ingredient» (Mise 2 only, 14 Nov 2026): the whole recipe scaled from one row's amount, that row exact.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// The owner's example: sugar 800 g → 1000 g gives butter 1000 g, flour 2500 g, a total of about 5469 g.
const BRIOCHE = recipe('b', {
  name: 'Brioche',
  ingredients: [
    { label: 'Flour', grams: 2000, unit: 'g', rid: 'r1' },
    { label: 'Butter', grams: 800, unit: 'g', rid: 'r2' },
    { label: 'Sugar', grams: 800, unit: 'g', rid: 'r3' },
    { label: 'Eggs', grams: 775, unit: 'g', rid: 'r4' },
  ],
});
// Pieces, a volume, «to taste», a row with no amount and a sub-recipe row.
const MIXED = recipe('m', {
  name: 'Mixed',
  ingredients: [
    { label: 'Flour', grams: 250, unit: 'g' },
    { label: 'Eggs', grams: 3, unit: 'pcs' },
    { label: 'Milk', grams: 0.5, unit: 'l' },
    { label: 'Cream', grams: 120, unit: 'ml' },
    { label: 'Salt', grams: 0, unit: 'to taste' },
    { label: 'Water', grams: 0, unit: 'g' },
    { label: 'Base dough', grams: 330, unit: 'g', kind: 'recipe', refId: 'base' },
  ],
});

const main = () => within(screen.getByRole('main'));
const table = () => main().getByRole('table', { name: /^(Ingredients|Ingredienti)$/ });
const rowsOf = () => within(table()).getAllByRole('row').map(row => Array.from(row.children).map(cell => cell.textContent));
const rowButton = (name: string) => within(table()).getByRole('button', { name });
const menu = () => screen.getByRole('menu');
const gramsBox = () => main().getByRole('spinbutton', { name: /^(Total dough weight in grams|Peso totale dell’impasto in grammi)$/ });
const fromRowItem = () => within(menu()).queryByRole('menuitem', { name: /^(Calculate from this ingredient|Calcola da questo ingrediente)$/ });
const dialog = () => within(screen.getByRole('dialog'));
const stored = () => JSON.parse(window.localStorage.getItem('catalogue-scaled') ?? '{}') as Record<string, Record<string, unknown>>;

async function open(recipes = [BRIOCHE, MIXED], id = 'b', options = {}) {
  const source = sourceWith(recipes);
  const view = renderRecipes(`/recipes/${id}`, { source, ...options });
  await screen.findByRole('table', undefined, LOAD);
  return view;
}

type User = Awaited<ReturnType<typeof open>>['user'];

async function calculateFrom(user: User, row: string, amount: string, button = 'Calculate') {
  await user.click(rowButton(row));
  await user.click(fromRowItem()!);
  const box = dialog().getByRole('spinbutton');
  await user.type(box, amount);
  await user.click(dialog().getByRole('button', { name: button }));
}

describe('«Calculate from this ingredient»', () => {
  it('the owner’s example: sugar 800 g → 1000 g, the row exact, the others in proportion, the box showing the new total', async () => {
    const { user } = await open();
    await calculateFrom(user, 'Sugar', '1000');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowsOf()).toEqual([
      ['Flour', '2500', 'g'],
      ['Butter', '1000', 'g'],
      ['Sugar', '1000', 'g'],
      ['Eggs', '969', 'g'],
      ['Total', '5469', 'g'],
    ]);
    expect(gramsBox()).toHaveValue(5469);
    expect(main().getByText('Calculated from Sugar: 1000 g')).toBeInTheDocument();
    // Remembered on this device like the box's batch, with the row it came from.
    expect(stored().b).toMatchObject({ target: 5468.75, by: { key: 'name:Sugar#1', amount: 1000 } });
    // The focus goes back to the ingredient that was chosen.
    await waitFor(() => { expect(rowButton('Sugar')).toHaveFocus(); });
  });

  it('asks «How much … do you want?» with one labelled box in the row’s own unit, focused', async () => {
    const { user } = await open([MIXED], 'm');
    await user.click(rowButton('Eggs'));
    await user.click(fromRowItem()!);
    expect(screen.getByRole('dialog', { name: 'How much Eggs do you want?' })).toBeInTheDocument();
    const box = dialog().getByRole('spinbutton', { name: 'Amount (pcs)' });
    expect(box).toHaveFocus();
    expect(dialog().getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('refuses an empty box or 0, says why under the box, and calculates nothing', async () => {
    const { user } = await open();
    await user.click(rowButton('Sugar'));
    await user.click(fromRowItem()!);
    const box = dialog().getByRole('spinbutton', { name: 'Amount (g)' });
    const problem = dialog().getByRole('status');
    expect(problem).toBeEmptyDOMElement();
    expect(box).toHaveAttribute('aria-describedby', problem.id);
    await user.click(dialog().getByRole('button', { name: 'Calculate' }));
    expect(problem).toHaveTextContent('Enter an amount greater than 0.');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await user.type(box, '0');
    await user.click(dialog().getByRole('button', { name: 'Calculate' }));
    expect(problem).toHaveTextContent('Enter an amount greater than 0.');
    expect(stored()).toEqual({});
    // Typing again takes the sentence away.
    await user.type(box, '5');
    expect(problem).toBeEmptyDOMElement();
    expect(box).not.toHaveAttribute('aria-invalid');
    await user.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(rowsOf()[2]).toEqual(['Sugar', '800', 'g']);
  });

  it('refuses a batch of more than 10 tonnes, and asks louder past 100 kg as the batch box does', async () => {
    const { user } = await open();
    await calculateFrom(user, 'Sugar', '2000000');
    expect(dialog().getByRole('status')).toHaveTextContent('That would be more than 10 tonnes of dough. Check the amount.');
    await user.click(dialog().getByRole('button', { name: 'Cancel' }));
    await calculateFrom(user, 'Sugar', '20000');
    const question = within(screen.getByRole('alertdialog'));
    expect(question.getByText('That is a very large batch')).toBeInTheDocument();
    expect(question.getByText('Calculate Brioche for 109375 g (109.38 kg)?')).toBeInTheDocument();
    await user.click(question.getByRole('button', { name: 'Calculate' }));
    expect(rowsOf()[2]).toEqual(['Sugar', '20000', 'g']);
  });

  it('Cancel changes nothing and gives the focus back to the row', async () => {
    const { user } = await open();
    await user.click(rowButton('Butter'));
    await user.click(fromRowItem()!);
    await user.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(stored()).toEqual({});
    await waitFor(() => { expect(rowButton('Butter')).toHaveFocus(); });
  });

  it('is not offered on a row with no amount, nor on «to taste»; it is on pieces, a volume and a sub-recipe row', async () => {
    const { user } = await open([MIXED], 'm');
    for (const name of ['Water', 'Salt']) {
      await user.click(rowButton(name));
      expect(fromRowItem(), name).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
    }
    for (const name of ['Flour', 'Eggs', 'Milk', 'Cream', 'Base dough']) {
      await user.click(rowButton(name));
      expect(fromRowItem(), name).toBeInTheDocument();
      await user.keyboard('{Escape}');
    }
  });

  it('from a pieces row: 3 eggs → 6 doubles everything, in each row’s own unit', async () => {
    const { user } = await open([MIXED], 'm');
    await calculateFrom(user, 'Eggs', '6');
    expect(rowsOf()).toEqual([
      ['Flour', '500', 'g'],
      ['Eggs', '6', 'pcs'],
      ['Milk', '1', 'l'],
      ['Cream', '240', 'ml'],
      ['Salt', '', 'to taste'],
      ['Water', '0', 'g'],
      ['Base dough', '660', 'g'],
      ['Total', '2400', 'g'],
    ]);
    expect(main().getByText('Calculated from Eggs: 6 pcs')).toBeInTheDocument();
  });

  it('from a millilitre row and from a sub-recipe row', async () => {
    const { user } = await open([MIXED], 'm');
    await calculateFrom(user, 'Cream', '180');
    expect(rowsOf()[3]).toEqual(['Cream', '180', 'ml']);
    expect(rowsOf()[6]).toEqual(['Base dough', '495', 'g']);
    await calculateFrom(user, 'Base dough', '1000');
    expect(rowsOf()[6]).toEqual(['Base dough', '1000', 'g']);
    expect(main().getByText('Calculated from Base dough: 1000 g')).toBeInTheDocument();
  });

  it('Undo takes the recipe back to its base, forgets the batch and gives the focus to the row', async () => {
    const { user } = await open();
    await calculateFrom(user, 'Sugar', '1000');
    await user.click(main().getByRole('button', { name: 'Undo' }));
    expect(rowsOf()[2]).toEqual(['Sugar', '800', 'g']);
    expect(rowsOf().at(-1)).toEqual(['Total', '4375', 'g']);
    expect(main().queryByText(/Calculated from/)).not.toBeInTheDocument();
    expect(gramsBox()).toHaveValue(null);
    expect(stored()).toEqual({});
    await waitFor(() => { expect(rowButton('Sugar')).toHaveFocus(); });
  });

  it('is remembered on this device: the recipe opened again shows the row exact and the line', async () => {
    window.localStorage.setItem('catalogue-scaled', JSON.stringify({ b: { target: 5468.75, ts: Date.now() - 60_000, by: { key: 'name:Sugar#1', amount: 1000 } } }));
    await open();
    expect(rowsOf()[2]).toEqual(['Sugar', '1000', 'g']);
    expect(gramsBox()).toHaveValue(5469);
    expect(main().getByText('Calculated from Sugar: 1000 g')).toBeInTheDocument();
  });

  it('a total typed in the batch box afterwards replaces it: the line goes', async () => {
    const { user } = await open();
    await calculateFrom(user, 'Sugar', '1000');
    await user.clear(gramsBox());
    await user.type(gramsBox(), '4375');
    await user.click(main().getByRole('button', { name: 'Calculate' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Calculate' }));
    expect(main().queryByText(/Calculated from/)).not.toBeInTheDocument();
    expect(rowsOf()[2]).toEqual(['Sugar', '800', 'g']);
    expect(stored().b).not.toHaveProperty('by');
  });

  it('the full screen shows the same amounts, the chosen row exact', async () => {
    const { user } = await open();
    await calculateFrom(user, 'Sugar', '1000');
    await user.click(main().getByRole('button', { name: 'Full screen' }));
    const full = within(screen.getByRole('dialog', { name: 'Brioche' }));
    expect(full.getByText('2500 g')).toBeInTheDocument();
    expect(full.getAllByText('1000 g')).toHaveLength(2);
    expect(full.getByText('969 g')).toBeInTheDocument();
    expect(full.getByText('5469 g')).toBeInTheDocument();
  });

  it('⚠️ «Use as base recipe» on top of it saves the typed row exactly, and the others as shown', async () => {
    const { user, source } = await open();
    await calculateFrom(user, 'Sugar', '1000');
    await user.click(main().getByRole('button', { name: 'Use as base recipe' }));
    const question = within(screen.getByRole('alertdialog'));
    expect(question.getByText('The quantities of this recipe become the calculated ones: total 5469 g (was 4375 g). This cannot be undone. Continue?'))
      .toBeInTheDocument();
    await user.click(question.getByRole('button', { name: 'Use as base' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect((source.recipeWrites[0]!.data!.ingredients as { grams: number }[]).map(row => row.grams)).toEqual([2500, 1000, 1000, 969]);
    expect(main().queryByText(/Calculated from/)).not.toBeInTheDocument();
    expect(stored()).toEqual({});
    expect(rowsOf()).toEqual([
      ['Flour', '2500', 'g'],
      ['Butter', '1000', 'g'],
      ['Sugar', '1000', 'g'],
      ['Eggs', '969', 'g'],
      ['Total', '5469', 'g'],
    ]);
  });

  it('says it all in Italian', async () => {
    const { user } = await open([BRIOCHE], 'b', { lang: 'it', session: { language: 'it' } });
    await user.click(rowButton('Sugar'));
    await user.click(fromRowItem()!);
    expect(screen.getByRole('dialog', { name: 'Quanto Sugar vuoi?' })).toBeInTheDocument();
    await user.click(dialog().getByRole('button', { name: 'Calcola' }));
    expect(dialog().getByRole('status')).toHaveTextContent('Scrivi una quantità maggiore di 0.');
    await user.type(dialog().getByRole('spinbutton', { name: 'Quantità (g)' }), '1000');
    await user.click(dialog().getByRole('button', { name: 'Calcola' }));
    expect(main().getByText('Calcolata su Sugar: 1000 g')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });
});
