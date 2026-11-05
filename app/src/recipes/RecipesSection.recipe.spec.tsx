import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// One recipe's screen: the ingredient list, the batch, the full-screen view.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

// 1,720 g of dough, all in grams.
const FOCACCIA = recipe('f', { name: 'Focaccia' });
// Every kind of row: grams, pieces, a volume (0.5 l = 500 g), spoons, "to taste".
const MIXED = recipe('m', {
  name: 'Mixed',
  ingredients: [
    { label: 'Flour', grams: 250, unit: 'g' },
    { label: 'Eggs', grams: 3, unit: 'pcs' },
    { label: 'Milk', grams: 0.5, unit: 'l' },
    { label: 'Sugar', grams: 2, unit: 'tbsp' },
    { label: 'Pepper', grams: 1, unit: 'pinch' },
    { label: 'Salt', grams: 0, unit: 'to taste' },
  ],
});
// Nothing to weigh: pieces and to taste only.
const PIECES = recipe('p', {
  name: 'Pieces',
  ingredients: [{ label: 'Eggs', grams: 6, unit: 'pcs' }, { label: 'Salt', grams: 0, unit: 'to taste' }],
});

const main = () => within(screen.getByRole('main'));
const table = () => main().getByRole('table', { name: /^(Ingredients|Ingredienti)$/ });
// Each row as [label, number, unit], the total last.
const rowsOf = () => within(table()).getAllByRole('row').map(row => Array.from(row.children).map(cell => cell.textContent));
const gramsBox = () => main().getByRole('spinbutton', { name: 'Total dough weight in grams' });
const calculate = () => main().getByRole('button', { name: 'Calculate' });
const question = () => within(screen.getByRole('alertdialog'));

async function open(recipes = [FOCACCIA, MIXED, PIECES], id = 'f', options = {}) {
  const view = renderRecipes(`/recipes/${id}`, { source: sourceWith(recipes), ...options });
  await screen.findByRole('table', undefined, LOAD);
  return view;
}

async function applyBatch(user: Awaited<ReturnType<typeof open>>['user'], grams: string) {
  await user.clear(gramsBox());
  await user.type(gramsBox(), grams);
  await user.click(calculate());
  return question();
}

describe('the ingredient list', () => {
  it('shows each row with its amount and unit, and the total of what is weighable', async () => {
    await open();
    expect(rowsOf()).toEqual([
      ['Flour', '1000', 'g'],
      ['Water', '700', 'g'],
      ['Salt', '20', 'g'],
      ['Total', '1720', 'g'],
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Focaccia' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
  });

  it('says pieces, spoons and a pinch in words, leaves «to taste» with no number, and totals volumes as grams', async () => {
    await open([MIXED], 'm');
    expect(rowsOf()).toEqual([
      ['Flour', '250', 'g'],
      ['Eggs', '3', 'pcs'],
      // ⚠️ 0.5 l, not «1 l»: kg and litres keep their decimals (14 Oct 2026; it used to round to whole numbers).
      ['Milk', '0.5', 'l'],
      ['Sugar', '2', 'tbsp'],
      ['Pepper', '1', 'pinch'],
      ['Salt', '', 'to taste'],
      // 250 g of flour and 0.5 l (500 g) of milk.
      ['Total', '750', 'g'],
    ]);
  });

  it('says the unit words in Italian, and keeps the metric symbols', async () => {
    await open([MIXED], 'm', { lang: 'it', session: { language: 'it' } });
    const rows = rowsOf();
    expect(rows[1]).toEqual(['Eggs', '3', 'pz']);
    expect(rows[2], 'the Italian decimal mark').toEqual(['Milk', '0,5', 'l']);
    expect(rows[4]).toEqual(['Pepper', '1', 'pizz.']);
    expect(rows[5]).toEqual(['Salt', '', 'q.b.']);
    expect(rows[0]).toEqual(['Flour', '250', 'g']);
    expect(rows[6]).toEqual(['Totale', '750', 'g']);
  });

  it('writes a thousand with no separator, whatever the language', async () => {
    await open([FOCACCIA], 'f', { lang: 'it', session: { language: 'it' } });
    expect(rowsOf()[0]).toEqual(['Flour', '1000', 'g']);
  });

  it('has no Food cost, procedure, Import or label button yet (their steps are later); Edit and Delete came with step 3d-6', async () => {
    await open();
    for (const name of [/import/i, /food cost/i, /make a label/i]) {
      expect(main().queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(main().queryByRole('heading', { level: 3, name: /procedure|food cost/i })).not.toBeInTheDocument();
  });
});

describe('the batch', () => {
  it('has a box in grams and a Calculate button, and no batch applied at first', async () => {
    await open();
    expect(gramsBox()).toHaveValue(null);
    expect(main().getByRole('heading', { level: 3, name: 'Batch weight' })).toBeInTheDocument();
    expect(main().queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
  });

  it('is not drawn for a recipe with nothing to weigh', async () => {
    await open([PIECES], 'p');
    expect(main().queryByRole('heading', { name: 'Batch weight' })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument();
    expect(rowsOf()[0]).toEqual(['Eggs', '6', 'pcs']);
  });

  it('asks first, spelling the amount both ways, and scales every row once confirmed', async () => {
    const { user } = await open();
    const dialog = await applyBatch(user, '3440');
    expect(dialog.getByText('Calculate recipe?')).toBeInTheDocument();
    expect(dialog.getByText('Calculate Focaccia for 3440 g (3.44 kg)?')).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Calculate' }));
    expect(rowsOf()).toEqual([
      ['Flour', '2000', 'g'],
      ['Water', '1400', 'g'],
      ['Salt', '40', 'g'],
      ['Total', '3440', 'g'],
    ]);
    expect(main().getByRole('button', { name: 'Clear — back to base recipe' })).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem('catalogue-scaled') ?? '{}') as Record<string, { target: number }>;
    expect(stored.f?.target).toBe(3440);
  });

  it('leaves the recipe alone when the question is declined', async () => {
    const { user } = await open();
    const dialog = await applyBatch(user, '3440');
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(rowsOf()[0]).toEqual(['Flour', '1000', 'g']);
    expect(window.localStorage.getItem('catalogue-scaled')).toBeNull();
  });

  it('⚠️ asks in a louder voice for a batch over 100 kg, and still never blocks it', async () => {
    const { user } = await open();
    const dialog = await applyBatch(user, '150000');
    expect(dialog.getByText('That is a very large batch')).toBeInTheDocument();
    expect(dialog.getByText('That is 150 kg of dough — 87.21× the recipe as written (1.72 kg). Check the amount before calculating.')).toBeInTheDocument();
    expect(dialog.getByText('Calculate Focaccia for 150000 g (150 kg)?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Calculate' }));
    expect(rowsOf().at(-1)).toEqual(['Total', '150000', 'g']);
  });

  it('⚠️ asks in a louder voice for more than 50 times the recipe, even under 100 kg', async () => {
    const { user } = await open();
    const dialog = await applyBatch(user, '90000');
    expect(dialog.getByText('That is a very large batch')).toBeInTheDocument();
    expect(dialog.getByText(/× the recipe as written \(1\.72 kg\)/)).toBeInTheDocument();
  });

  it('does not raise its voice for an ordinary batch', async () => {
    const { user } = await open();
    const dialog = await applyBatch(user, '5000');
    expect(dialog.queryByText('That is a very large batch')).not.toBeInTheDocument();
    expect(dialog.queryByText(/Check the amount/)).not.toBeInTheDocument();
  });

  it('puts the tonne-scale slip in tonnes, so a wrong order of magnitude is seen', async () => {
    const { user } = await open();
    const dialog = await applyBatch(user, '17500000');
    expect(dialog.getByText('Calculate Focaccia for 17500000 g (17.5 tonnes)?')).toBeInTheDocument();
  });

  it('goes back to the base recipe on an empty box or a 0, with no question', async () => {
    window.localStorage.setItem('catalogue-scaled', JSON.stringify({ f: { target: 3440, ts: Date.now() } }));
    const { user } = await open();
    expect(rowsOf()[0]).toEqual(['Flour', '2000', 'g']);
    await user.clear(gramsBox());
    await user.click(calculate());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowsOf()[0]).toEqual(['Flour', '1000', 'g']);
    expect(JSON.parse(window.localStorage.getItem('catalogue-scaled') ?? '{}')).toEqual({});

    await user.type(gramsBox(), '0');
    await user.click(calculate());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowsOf()[0]).toEqual(['Flour', '1000', 'g']);
  });

  it('remembers the batch when the recipe is opened again, with the box filled in', async () => {
    window.localStorage.setItem('catalogue-scaled', JSON.stringify({ f: { target: 3440, ts: Date.now() - 60_000 } }));
    await open();
    expect(rowsOf()).toEqual([
      ['Flour', '2000', 'g'],
      ['Water', '1400', 'g'],
      ['Salt', '40', 'g'],
      ['Total', '3440', 'g'],
    ]);
    expect(gramsBox()).toHaveValue(3440);
  });

  it('forgets a batch older than 12 hours', async () => {
    window.localStorage.setItem('catalogue-scaled', JSON.stringify({ f: { target: 3440, ts: Date.now() - 13 * 3600_000 } }));
    await open();
    expect(rowsOf()[0]).toEqual(['Flour', '1000', 'g']);
    expect(gramsBox()).toHaveValue(null);
  });

  it('clears the batch with the Clear button', async () => {
    window.localStorage.setItem('catalogue-scaled', JSON.stringify({ f: { target: 3440, ts: Date.now() } }));
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Clear — back to base recipe' }));
    expect(rowsOf()[0]).toEqual(['Flour', '1000', 'g']);
    expect(gramsBox()).toHaveValue(null);
    expect(main().queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('catalogue-scaled') ?? '{}')).toEqual({});
  });

  it('scales a mixed recipe in each row\'s own unit, leaving «to taste» without a number', async () => {
    const { user } = await open([MIXED], 'm');
    const dialog = await applyBatch(user, '1500');
    await user.click(dialog.getByRole('button', { name: 'Calculate' }));
    expect(rowsOf()).toEqual([
      ['Flour', '500', 'g'],
      ['Eggs', '6', 'pcs'],
      ['Milk', '1', 'l'],
      ['Sugar', '4', 'tbsp'],
      ['Pepper', '2', 'pinch'],
      ['Salt', '', 'to taste'],
      ['Total', '1500', 'g'],
    ]);
  });

  it('says the question in Italian', async () => {
    const { user } = await open([FOCACCIA], 'f', { lang: 'it', session: { language: 'it' } });
    await user.type(main().getByRole('spinbutton', { name: 'Peso totale dell’impasto in grammi' }), '3440');
    await user.click(main().getByRole('button', { name: 'Calcola' }));
    expect(question().getByText('Vuoi calcolare la ricetta?')).toBeInTheDocument();
    expect(question().getByText('Calcolare Focaccia per 3440 g (3.44 kg)?')).toBeInTheDocument();
  });
});

describe('the full-screen view', () => {
  const dialog = () => screen.queryByRole('dialog', { name: 'Focaccia' });
  const opener = () => main().getByRole('button', { name: 'View recipe full screen' });

  it('opens from the button, labelled by the recipe, with the rows and the total', async () => {
    const { user } = await open();
    expect(dialog()).not.toBeInTheDocument();
    await user.click(opener());
    const view = within(screen.getByRole('dialog', { name: 'Focaccia' }));
    expect(view.getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour1000 g', 'Water700 g', 'Salt20 g']);
    expect(view.getByText('Total')).toBeInTheDocument();
    expect(view.getByText('1720 g')).toBeInTheDocument();
  });

  it('opens from a tap on the list, shows the scaled amounts and the words of the units', async () => {
    window.localStorage.setItem('catalogue-scaled', JSON.stringify({ m: { target: 1500, ts: Date.now() } }));
    const { user } = await open([MIXED], 'm');
    await user.click(within(table()).getByText('Eggs'));
    const view = within(screen.getByRole('dialog', { name: 'Mixed' }));
    expect(view.getAllByRole('listitem').map(row => row.textContent)).toEqual([
      'Flour500 g', 'Eggs6 pcs', 'Milk1 l', 'Sugar4 tbsp', 'Pepper2 pinch', 'Saltto taste',
    ]);
    expect(view.getByText('1500 g')).toBeInTheDocument();
  });

  it('closes with the × and with Escape, and gives the focus back to the button', async () => {
    const { user } = await open();
    await user.click(opener());
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(dialog()).not.toBeInTheDocument();
    expect(opener()).toHaveFocus();

    await user.click(opener());
    await user.keyboard('{Escape}');
    expect(dialog()).not.toBeInTheDocument();
    expect(opener()).toHaveFocus();
  });

  // The catalogue's text size has a key of its own (the Calculator's is mise.calcZoomStep).
  it('keeps the text size under mise.catZoomStep, and never touches the Calculator\'s', async () => {
    window.localStorage.setItem('mise.calcZoomStep', '4');
    const { user } = await open();
    await user.click(opener());
    const size = () => (screen.getByRole('dialog', { name: 'Focaccia' }) as HTMLElement).style.fontSize;
    expect(size()).toBe('calc(var(--fs-2xl) * 1)');
    await user.click(screen.getByRole('button', { name: 'Larger text' }));
    expect(size()).toBe('calc(var(--fs-2xl) * 1.2)');
    expect(window.localStorage.getItem('mise.catZoomStep')).toBe('2');
    expect(window.localStorage.getItem('mise.calcZoomStep')).toBe('4');
  });

  it('starts from the size remembered in mise.catZoomStep', async () => {
    window.localStorage.setItem('mise.catZoomStep', '3');
    const { user } = await open();
    await user.click(opener());
    await waitFor(() => {
      expect((screen.getByRole('dialog', { name: 'Focaccia' }) as HTMLElement).style.fontSize).toBe('calc(var(--fs-2xl) * 1.45)');
    });
  });
});
