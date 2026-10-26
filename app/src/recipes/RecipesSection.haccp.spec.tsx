import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';
import { closePrintHost } from './printHost';

// The HACCP list and the HACCP label screen (image labels step 2). jsdom has no 2D canvas and no layout, so the drawing
// (labelCanvas) and the typeface (labelFonts) are replaced by stand-ins that answer what the browser would; everything else
// is real — the layout with the real width table, the content, the settings, the print host.

const canvas = vi.hoisted(() => ({
  render: vi.fn(),
  paint: vi.fn(),
  png: vi.fn(),
  load: vi.fn(),
}));
vi.mock('./labelCanvas', () => ({
  renderLayoutBitmap: (...args: unknown[]) => canvas.render(...args) as unknown,
  paintBitmap: (...args: unknown[]) => canvas.paint(...args) as unknown,
  bitmapPng: (...args: unknown[]) => canvas.png(...args) as unknown,
  loadLogoImage: (...args: unknown[]) => canvas.load(...args) as unknown,
}));

const fonts = vi.hoisted(() => ({ state: 'ready' as 'loading' | 'ready' | 'failed' }));
vi.mock('./labelFonts', async importOriginal => {
  const original = await importOriginal<typeof import('./labelFonts')>();
  return { ...original, useLabelFonts: () => fonts.state };
});

const PNG = 'data:image/png;base64,HACCP';
const emptyBitmap = () => ({ width: 480, height: 320, bytesPerRow: 60, bits: new Uint8Array(60 * 320) });

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  fonts.state = 'ready';
  canvas.render.mockImplementation(emptyBitmap);
  canvas.paint.mockImplementation(() => undefined);
  canvas.png.mockImplementation(() => PNG);
  canvas.load.mockImplementation(() => Promise.resolve({}));
  // Only the date is faked: the timers the screens and the waits use stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 26, 10, 0, 0));
});

afterEach(() => {
  act(() => { closePrintHost(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  canvas.render.mockReset();
  canvas.paint.mockReset();
  canvas.png.mockReset();
  canvas.load.mockReset();
  window.localStorage.clear();
});

const STAMP = '2026-01-01';
const NUTRITION = { kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5 };
const declared = (id: string, allergens: string[]): StoredDoc =>
  ({ id, name: id, allergens, allergensCheckedAt: STAMP, nutrition: NUTRITION });
const INGREDIENTS = [declared('flour', ['gluten-wheat']), declared('milk', ['milk'])];
const row = (label: string, refId?: string) => ({ label, grams: 100, unit: 'g', ...(refId === undefined ? {} : { refId }) });
const recipeDoc = (id: string, name: string, extra: Record<string, unknown> = {}): StoredDoc =>
  ({ id, name, ingredients: [row('Flour', 'flour'), row('Milk', 'milk')], ...extra });

const CREAM = recipeDoc('cream', 'Crema', { shelfLifeDays: 3, category: 'Semilavorati', haccpStorage: 'In the fridge at +4 °C' });
const DOUGH = recipeDoc('dough', 'Impasto', { category: 'Dolci' });
const OLD = recipeDoc('old', 'Archiviata', { category: 'Semilavorati', archived: true });
const RECIPES = [DOUGH, OLD, CREAM];

const GB = { country: 'GB' };
const IT = { country: 'IT' };
const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };

type Options = {
  path?: string;
  recipes?: StoredDoc[];
  labelConfig?: Record<string, unknown> | null;
  location?: Record<string, unknown>;
  lang?: 'en' | 'it';
  session?: Record<string, unknown>;
  members?: Record<string, Record<string, unknown>>;
};

function open({ path = '/recipes/haccp', recipes = RECIPES, labelConfig = null, location = GB, lang = 'en', session = {}, members }: Options = {}) {
  const source = fakeRecipesSource({ recipes, ingredients: INGREDIENTS, labelConfig, ...(members === undefined ? {} : { members }) });
  const view = renderRecipes(path, { source, lang, session: { location, language: lang, ...session } });
  return { ...view, source };
}

const main = () => within(screen.getByRole('main'));
// The HACCP list itself: the recipe list stays in the page beside it (and behind it on a phone), with its own rows.
const list = () => within(screen.getByRole('region', { name: 'HACCP labels' }));
const listReady = () => screen.findByRole('region', { name: 'HACCP labels' }, LOAD);
const names = () => list().getAllByRole('listitem').map(item => item.textContent);
const preview = (size = '60 × 40') => main().findByRole('img', { name: `HACCP label preview, ${size} mm` }, LOAD);
const printButton = () => main().getByRole('button', { name: 'Print' });
const openLabel = (labelConfig: Record<string, unknown> | null = null, recipe: StoredDoc = CREAM, extra: Options = {}) =>
  open({ path: `/recipes/${recipe.id}/haccp`, recipes: [recipe], labelConfig, ...extra });

// A date box set the way a person sets it.
const setDate = (box: HTMLElement, value: string) => { fireEvent.change(box, { target: { value } }); };

describe('the door', () => {
  it('is at the foot of the recipe list for an employee too, after the Allergen sheet and before Settings', async () => {
    open({ path: '/recipes', session: EMPLOYEE });
    const door = await main().findByRole('button', { name: 'HACCP labels' }, LOAD);
    expect(door).toBeInTheDocument();
    const foot = main().getAllByRole('button').map(button => button.textContent);
    expect(foot.indexOf('Allergen sheet')).toBeGreaterThan(-1);
    expect(foot.indexOf('HACCP labels')).toBeGreaterThan(foot.indexOf('Allergen sheet'));
    // An employee has no Settings door.
    expect(main().queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('comes before Settings for whoever runs the place', async () => {
    open({ path: '/recipes' });
    await main().findByRole('button', { name: 'HACCP labels' }, LOAD);
    const foot = main().getAllByRole('button').map(button => button.textContent);
    expect(foot.indexOf('HACCP labels')).toBeLessThan(foot.indexOf('Settings'));
  });

  it('opens the HACCP list, and Back returns the focus to the door', async () => {
    const { user, router } = open({ path: '/recipes', session: EMPLOYEE });
    await user.click(await main().findByRole('button', { name: 'HACCP labels' }, LOAD));
    expect(router.state.location.pathname).toBe('/recipes/haccp');
    const heading = await main().findByRole('heading', { level: 2, name: 'HACCP labels' }, LOAD);
    await waitFor(() => { expect(heading).toHaveFocus(); });
    await user.click(main().getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/recipes');
    await waitFor(() => { expect(main().getByRole('button', { name: 'HACCP labels' })).toHaveFocus(); });
  });
});

describe('the HACCP list', () => {
  it('shows every recipe but the archived ones, alphabetically, when no category is chosen', async () => {
    open();
    await listReady();
    expect(await list().findByText('All recipes', undefined, LOAD)).toBeInTheDocument();
    expect(names()).toEqual(['Crema', 'Impasto']);
  });

  it('⚠️ shows only the chosen category, and says so', async () => {
    open({ labelConfig: { recipeCategories: ['Semilavorati', 'Dolci'], haccpCategory: 'Semilavorati' } });
    await listReady();
    expect(await list().findByText('Only the category Semilavorati', undefined, LOAD)).toBeInTheDocument();
    // The archived recipe of that category stays out.
    expect(names()).toEqual(['Crema']);
  });

  it('reads a category that has left the venue’s list as every recipe', async () => {
    open({ labelConfig: { recipeCategories: ['Dolci'], haccpCategory: 'Semilavorati' } });
    await listReady();
    expect(await list().findByText('All recipes', undefined, LOAD)).toBeInTheDocument();
    expect(names()).toEqual(['Crema', 'Impasto']);
  });

  it('says so when the chosen category holds no recipe', async () => {
    open({ recipes: [DOUGH], labelConfig: { recipeCategories: ['Semilavorati', 'Dolci'], haccpCategory: 'Semilavorati' } });
    await listReady();
    expect(await list().findByText('No recipe in the category Semilavorati yet.', undefined, LOAD)).toBeInTheDocument();
    expect(list().queryAllByRole('listitem')).toEqual([]);
  });

  it('searches by name within the list, and says when nothing matches', async () => {
    const { user } = open();
    await listReady();
    await list().findByText('Impasto', undefined, LOAD);
    await user.type(list().getByRole('searchbox', { name: 'Search a recipe by name' }), 'imp');
    expect(names()).toEqual(['Impasto']);
    await user.clear(list().getByRole('searchbox', { name: 'Search a recipe by name' }));
    await user.type(list().getByRole('searchbox', { name: 'Search a recipe by name' }), 'zzz');
    expect(list().getByText('No recipe matches your search.')).toBeInTheDocument();
    // An archived recipe is not found either.
    await user.clear(list().getByRole('searchbox', { name: 'Search a recipe by name' }));
    await user.type(list().getByRole('searchbox', { name: 'Search a recipe by name' }), 'archiv');
    expect(list().getByText('No recipe matches your search.')).toBeInTheDocument();
  });

  it('opens a recipe’s HACCP label, and Back returns to the list with the focus on that row', async () => {
    const { user, router } = open();
    await listReady();
    await user.click(list().getByRole('button', { name: 'Crema' }));
    expect(router.state.location.pathname).toBe('/recipes/cream/haccp');
    const title = await main().findByRole('heading', { level: 2, name: 'HACCP label' }, LOAD);
    expect(within(screen.getByRole('region', { name: 'HACCP label' })).getByText('Crema')).toBeInTheDocument();
    await waitFor(() => { expect(title).toHaveFocus(); });
    await user.click(main().getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/recipes/haccp');
    await waitFor(() => { expect(list().getByRole('button', { name: 'Crema' })).toHaveFocus(); });
  });

  it('⚠️ a label opened by its address, with no list behind it, goes back by REPLACING itself with the HACCP list', async () => {
    const { user, router } = openLabel();
    await main().findByRole('heading', { level: 2, name: 'HACCP label' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/recipes/haccp');
    expect(await main().findByRole('heading', { level: 2, name: 'HACCP labels' }, LOAD)).toBeInTheDocument();
  });

  it('says its words in Italian', async () => {
    open({ lang: 'it', location: IT });
    expect(await main().findByRole('heading', { level: 2, name: 'Etichette HACCP' }, LOAD)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Etichette HACCP' })).getByText('Tutte le ricette')).toBeInTheDocument();
  });
});

describe('the refusals', () => {
  it('no country: nothing to print, the product label’s sentence', async () => {
    openLabel(null, CREAM, { location: {} });
    expect(await main().findByText(/nobody has said which country/, undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('⚠️ allergens printed in a venue with allergens off: says to set the field to By hand or Off', async () => {
    openLabel(null, CREAM, { location: { ...GB, showAllergens: false } });
    expect(await main().findByText(/set the Allergens field to “By hand” or “Off”/, undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('⚠️ allergens printed on a recipe that is not fully declared: the product label’s sentence, nothing to print', async () => {
    const unknown = recipeDoc('mystery', 'Mistero', { ingredients: [row('Flour', 'flour'), row('Mystery')] });
    openLabel(null, unknown);
    expect(await main().findByText(/ingredient/, undefined, LOAD)).toBeInTheDocument();
    expect(main().getByText('No label can be made')).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('the allergens field set to By hand never asks for the declarations', async () => {
    const unknown = recipeDoc('mystery', 'Mistero', { ingredients: [row('Flour', 'flour'), row('Mystery')] });
    openLabel({ haccpFields: { allergens: 'blank' } }, unknown);
    expect(await preview()).toBeInTheDocument();
    expect(main().queryByText('No label can be made')).not.toBeInTheDocument();
  });

  it('the allergens field set to By hand prints in a venue with allergens off', async () => {
    openLabel({ haccpFields: { allergens: 'blank' } }, CREAM, { location: { ...GB, showAllergens: false } });
    expect(await preview()).toBeInTheDocument();
  });

  it('every field off: says to choose at least one in Settings', async () => {
    const off = Object.fromEntries(['name', 'preparedOn', 'useBy', 'allergens'].map(field => [field, 'off']));
    openLabel({ haccpFields: off });
    expect(await main().findByText('Every field is off: whoever manages the venue can choose at least one in Settings.', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('a label that does not fit is refused, never shrunk', async () => {
    const all = Object.fromEntries(['lot', 'preparedBy', 'storage', 'blastChilledOn', 'frozenOn', 'openedOn', 'quantity'].map(field => [field, 'print']));
    openLabel({ haccpFields: all, haccpSize: '40x30' });
    expect(await main().findByText('It does not fit: shorten what you typed, or whoever manages the venue can switch a field off or choose a bigger label size in Settings.', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
    expect(canvas.render).not.toHaveBeenCalled();
  });
});

describe('the boxes of this print', () => {
  it('with the default settings only the prepared-on date is a box, and the use-by date is shown, not typed', async () => {
    openLabel();
    const date = await main().findByLabelText('Prepared on', undefined, LOAD);
    expect(date).toHaveValue('2026-10-26');
    expect(date).toHaveAttribute('type', 'date');
    expect(main().queryByLabelText('Lot')).not.toBeInTheDocument();
    expect(main().queryByLabelText('Prepared by')).not.toBeInTheDocument();
    expect(main().queryByLabelText('Storage')).not.toBeInTheDocument();
    expect(main().queryByLabelText('Quantity')).not.toBeInTheDocument();
    // Today + the recipe’s 3 days.
    expect(main().getByText('29/10/2026')).toBeInTheDocument();
    expect(main().queryByLabelText('Use by')).not.toBeInTheDocument();
  });

  it('draws a box for each printed field that takes a value, and none for a field left to the pen or switched off', async () => {
    openLabel({ haccpFields: { lot: 'print', storage: 'print', quantity: 'print', frozenOn: 'print', preparedBy: 'blank', openedOn: 'off' } }, CREAM, { session: { user: { uid: 'nobody' } } });
    await main().findByLabelText('Lot', undefined, LOAD);
    for (const label of ['Storage', 'Quantity', 'Frozen on']) expect(main().getByLabelText(label)).toBeInTheDocument();
    for (const label of ['Prepared by', 'Opened on', 'Blast-chilled on']) expect(main().queryByLabelText(label)).not.toBeInTheDocument();
    // The text boxes are bound.
    expect(main().getByLabelText('Quantity')).toHaveAttribute('maxlength', '80');
    expect(main().getByLabelText('Lot')).toHaveAttribute('maxlength', '80');
  });

  it('starts the storage box from the recipe’s own text', async () => {
    openLabel({ haccpFields: { storage: 'print' } });
    expect(await main().findByLabelText('Storage', undefined, LOAD)).toHaveValue('In the fridge at +4 °C');
  });

  it('⚠️ the lot follows the prepared-on date until the person types in it', async () => {
    openLabel({ haccpFields: { lot: 'print' } });
    const lot = await main().findByLabelText('Lot', undefined, LOAD);
    expect(lot).toHaveValue('261026');
    setDate(main().getByLabelText('Prepared on'), '2026-11-03');
    expect(main().getByLabelText('Lot')).toHaveValue('031126');
    fireEvent.change(main().getByLabelText('Lot'), { target: { value: 'A-17' } });
    setDate(main().getByLabelText('Prepared on'), '2026-12-25');
    expect(main().getByLabelText('Lot')).toHaveValue('A-17');
  });

  it('prefills prepared-by once with the first name from the roster, and the person can change it', async () => {
    const { source, user } = openLabel({ haccpFields: { preparedBy: 'print' } }, CREAM, { members: { u1: { firstName: 'Federico Maria', lastName: 'Miano' } } });
    const box = await main().findByLabelText('Prepared by', undefined, LOAD);
    await waitFor(() => { expect(box).toHaveValue('Federico'); });
    expect(source.readMember).toHaveBeenCalledTimes(1);
    expect(source.readMember).toHaveBeenCalledWith('u1');
    await user.clear(box);
    await user.type(box, 'Anna');
    expect(box).toHaveValue('Anna');
  });

  it('⚠️ reads the roster only when the prepared-by field is printed', async () => {
    const { source } = openLabel({ haccpFields: { preparedBy: 'blank' } }, CREAM, { members: { u1: { firstName: 'Federico' } } });
    await preview();
    expect(source.readMember).not.toHaveBeenCalled();
  });

  it('leaves prepared-by empty when the roster has nobody for this person', async () => {
    openLabel({ haccpFields: { preparedBy: 'print' } });
    expect(await main().findByLabelText('Prepared by', undefined, LOAD)).toHaveValue('');
  });

  it('⚠️ a roster answer that arrives after the person typed leaves their words, and one after leaving changes nothing', async () => {
    let answer: (member: Record<string, unknown> | null) => void = () => undefined;
    const { source, user } = openLabel({ haccpFields: { preparedBy: 'print' } });
    vi.mocked(source.readMember).mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const box = await main().findByLabelText('Prepared by', undefined, LOAD);
    await waitFor(() => { expect(source.readMember).toHaveBeenCalled(); });
    await user.type(box, 'Anna');
    await act(async () => { answer({ firstName: 'Federico' }); await Promise.resolve(); });
    expect(box).toHaveValue('Anna');
    const errors = vi.spyOn(console, 'error');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(main().queryByLabelText('Prepared by')).not.toBeInTheDocument(); });
    await act(async () => { answer({ firstName: 'Giulia' }); await Promise.resolve(); });
    expect(errors).not.toHaveBeenCalled();
  });

  it('⚠️ the prepared-on date is a box whenever the use-by date or the lot counts from it, even when it is not printed', async () => {
    openLabel({ haccpFields: { preparedOn: 'off', useBy: 'print' } });
    const date = await main().findByLabelText('Prepared on', undefined, LOAD);
    expect(main().getByText('Not printed: the use-by date and the lot are counted from it.')).toBeInTheDocument();
    setDate(date, '2026-12-30');
    expect(main().getByText('02/01/2027')).toBeInTheDocument();
    const content = canvas.render.mock.calls.at(-1)?.[0] as Array<{ kind: string; text?: string }> | undefined;
    expect(content?.some(el => el.text === 'Prepared on:')).not.toBe(true);
  });

  it('the lot alone also brings the prepared-on box; nothing that counts from it, no box', async () => {
    openLabel({ haccpFields: { preparedOn: 'off', useBy: 'off', lot: 'print' } });
    expect(await main().findByLabelText('Prepared on', undefined, LOAD)).toBeInTheDocument();
  });

  it('a cleared prepared-on date says why the use-by date is left to the pen', async () => {
    openLabel();
    setDate(await main().findByLabelText('Prepared on', undefined, LOAD), '');
    expect(main().getByText('No prepared-on date, so the use-by date stays to be written by hand.')).toBeInTheDocument();
    expect(main().queryByText(/this recipe has no shelf life/i)).not.toBeInTheDocument();
  });

  it('⚠️ an untouched date follows the day when the screen comes back; a typed one stays the person’s', async () => {
    openLabel({ haccpFields: { frozenOn: 'print' } });
    const prepared = await main().findByLabelText('Prepared on', undefined, LOAD);
    setDate(main().getByLabelText('Frozen on'), '2026-10-20');
    vi.setSystemTime(new Date(2026, 9, 27, 6, 0, 0));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(prepared).toHaveValue('2026-10-27');
    expect(main().getByText('30/10/2026')).toBeInTheDocument();
    expect(main().getByLabelText('Frozen on')).toHaveValue('2026-10-20');
  });

  it('⚠️ Print after midnight with no look in between draws today’s label first, and prints it on the next tap', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = openLabel();
    await preview();
    vi.setSystemTime(new Date(2026, 9, 27, 0, 0, 30));
    await user.click(printButton());
    expect(print).not.toHaveBeenCalled();
    expect(main().getByLabelText('Prepared on')).toHaveValue('2026-10-27');
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('the storage box follows the recipe’s text until somebody types in it', async () => {
    const { source, user } = openLabel({ haccpFields: { storage: 'print' } });
    const box = await main().findByLabelText('Storage', undefined, LOAD);
    act(() => { source.recipes.set('cream', { ...CREAM, haccpStorage: 'Frozen at -18 °C' }); source.push(); });
    await waitFor(() => { expect(box).toHaveValue('Frozen at -18 °C'); });
    await user.clear(box);
    await user.type(box, 'Fridge');
    act(() => { source.recipes.set('cream', { ...CREAM, haccpStorage: 'Something else' }); source.push(); });
    expect(box).toHaveValue('Fridge');
  });

  it('⚠️ a recipe with no shelf life says the use-by date stays to be written by hand', async () => {
    openLabel(null, recipeDoc('cream', 'Crema'));
    expect(await main().findByText(/the use-by date stays to be written by hand/, undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByText('29/10/2026')).not.toBeInTheDocument();
  });

  it('counts the use-by date from the date it is prepared on', async () => {
    openLabel();
    setDate(await main().findByLabelText('Prepared on', undefined, LOAD), '2026-12-30');
    expect(main().getByText('02/01/2027')).toBeInTheDocument();
    setDate(main().getByLabelText('Prepared on'), '');
    expect(main().queryByText('02/01/2027')).not.toBeInTheDocument();
  });

  it('⚠️ says nothing typed is saved, and writes nothing to the database', async () => {
    const { source, user } = openLabel({ haccpFields: { lot: 'print', quantity: 'print' } });
    await user.type(await main().findByLabelText('Quantity', undefined, LOAD), '2 kg');
    expect(main().getByText('What you type here goes on this label only: nothing is saved.')).toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
    expect(source.labelSaves).toEqual([]);
  });
});

describe('the label and Print', () => {
  it('draws the label at the chosen size from the very dots it prints', async () => {
    openLabel({ haccpSize: '62x29' });
    expect(await preview('62 × 29')).toBeInTheDocument();
    // The canvas is S times the label: 62 × 29 mm = 496 × 232 dots.
    const [elements, width, height, , logo] = canvas.render.mock.calls[0] as [unknown[], number, number, unknown, unknown];
    expect(Array.isArray(elements)).toBe(true);
    expect([width, height]).toEqual([496 * 4, 232 * 4]);
    expect(logo).toBeNull();
    expect(canvas.paint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 480 }));
    expect(main().getByText('Prints through this device’s print window, on a 62 × 29 mm label.')).toBeInTheDocument();
  });

  it('draws again when a box changes, and keeps Print for the drawing that matches', async () => {
    const { user } = openLabel({ haccpFields: { quantity: 'print' } });
    await preview();
    const before = canvas.render.mock.calls.length;
    await user.type(main().getByLabelText('Quantity'), '2');
    await waitFor(() => { expect(canvas.render.mock.calls.length).toBeGreaterThan(before); });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
  });

  it('⚠️ a snapshot that changes nothing does not draw the label again', async () => {
    const { source } = openLabel();
    await preview();
    await waitFor(() => { expect(canvas.render).toHaveBeenCalledTimes(1); });
    act(() => { source.push(); });
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(canvas.render).toHaveBeenCalledTimes(1);
  });

  it('puts the picture in a host on the page of the chosen size, then opens the print dialog', async () => {
    const seen: string[] = [];
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const host = document.getElementById('labelPrint');
      seen.push(`${host?.parentElement === document.body}|${host?.className}|${host?.querySelector('img')?.getAttribute('src')}`);
    });
    const { user } = openLabel({ haccpSize: '50x30' });
    await preview('50 × 30');
    expect(document.getElementById('labelPrint')).toBeNull();
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([`true|lab-print lab-print--haccp-50x30|${PNG}`]);
    const link = document.getElementById('labelPageHaccp50x30');
    expect(link).toBeInstanceOf(HTMLLinkElement);
    expect((link as HTMLLinkElement).media).toBe('print');
    // It outlives the screen, and goes once the person is back in the page.
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.getElementById('labelPrint')).not.toBeNull();
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    expect(document.getElementById('labelPrint')).toBeNull();
    expect((link as HTMLLinkElement).media).toBe('not all');
  });

  it('takes the host away again when the print dialog throws', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('no printer'); });
    const { user } = openLabel();
    await preview();
    await user.click(printButton());
    expect(document.getElementById('labelPrint')).toBeNull();
  });

  it('announces a label printed', async () => {
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const { user } = openLabel();
      await preview();
      await user.click(printButton());
      await waitFor(() => { expect(actions).toContain('haccp-label-printed'); });
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });

  it('offers one Print button and no queue, no ZPL', async () => {
    openLabel();
    await preview();
    expect(main().getAllByRole('button', { name: /print|copy|zpl/i }).map(b => b.textContent)).toEqual(['Print']);
  });

  it('says the typeface could not load instead of drawing', async () => {
    fonts.state = 'failed';
    openLabel();
    expect(await main().findByText(/typeface could not be loaded/, undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('prints the label’s words in the country’s language, not the interface’s', async () => {
    openLabel(null, CREAM, { lang: 'en', location: IT });
    await preview();
    const content = canvas.render.mock.calls[0]?.[0] as Array<{ kind: string; text?: string }>;
    const texts = content.filter(el => el.kind === 'text').map(el => el.text);
    expect(texts).toContain('Preparato il:');
    expect(texts).not.toContain('Prepared on:');
  });
});
