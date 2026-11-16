import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
// Invented, mixed units: ten gram rows of 2523 g and 0.05 kg of yeast, 25280 g. At 5056 g (×0.2) each gram row is 504.6 g, which reads
// 510 g, and the yeast 0.01 kg: the Total is 5110 g, 54 g over the batch, and nothing is corrected (a kg row).
const MIXED = recipe('mx', {
  name: 'Misto di prova',
  ingredients: [
    ...Array.from({ length: 10 }, (_, i) => ({ label: `Farina ${i + 1} di prova`, grams: 2523, unit: 'g' })),
    { label: 'Lievito di prova', grams: 0.05, unit: 'kg' },
  ],
});

const main = () => within(screen.getByRole('main'));
const table = () => main().getByRole('table', { name: /^(Ingredients|Ingredienti)$/ });
const rowsOf = () => within(table()).getAllByRole('row').map(row => Array.from(row.children).map(cell => cell.textContent));
const scaled = (id: string, target: number, by?: Record<string, unknown>) => {
  window.localStorage.setItem('catalogue-scaled', JSON.stringify({ [id]: { target, ts: Date.now() - 60_000, ...(by ? { by } : {}) } }));
};

async function open(id: string, options = {}) {
  const view = renderRecipes(`/recipes/${id}`, { source: sourceWith([PROVA, FIVE, MIXED]), ...options });
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
    // Right under the ingredient table, inside its polite live region.
    expect(table().nextElementSibling).toBe(line.parentElement);
  });

  it('the line is announced: it arrives in a polite live region that is already there before it', async () => {
    const user = userEvent.setup();
    await open('five');
    // The recipe as written: the region is under the table, empty.
    const region = table().nextElementSibling as HTMLElement;
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    // A batch of 3 g the correction refuses: the line arrives in that same region, which a screen reader then reads out.
    await user.type(main().getByRole('spinbutton', { name: 'Total dough weight in grams' }), '3');
    await user.click(main().getByRole('button', { name: 'Calculate' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Calculate' }));
    const line = await main().findByText('The total is off by 2 g: check the recipe.');
    expect(table().nextElementSibling).toBe(region);
    expect(region).toContainElement(line);
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

describe('a batch with kg, l or ml rows: never corrected, but a Total off the batch is said (the owner, 16 Nov 2026)', () => {
  it('5056 g asked, the rows come to 5110 g: the rows as rounded, and the line says 54 g', async () => {
    scaled('mx', 5056);
    await open('mx');
    expect(rowsOf().slice(0, -1).map(row => row[1])).toEqual([...Array.from({ length: 10 }, () => '510'), '0.01']);
    expect(rowsOf().at(-1)).toEqual(['Total', '5110', 'g']);
    expect(main().getByText('The total is off by 54 g: check the recipe.')).toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    scaled('mx', 5056);
    await open('mx', { lang: 'it', session: { language: 'it' } });
    expect(main().getByText('Il totale non torna di 54 g: controlla la ricetta.')).toBeInTheDocument();
  });

  it('none when the batch was worked out from a row', async () => {
    // «Calculate from this ingredient», Farina 1 at 510 g: the same factor, and the Total is the rows — but the batch is the row.
    scaled('mx', 5056, { key: 'name:Farina 1 di prova#1', amount: 510, unit: 'g' });
    await open('mx');
    expect(main().getByText('Calculated from Farina 1 di prova: 510 g')).toBeInTheDocument();
    expect(rowsOf().at(-1)).toEqual(['Total', '5110', 'g']);
    expect(main().queryByText(/The total is off/)).not.toBeInTheDocument();
  });

  it('none on the recipe as written', async () => {
    await open('mx');
    expect(rowsOf().at(-1)).toEqual(['Total', '25280', 'g']);
    expect(main().queryByText(/The total is off/)).not.toBeInTheDocument();
  });
});
