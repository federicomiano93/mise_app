import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», slice B: Settings — the door, the two panel switches, and the categories.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const GB = { country: 'GB' };
const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;

const CATEGORIES = ['Dairy', 'Eggs', 'Flour'];

function sourceWith(config: Record<string, unknown> | null = { ingredientCategories: CATEGORIES }): FakeSuppliersSource {
  return fakeSuppliersSource({
    suppliers: [supplier('s-alp', { name: 'Alpine' })],
    ingredients: [
      item('i-1', { name: 'Flour 00', category: 'Flour' }),
      item('i-2', { name: 'Rye', category: ' Flour ' }),
      item('i-3', { name: 'Milk', category: 'Dairy' }),
    ],
    ordersConfig: config,
  });
}

const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });

async function openSettings(source = sourceWith(), options: Parameters<typeof renderSuppliers>[1] = {}) {
  const view = renderSuppliers('/suppliers/settings', { source, session: { location: GB }, ...options });
  const element = await screen.findByRole('region', { name: options.lang === 'it' ? 'Impostazioni' : 'Settings' }, LOAD);
  return { ...view, source, element, region: within(element) };
}

describe('the door and the address', () => {
  it('⚠️ the door is at the foot of the list for whoever runs the place, on every tab', async () => {
    renderSuppliers('/suppliers/suppliers', { source: sourceWith() });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('⚠️ an employee has no door', async () => {
    renderSuppliers('/suppliers/suppliers', { source: sourceWith(), session: EMPLOYEE });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('⚠️ an employee who types the address is sent to the list (replaced), and nothing of the screen is drawn', async () => {
    const { router } = renderSuppliers('/suppliers/settings', { source: sourceWith(), session: EMPLOYEE });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it.each([['a phone', false], ['the split', true]])('opens one level down and FULL WIDTH on %s: nothing is drawn beside it', async (_where, onSplit) => {
    if (onSplit) split();
    const { router, user } = renderSuppliers('/suppliers/suppliers', { source: sourceWith() });
    await screen.findAllByRole('listitem', undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const region = await screen.findByRole('region', { name: 'Settings' }, LOAD);
    expect(router.state.location.pathname).toBe('/suppliers/settings');
    expect(router.state.historyAction).toBe('PUSH');
    expect(region.closest('[data-view]')).toHaveAttribute('data-view', 'wide');
    await waitFor(() => { expect(within(region).getByRole('heading', { level: 2, name: 'Settings' })).toHaveFocus(); });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('Back returns to the list it came from, with the focus on the Settings door', async () => {
    const { router, user } = renderSuppliers('/suppliers/suppliers', { source: sourceWith() });
    await screen.findAllByRole('listitem', undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(within(await screen.findByRole('region', { name: 'Settings' }, LOAD)).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus(); });
  });

  it('opened by its address, Back replaces it with the list', async () => {
    const { region, user, router } = await openSettings();
    await user.click(region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('the ingredient card', () => {
  it('has the two switches, named, with their notes, and no pack-photo switch (that is step 3e-8)', async () => {
    const { region } = await openSettings();
    const card = within(region.getByRole('region', { name: 'The ingredient card' }));
    expect(card.getByRole('switch', { name: 'Track allergens' })).toBeChecked();
    expect(card.getByRole('switch', { name: 'Track nutrition' })).toBeChecked();
    expect(card.getAllByRole('switch')).toHaveLength(2);
    expect(card.getByText(/Off: no allergen boxes on a product/)).toBeInTheDocument();
  });

  it.each([[{ showAllergens: false }, false, true], [{ showNutrition: false }, true, false], [{}, true, true]])(
    'shows what the venue says (%j), and ON when it says nothing',
    async (flags, allergens, nutrition) => {
      const { region } = await openSettings(sourceWith(), { session: { location: { ...GB, ...flags } } });
      expect(region.getByRole('switch', { name: 'Track allergens' }).matches(':checked')).toBe(allergens);
      expect(region.getByRole('switch', { name: 'Track nutrition' }).matches(':checked')).toBe(nutrition);
    },
  );

  it('⚠️ turning allergens OFF asks first, in danger words; Cancel changes and calls nothing', async () => {
    const { region, user, source, store } = await openSettings();
    await user.click(region.getByRole('switch', { name: 'Track allergens' }));
    const dialog = await dialogOf('Turn allergens off?');
    expect(within(dialog).getByText(/all disappear for everybody in this venue/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.panelCalls).toEqual([]);
    expect(store.refreshLocation).not.toHaveBeenCalled();
    expect(region.getByRole('switch', { name: 'Track allergens' })).toBeChecked();
  });

  it('on yes: the function is called with that ONE key, the venue is read again after it, the switch shows it, «Saved ✓» for two seconds', async () => {
    const { region, user, source, store } = await openSettings();
    const order: string[] = [];
    store.refreshLocation.mockImplementation(() => { order.push(`refresh after ${source.panelCalls.length} call`); return Promise.resolve(); });
    await user.click(region.getByRole('switch', { name: 'Track allergens' }));
    await user.click(within(await dialogOf('Turn allergens off?')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => { expect(source.panelCalls).toEqual([{ key: 'showAllergens', on: false }]); });
    await waitFor(() => { expect(store.refreshLocation).toHaveBeenCalledTimes(1); });
    expect(order).toEqual(['refresh after 1 call']);
    // The fake store's refresh changes nothing, as when the server could not be reached: the answer is held here.
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track allergens' })).not.toBeChecked(); });
    const saved = await region.findByText('Saved ✓');
    expect(saved.closest('[role="status"]')).not.toBeNull();
    await waitFor(() => { expect(region.queryByText('Saved ✓')).not.toBeInTheDocument(); }, { timeout: 3500 });
  });

  it('follows the venue once the session shows the new value', async () => {
    const { region, user, store } = await openSettings();
    store.refreshLocation.mockImplementation(() => { store.set({ location: { ...GB, showAllergens: false } }); return Promise.resolve(); });
    await user.click(region.getByRole('switch', { name: 'Track allergens' }));
    await user.click(within(await dialogOf('Turn allergens off?')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track allergens' })).not.toBeChecked(); });
    // And then the session leads again: a venue switched on elsewhere shows as on.
    act(() => { store.set({ location: { ...GB, showAllergens: true } }); });
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track allergens' })).toBeChecked(); });
  });

  it('turning allergens ON asks nothing', async () => {
    const { region, user, source } = await openSettings(sourceWith(), { session: { location: { ...GB, showAllergens: false } } });
    await user.click(region.getByRole('switch', { name: 'Track allergens' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(source.panelCalls).toEqual([{ key: 'showAllergens', on: true }]); });
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track allergens' })).toBeChecked(); });
  });

  it('nutrition never asks, either way', async () => {
    const { region, user, source } = await openSettings();
    await user.click(region.getByRole('switch', { name: 'Track nutrition' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(source.panelCalls).toEqual([{ key: 'showNutrition', on: false }]); });
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track nutrition' })).not.toBeChecked(); });
    await user.click(region.getByRole('switch', { name: 'Track nutrition' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(source.panelCalls).toHaveLength(2); });
    expect(source.panelCalls[1]).toEqual({ key: 'showNutrition', on: true });
  });

  it('⚠️ is disabled while the call runs, holds the app busy, and gets the focus back after', async () => {
    const source = sourceWith();
    const release = source.holdPanel();
    const { region, user } = await openSettings(source);
    await user.click(region.getByRole('switch', { name: 'Track nutrition' }));
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track nutrition' })).toBeDisabled(); });
    expect(isBusy()).toBe(true);
    // A second tap does nothing.
    await user.click(region.getByRole('switch', { name: 'Track nutrition' }));
    expect(source.panelCalls).toHaveLength(1);
    release();
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track nutrition' })).toBeEnabled(); });
    await waitFor(() => { expect(region.getByRole('switch', { name: 'Track nutrition' })).toHaveFocus(); });
    expect(isBusy()).toBe(false);
  });

  it('⚠️ a refusal puts it back, does not read the venue again, and says so in a dialog', async () => {
    const source = sourceWith();
    source.refusePanel = Object.assign(new Error('nope'), { code: 'permission-denied' });
    const { region, user, store } = await openSettings(source);
    await user.click(region.getByRole('switch', { name: 'Track nutrition' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Could not save “Track nutrition”. Check your network and try again.');
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'OK' }));
    expect(region.getByRole('switch', { name: 'Track nutrition' })).toBeChecked();
    expect(region.queryByText('Saved ✓')).not.toBeInTheDocument();
    expect(store.refreshLocation).not.toHaveBeenCalled();
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('is in Italian', async () => {
    const { region } = await openSettings(sourceWith(), { lang: 'it', session: { language: 'it', location: GB } });
    expect(region.getByRole('region', { name: 'La scheda ingrediente' })).toBeInTheDocument();
    expect(region.getByRole('switch', { name: 'Gestisci gli allergeni' })).toBeChecked();
    expect(region.getByRole('switch', { name: 'Gestisci i valori nutrizionali' })).toBeChecked();
  });
});

describe('the categories', () => {
  const card = (region: ReturnType<typeof within>) => within(region.getByRole('region', { name: 'Categories' }));
  const trash = (region: ReturnType<typeof within>, name: string) => card(region).getByRole('button', { name: `Delete category “${name}”` });

  it('lists the venue\'s categories A–Z, each with a low-key bin, and has no add or rename', async () => {
    const { region } = await openSettings();
    const rows = card(region).getAllByRole('listitem').map(row => row.textContent);
    expect(rows).toEqual(['Dairy', 'Eggs', 'Flour']);
    expect(card(region).queryByRole('textbox')).not.toBeInTheDocument();
    expect(card(region).getByText(/Deleting one leaves its ingredients without a category/)).toBeInTheDocument();
    expect(trash(region, 'Eggs')).toBeEnabled();
  });

  it('says so when there are none', async () => {
    const { region } = await openSettings(fakeSuppliersSource({ ordersConfig: { ingredientCategories: [] } }));
    expect(card(region).getByText('No categories yet. Add one from an ingredient’s card.')).toBeInTheDocument();
    expect(card(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('⚠️ EVERY bin is disabled until config/orders has really arrived (the list is only the defaults until then)', async () => {
    const source = sourceWith(null);
    source.fromCache = true;
    const { region } = await openSettings(source);
    const bins = card(region).getAllByRole('button');
    expect(bins.length).toBeGreaterThan(0);
    for (const bin of bins) expect(bin).toBeDisabled();
  });

  it('⚠️ the bins stay disabled while the ingredients come only from the browser’s copy, even with config/orders believed', async () => {
    const source = sourceWith();
    source.fromCache = true;
    const { region } = await openSettings(source);
    // The copy held the document, so config/orders is believed already — but the ingredients it rewrites are not the server's.
    await screen.findByText('Dairy', undefined, LOAD);
    for (const bin of card(region).getAllByRole('button')) expect(bin).toBeDisabled();
  });

  it('enables them once the server has spoken', async () => {
    const source = sourceWith();
    source.fromCache = true;
    const { region } = await openSettings(source);
    await screen.findByText('Dairy', undefined, LOAD);
    expect(trash(region, 'Eggs')).toBeDisabled();
    source.fromCache = false;
    act(() => { source.push(); });
    await waitFor(() => { expect(trash(region, 'Eggs')).toBeEnabled(); });
  });

  it.each([
    ['Eggs', 'Delete “Eggs”?'],
    ['Dairy', 'Delete “Dairy”? 1 ingredient will be left without a category.'],
    ['Flour', 'Delete “Flour”? 2 ingredients will be left without a category.'],
  ])('asks about %s with the count of ingredients that use it (counted after trim)', async (name, sentence) => {
    const { region, user, source } = await openSettings();
    await user.click(trash(region, name));
    const dialog = await dialogOf('Delete this category?');
    expect(within(dialog).getByText(sentence)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.writes).toEqual([]);
  });

  it('on yes writes the shortened list and «no category» on every ingredient that used it, says «Saved ✓» at once and moves the focus to the next bin', async () => {
    const { region, user, source } = await openSettings();
    await user.click(trash(region, 'Dairy'));
    await user.click(within(await dialogOf('Delete this category?')).getByRole('button', { name: 'Delete' }));
    expect(source.writes).toEqual([{ op: 'category', list: ['Eggs', 'Flour'], ids: ['i-3'] }]);
    expect(await card(region).findByText('Saved ✓')).toBeInTheDocument();
    await waitFor(() => { expect(card(region).queryByText('Dairy')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(trash(region, 'Eggs')).toHaveFocus(); });
  });

  it('the last row\'s delete moves the focus to the one before it; the only one left, to the card\'s heading', async () => {
    const { region, user } = await openSettings(fakeSuppliersSource({ ordersConfig: { ingredientCategories: ['Dairy', 'Eggs'] } }));
    await user.click(trash(region, 'Eggs'));
    await user.click(within(await dialogOf('Delete this category?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(trash(region, 'Dairy')).toHaveFocus(); });
    await user.click(trash(region, 'Dairy'));
    await user.click(within(await dialogOf('Delete this category?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(card(region).getByRole('heading', { level: 3, name: 'Categories' })).toHaveFocus(); });
    expect(card(region).getByText('No categories yet. Add one from an ingredient’s card.')).toBeInTheDocument();
  });

  it('puts the category back and says so when the database refuses', async () => {
    const source = sourceWith();
    source.refuseWrites.category = true;
    const { region, user } = await openSettings(source);
    await user.click(trash(region, 'Eggs'));
    await user.click(within(await dialogOf('Delete this category?')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Could not delete the category “Eggs”. Check your network and try again.')).toBeInTheDocument();
    await waitFor(() => { expect(card(region).getByText('Eggs')).toBeInTheDocument(); });
  });

  it('is in Italian, the question with its count', async () => {
    const { region, user } = await openSettings(sourceWith(), { lang: 'it', session: { language: 'it', location: GB } });
    const categories = within(region.getByRole('region', { name: 'Categorie' }));
    await user.click(categories.getByRole('button', { name: 'Elimina categoria «Flour»' }));
    const dialog = await dialogOf('Eliminare la categoria?');
    expect(within(dialog).getByText('Eliminare «Flour»? 2 ingredienti resteranno senza categoria.')).toBeInTheDocument();
  });
});
