import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// The recipe screen's «Export» (PDF / Excel): the last thing on the page, hidden when there is nothing to export,
// made from the very amounts the table drew. The builders are replaced (the files: ui/recipeExport.spec.ts).

const builders = vi.hoisted(() => ({ buildPdfBlob: vi.fn(), buildXlsxBlob: vi.fn() }));
vi.mock('../ui/recipeExport', () => builders);

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  builders.buildPdfBlob.mockReset().mockImplementation(() => Promise.resolve(new Blob(['%PDF'])));
  builders.buildXlsxBlob.mockReset().mockImplementation(() => Promise.resolve(new Blob(['PK'])));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test/1', revokeObjectURL: () => undefined }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const DECIMALS = recipe('d', {
  name: 'Impasto di prova',
  ingredients: [
    { label: 'Farina di prova', grams: 0.4, unit: 'kg' },
    { label: 'Latte di prova', grams: 1.25, unit: 'l' },
    { label: 'Uova di prova', grams: 2, unit: 'pcs' },
    { label: 'Sale di prova', grams: 0, unit: 'to taste' },
  ],
});
const EMPTY = recipe('e', { name: 'Vuota di prova', ingredients: [] });
const PLAIN = recipe('f', { name: 'Focaccia di prova' });

const main = () => within(screen.getByRole('main'));

async function open(id = 'f', lang: 'en' | 'it' = 'en') {
  const view = renderRecipes(`/recipes/${id}`, { source: sourceWith([PLAIN, DECIMALS, EMPTY]), lang });
  await screen.findByRole('heading', { level: 3, name: lang === 'it' ? 'Ingredienti' : 'Ingredients' }, LOAD);
  return view;
}

type Model = {
  name: string; trays: number; totalG: number;
  rows: { name: string; value: number | null; unit: string; factor: number; decimals: number; text: string | null }[];
};

describe('the Export button on the recipe screen', () => {
  it('⚠️ comes after every card; only Import into Calculator, Duplicate, Archive and the owner’s small delete icon follow it (his choices, 14-15 Oct 2026)', async () => {
    await open();
    const table = main().getByRole('table', { name: 'Ingredients' });
    const button = main().getByRole('button', { name: 'Export' });
    expect(table.contains(button)).toBe(false);
    expect(button.closest('section')).not.toBe(table.closest('section'));
    // Nothing on the page that a person can press or read comes after it.
    const page = button.closest('section');
    expect(page).not.toBeNull();
    const after = [...page!.querySelectorAll('button, a, input, h3, table')].filter(
      el => (button.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
    // The default session is the owner's: Import into Calculator, Duplicate, Archive (buttons; their hints are not pressable), then the delete icon, and nothing else, follow Export.
    expect(after.map(el => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Import into Calculator', 'Duplicate', 'Archive', 'Delete recipe']);
  });

  it('⚠️ is followed only by Import into Calculator for an employee, who has no delete icon', async () => {
    renderRecipes('/recipes/f', { source: sourceWith([PLAIN]), session: { role: 'staff', canManage: false, isOwner: false } });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    const button = main().getByRole('button', { name: 'Export' });
    const page = button.closest('section');
    const after = [...page!.querySelectorAll('button, a, input, h3, table')].filter(
      el => (button.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
    expect(after.map(el => el.textContent)).toEqual(['Import into Calculator']);
  });

  it('is hidden when the recipe has no ingredients', async () => {
    await open('e');
    expect(main().queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('does not open the full-screen view when pressed (it is outside the tapped table)', async () => {
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('dialog', { name: 'Export as' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Focaccia di prova' })).not.toBeInTheDocument();
  });

  it('exports the base amounts as the table shows them, with the Total word', async () => {
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Export' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Export as' })).getByRole('button', { name: /^Excel/ }));
    await screen.findByRole('dialog', { name: 'File ready' });
    const [model, totalLabel, fallback] = builders.buildXlsxBlob.mock.calls[0] as [Model, string, string];
    expect([totalLabel, fallback]).toEqual(['Total', 'Recipe']);
    expect(model.name).toBe('Focaccia di prova');
    expect(model.trays).toBe(0);
    expect(model.totalG).toBe(1720);
    expect(model.rows.map(row => [row.name, row.value, row.unit, row.factor])).toEqual([
      ['Flour', 1000, 'g', 1], ['Water', 700, 'g', 1], ['Salt', 20, 'g', 1],
    ]);
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'Focaccia_di_prova_1720g.xlsx');
  });

  it('⚠️ exports kg and l with the screen’s own number: «0,727 kg» in Italian, once a batch is applied', async () => {
    const { user } = await open('d', 'it');
    const box = main().getByRole('spinbutton');
    await user.clear(box);
    await user.type(box, '3000');
    await user.click(main().getByRole('button', { name: 'Calcola' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Calcola' }));
    const rows = within(main().getByRole('table', { name: 'Ingredienti' })).getAllByRole('row').map(row => row.textContent);
    expect(rows.slice(0, 4)).toEqual(['Farina di prova0,727kg', 'Latte di prova2,273l', 'Uova di prova4pz', 'Sale di provaq.b.']);
    await user.click(main().getByRole('button', { name: 'Esporta' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Esporta come' })).getByRole('button', { name: /^PDF/ }));
    await screen.findByRole('dialog', { name: 'File pronto' });
    const model = builders.buildPdfBlob.mock.calls[0]?.[0] as Model;
    expect(model.totalG).toBe(3000);
    expect(model.rows.map(row => [row.unit, row.decimals, row.text, row.factor])).toEqual([
      ['kg', 3, '0,727', 1000], ['l', 3, '2,273', 1000], ['pz', 0, '4', 0], ['q.b.', 0, null, 0],
    ]);
    expect(model.rows[3]?.value).toBeNull();
  });

  it('⚠️ closes the open sheet when the recipe changes under it (a live update from another phone)', async () => {
    const { user, source } = await open();
    await user.click(main().getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export as' });
    source.recipes.set('f', recipe('f', { name: 'Focaccia di prova', ingredients: [{ label: 'Flour', grams: 900, unit: 'g' }] }));
    act(() => { source.push(); });
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Export as' })).not.toBeInTheDocument(); });
  });
});
