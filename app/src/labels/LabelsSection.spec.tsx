import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from '../recipes/recipesSource';
import { closePrintHost } from '../recipes/printHost';

// «Labels» (the owner, 13 Nov 2026): the two choices, the list of recipes with its search, and the way into the Recipe
// catalogue's OWN label screens, with Back one level at a time. Who is shown it, and where it sits in the rail, is in
// LabelsSection.visibility.spec.tsx.

// jsdom has no 2D canvas: the HACCP label's drawing is replaced by a stand-in, as RecipesSection.haccp.spec.tsx does.
const canvas = vi.hoisted(() => ({ render: vi.fn(), paint: vi.fn(), png: vi.fn(), load: vi.fn() }));
vi.mock('../recipes/labelCanvas', () => ({
  renderLayoutBitmap: (...args: unknown[]) => canvas.render(...args) as unknown,
  paintBitmap: (...args: unknown[]) => canvas.paint(...args) as unknown,
  bitmapPng: (...args: unknown[]) => canvas.png(...args) as unknown,
  loadLogoImage: (...args: unknown[]) => canvas.load(...args) as unknown,
}));
vi.mock('../recipes/labelFonts', async importOriginal => {
  const original = await importOriginal<typeof import('../recipes/labelFonts')>();
  return { ...original, useLabelFonts: () => 'ready' };
});

beforeAll(async () => {
  await import('./LabelsSection');
  await import('../recipes/RecipesSection');
}, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  canvas.render.mockImplementation(() => ({ width: 480, height: 320, bytesPerRow: 60, bits: new Uint8Array(60 * 320) }));
  canvas.paint.mockImplementation(() => undefined);
  canvas.png.mockImplementation(() => 'data:image/png;base64,HACCP');
  canvas.load.mockImplementation(() => Promise.resolve({}));
});

afterEach(() => {
  act(() => { closePrintHost(); });
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const STAMP = '2026-01-01';
const NUTRITION = { kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5 };
const declared = (id: string, allergens: string[]): StoredDoc => ({ id, name: id, allergens, allergensCheckedAt: STAMP, nutrition: NUTRITION });
const INGREDIENTS = [declared('flour', ['gluten-wheat']), declared('milk', ['milk'])];
const row = (label: string, refId?: string) => ({ label, grams: 100, unit: 'g', ...(refId === undefined ? {} : { refId }) });
const recipeDoc = (id: string, name: string, extra: Record<string, unknown> = {}): StoredDoc =>
  ({ id, name, ingredients: [row('Flour', 'flour'), row('Milk', 'milk')], ...extra });

const CREAM = recipeDoc('cream', 'Crema', { shelfLifeDays: 3, category: 'Semilavorati' });
const BREAD = recipeDoc('bread', 'Bread', { category: 'Pane' });
const APPLE = recipeDoc('apple', 'Apple pie', { category: 'Dolci' });
const OLD = recipeDoc('old', 'Archived cake', { archived: true });
// An ingredient nobody has declared: today its label is refused, from inside the recipe and from here alike.
const GAP = { id: 'gap', name: 'Mystery bun', ingredients: [row('Flour', 'flour'), row('Mystery')] } as StoredDoc;
const RECIPES = [CREAM, BREAD, OLD, APPLE, GAP];

type Options = { path?: string; lang?: 'en' | 'it'; labelConfig?: Record<string, unknown> | null; entries?: string[] };

function open({ path = '/labels', lang = 'en', labelConfig = null, entries }: Options = {}) {
  const source = fakeRecipesSource({ recipes: RECIPES, ingredients: INGREDIENTS, labelConfig });
  return renderRecipes(path, { source, lang, session: { location: { country: 'GB' }, language: lang }, ...(entries ? { entries } : {}) });
}

const main = () => within(screen.getByRole('main'));
const card = (name: string) => within(screen.getByRole('region', { name }));
const rowNames = (name: string) => card(name).getAllByRole('listitem').map(item => item.textContent);

describe('the two choices', () => {
  it('are one screen with one h1, a Back button and two big choices', async () => {
    open();
    await screen.findByRole('region', { name: 'Which label?' }, LOAD);
    expect(screen.getByRole('heading', { level: 1, name: 'Labels' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const choices = card('Which label?');
    expect(choices.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    const links = choices.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/labels/product', '/labels/haccp']);
    expect(choices.getByRole('link', { name: 'Product label' })).toHaveAccessibleDescription('Ingredients and allergens, for what you sell.');
    expect(choices.getByRole('link', { name: 'HACCP label' })).toHaveAccessibleDescription(/^Date, use-by date and lot/);
  });

  it('speak Italian in an Italian venue', async () => {
    open({ lang: 'it' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Etichette' }, LOAD)).toBeInTheDocument();
    const choices = card('Quale etichetta?');
    expect(choices.getByRole('link', { name: 'Etichetta prodotto' })).toBeInTheDocument();
    expect(choices.getByRole('link', { name: 'Etichetta HACCP' })).toBeInTheDocument();
  });

  it('Back goes to the Home', async () => {
    const { router, user } = open({ entries: ['/home', '/labels'] });
    await screen.findByRole('heading', { level: 1, name: 'Labels' }, LOAD);
    await user.click(card('Which label?').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/home'); });
  });

  it('a junk address under /labels goes back to the choices', async () => {
    const { router } = open({ path: '/labels/nonsense/1' });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/labels'); });
    expect(await screen.findByRole('region', { name: 'Which label?' }, LOAD)).toBeInTheDocument();
  });
});

describe('the list of recipes', () => {
  it('opens from a choice with the focus on its title, alphabetical, archived recipes left out', async () => {
    const { router, user } = open();
    await user.click(await main().findByRole('link', { name: 'Product label' }, LOAD));
    expect(router.state.location.pathname).toBe('/labels/product');
    const title = await screen.findByRole('heading', { level: 2, name: 'Product label' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    await card('Product label').findByRole('button', { name: 'Apple pie' }, LOAD);
    expect(rowNames('Product label')).toEqual(['Apple pie', 'Bread', 'Crema', 'Mystery bun']);
    // Still one h1: the list is a card under the section's title.
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Labels']);
  });

  it('has a labelled search box that narrows the rows, and says when nothing matches', async () => {
    const { user } = open({ path: '/labels/product' });
    const search = await screen.findByRole('searchbox', { name: 'Search a recipe by name' }, LOAD);
    await user.type(search, 'bre');
    expect(rowNames('Product label')).toEqual(['Bread']);
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(card('Product label').getByText('No recipe matches your search.')).toBeInTheDocument();
  });

  it('for the HACCP label keeps to the category the venue chose in the label Settings, and says so', async () => {
    open({ path: '/labels/haccp', labelConfig: { recipeCategories: ['Semilavorati', 'Pane', 'Dolci'], haccpCategory: 'Semilavorati' } });
    await card('HACCP label').findByRole('button', { name: 'Crema' }, LOAD);
    expect(rowNames('HACCP label')).toEqual(['Crema']);
    expect(card('HACCP label').getByText('Only the category Semilavorati')).toBeInTheDocument();
  });

  it('speaks Italian: «Cerca una ricetta…»', async () => {
    open({ path: '/labels/haccp', lang: 'it' });
    const search = await screen.findByRole('searchbox', { name: 'Cerca una ricetta per nome' }, LOAD);
    expect(search).toHaveAttribute('placeholder', 'Cerca una ricetta…');
    expect(screen.getByRole('heading', { level: 2, name: 'Etichetta HACCP' })).toBeInTheDocument();
  });
});

describe('a recipe opens the Recipe catalogue’s own label screen, of the kind chosen', () => {
  it('Product label → the recipe’s label, the very screen «Make a label» opens', async () => {
    const { router, user } = open({ path: '/labels/product' });
    await user.click(await card('Product label').findByRole('button', { name: 'Crema' }, LOAD));
    expect(router.state.location.pathname).toBe('/recipes/cream/label');
    expect(await screen.findByRole('group', { name: 'What the label shows' }, LOAD)).toBeInTheDocument();
    const title = main().getByRole('heading', { level: 2, name: 'Crema' });
    await waitFor(() => { expect(title).toHaveFocus(); });
  });

  it('HACCP label → the recipe’s HACCP label', async () => {
    const { router, user } = open({ path: '/labels/haccp' });
    await user.click(await card('HACCP label').findByRole('button', { name: 'Crema' }, LOAD));
    expect(router.state.location.pathname).toBe('/recipes/cream/haccp');
    const title = await main().findByRole('heading', { level: 2, name: 'HACCP label' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    expect(await main().findByRole('img', { name: 'HACCP label preview, 60 × 40 mm' }, LOAD)).toBeInTheDocument();
  });

  it('a recipe whose label is refused today is refused here too, by the same screen', async () => {
    const { user } = open({ path: '/labels/product' });
    await user.click(await card('Product label').findByRole('button', { name: 'Mystery bun' }, LOAD));
    expect(await main().findByText('No label can be made', undefined, LOAD)).toBeInTheDocument();
    expect(main().getByText('1 ingredient is not declared. The recipe screen lists them.')).toBeInTheDocument();
  });
});

describe('Back, one level at a time: label → recipe list → the two choices → Home', () => {
  it('walks all the way up, with the focus back where the person left at each step', async () => {
    const { router, user } = open({ entries: ['/home', '/labels'] });
    await user.click(await main().findByRole('link', { name: 'Product label' }, LOAD));
    const search = await screen.findByRole('searchbox', { name: 'Search a recipe by name' }, LOAD);
    await user.type(search, 'cre');
    await user.click(card('Product label').getByRole('button', { name: 'Crema' }));
    expect(await screen.findByRole('group', { name: 'What the label shows' }, LOAD)).toBeInTheDocument();

    // The label's own Back: one level up, to the list, the search as it was and the focus on the row.
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/labels/product'); });
    const crema = await card('Product label').findByRole('button', { name: 'Crema' }, LOAD);
    expect(screen.getByRole('searchbox', { name: 'Search a recipe by name' })).toHaveValue('cre');
    await waitFor(() => { expect(crema).toHaveFocus(); });

    // The list's Back: the choices, the focus on the choice that opened it.
    await user.click(card('Product label').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/labels'); });
    const choice = await main().findByRole('link', { name: 'Product label' }, LOAD);
    await waitFor(() => { expect(choice).toHaveFocus(); });

    // The choices' Back: the Home.
    await user.click(card('Which label?').getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/home'); });
  });

  it('the browser’s Back from a HACCP label is the list too, and the keyboard reaches every Back', async () => {
    const { router, user } = open({ path: '/labels' });
    await user.click(await main().findByRole('link', { name: 'HACCP label' }, LOAD));
    await user.click(await card('HACCP label').findByRole('button', { name: 'Crema' }, LOAD));
    await main().findByRole('img', { name: 'HACCP label preview, 60 × 40 mm' }, LOAD);
    act(() => { void router.navigate(-1); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/labels/haccp'); });
    const crema = await card('HACCP label').findByRole('button', { name: 'Crema' }, LOAD);
    await waitFor(() => { expect(crema).toHaveFocus(); });
    // Shift+Tab from the search box reaches the list's Back; Enter on it is one level up.
    act(() => { screen.getByRole('searchbox', { name: 'Search a recipe by name' }).focus(); });
    await user.tab({ shift: true });
    expect(card('HACCP label').getByRole('button', { name: 'Back' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/labels'); });
  });

  it('a list opened by its address has nothing behind it: its Back replaces it with the choices', async () => {
    const { router, user } = open({ path: '/labels/haccp' });
    await user.click(await card('HACCP label').findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/labels'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
