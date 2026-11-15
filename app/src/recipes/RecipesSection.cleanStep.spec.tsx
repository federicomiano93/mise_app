import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// The recipe book's clean-step rounding and its one correction of the total (Mise 2 only, the owner's decision of 16 Nov 2026), as
// the recipe screen draws them. Invented recipes and amounts only.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

// Invented: 2990 g, ten rows.
const PROVA = recipe('pv', {
  name: 'Pane di prova',
  ingredients: ([
    ['Farina A di prova', 1000], ['Farina B di prova', 640], ['Acqua di prova', 720], ['Burro di prova', 310], ['Zucchero di prova', 180],
    ['Tuorli di prova', 95], ['Sale di prova', 22], ['Lievito di prova', 14], ['Malto di prova', 6], ['Vaniglia di prova', 3],
  ] as const).map(([label, grams]) => ({ label, grams, unit: 'g' })),
});
// Five invented rows of 200 g: at 3 g each reads 1 g, and no correction can bring the rows to 3 g without emptying one.
const FIVE = recipe('five', { name: 'Cinque di prova', ingredients: [1, 2, 3, 4, 5].map(n => ({ label: `Riga ${n}`, grams: 200, unit: 'g' })) });

const main = () => within(screen.getByRole('main'));
const table = () => main().getByRole('table', { name: /^(Ingredients|Ingredienti)$/ });
const rowsOf = () => within(table()).getAllByRole('row').map(row => Array.from(row.children).map(cell => cell.textContent));
const scaled = (id: string, target: number) => {
  window.localStorage.setItem('catalogue-scaled', JSON.stringify({ [id]: { target, ts: Date.now() - 60_000 } }));
};

async function open(id: string, options = {}) {
  const view = renderRecipes(`/recipes/${id}`, { source: sourceWith([PROVA, FIVE]), ...options });
  await screen.findByRole('table', undefined, LOAD);
  return view;
}

describe('clean-step rounding on the recipe screen', () => {
  it('a batch by total: clean steps, corrected to the typed total, and no warning', async () => {
    scaled('pv', 4000);
    await open('pv');
    expect(rowsOf().map(row => row[1])).toEqual(['1340', '860', '960', '415', '239', '126', '29', '19', '8', '4', '4000']);
    expect(main().queryByText(/The total is off/)).not.toBeInTheDocument();
  });

  it('a batch the correction refuses: the rows as rounded, and one line under the Total says by how much', async () => {
    scaled('five', 3);
    await open('five');
    expect(rowsOf().slice(0, -1).map(row => row[1])).toEqual(['1', '1', '1', '1', '1']);
    // The Total is the rows shown, added up — not the 3 g typed.
    expect(rowsOf().at(-1)).toEqual(['Total', '5', 'g']);
    const line = main().getByText('The total is off by 2 g: check the recipe.');
    // Right under the ingredient table.
    expect(table().nextElementSibling).toBe(line);
  });

  it('says it in Italian', async () => {
    scaled('five', 3);
    await open('five', { lang: 'it', session: { language: 'it' } });
    expect(main().getByText('Il totale non torna di 2 g: controlla la ricetta.')).toBeInTheDocument();
  });

  it('the recipe as written has no warning', async () => {
    await open('five');
    expect(main().queryByText(/The total is off/)).not.toBeInTheDocument();
  });
});
