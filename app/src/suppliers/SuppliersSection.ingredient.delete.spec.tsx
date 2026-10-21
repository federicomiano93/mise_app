import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», step 3e-2: deleting an ingredient — the count first (his decision F5), the three sentences, the
// busy bin, the order line, and the way out.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills Ltd', shortName: 'Alpine' })];
const FLOUR = item('i-flour', { name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp' });

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({
  suppliers: SUPPLIERS,
  ingredients: [FLOUR, item('i-rye', { name: 'Rye', supplierId: 's-alp' })],
  prices: { 'i-flour': { priceUnit: 'kg', pricePerUnit: 2 } },
});
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });
const main = () => within(screen.getByRole('main'));
const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;

async function open(source = seeded(), options = {}, path = '/suppliers/ingredient/i-flour') {
  const view = renderSuppliers(path, { source, ...options });
  const region = within(await screen.findByRole('region', { name: /^(Edit|Modifica) ingredient[e]?$/ }, LOAD));
  return { ...view, source, region };
}
const bin = (region: ReturnType<typeof within>) => region.getByRole('button', { name: 'Delete ingredient' });

describe('who sees the bin', () => {
  it('an owner or manager does, on an existing item only; an employee does not', async () => {
    const owner = await open();
    expect(bin(owner.region)).toBeInTheDocument();
  });

  it('⚠️ an employee has no bin at all (absent, not disabled)', async () => {
    const { region } = await open(seeded(), { session: EMPLOYEE });
    expect(region.queryByRole('button', { name: 'Delete ingredient' })).not.toBeInTheDocument();
  });

  it('a new item has none', async () => {
    renderSuppliers('/suppliers/ingredient/new', { source: seeded() });
    const region = within(await screen.findByRole('region', { name: 'New ingredient' }, LOAD));
    expect(region.queryByRole('button', { name: 'Delete ingredient' })).not.toBeInTheDocument();
  });
});

describe('the question carries what the item is used in', () => {
  it('both counts zero: nothing uses it', async () => {
    const { region, user, source } = await open();
    source.usage = { recipes: 0, products: 0 };
    await user.click(bin(region));
    const dialog = await dialogOf('Delete “Flour”?');
    expect(within(dialog).getByText('This cannot be undone. No recipe and no Food cost product uses it. Past orders still show it.')).toBeInTheDocument();
    expect(source.usageCalls).toEqual(['i-flour']);
  });

  it('used: the numbers, one and many', async () => {
    const { region, user, source } = await open();
    source.usage = { recipes: 1, products: 3 };
    await user.click(bin(region));
    const dialog = await dialogOf('Delete “Flour”?');
    expect(within(dialog).getByText(
      'This cannot be undone. It is used in 1 recipe and 3 Food cost products: there it will appear as a missing ingredient, and the labels of those recipes stay blocked until you replace it. Past orders still show it.',
    )).toBeInTheDocument();
  });

  it('used by products only: «0 recipes»', async () => {
    const { region, user, source } = await open();
    source.usage = { recipes: 0, products: 1 };
    await user.click(bin(region));
    const dialog = await dialogOf('Delete “Flour”?');
    expect(within(dialog).getByText(/It is used in 0 recipes and 1 Food cost product:/)).toBeInTheDocument();
  });

  it('⚠️ either count unknown: the current app\'s sentence, with no numbers — never a false «no recipe»', async () => {
    const { region, user, source } = await open();
    source.usage = { recipes: null, products: 2 };
    await user.click(bin(region));
    const dialog = await dialogOf('Delete “Flour”?');
    expect(within(dialog).getByText(
      'This cannot be undone. Past orders still show it; in recipes and food cost it will appear as a missing ingredient, and the labels of those recipes stay blocked until you replace it.',
    )).toBeInTheDocument();
    expect(within(dialog).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    const { region, user, source } = await open(seeded(), { lang: 'it', session: { language: 'it' } }, '/suppliers/ingredient/i-flour');
    void region;
    source.usage = { recipes: 1, products: 2 };
    await user.click(screen.getByRole('button', { name: 'Elimina ingrediente' }));
    const dialog = await dialogOf('Eliminare «Flour»?');
    expect(within(dialog).getByText(
      'Non si può annullare. È usato in 1 ricetta e in 2 prodotti di Food cost: lì comparirà come ingrediente mancante, e le etichette di quelle ricette restano bloccate finché non lo sostituisci. Gli ordini passati continuano a mostrarlo.',
    )).toBeInTheDocument();
  });
});

describe('the busy bin', () => {
  it('is disabled and busy while the count runs, and a second tap does nothing', async () => {
    const { region, user, source } = await open();
    const release = source.holdUsage();
    await user.click(bin(region));
    await waitFor(() => { expect(bin(region)).toBeDisabled(); });
    expect(bin(region)).toHaveAttribute('aria-busy', 'true');
    await act(async () => { bin(region).click(); });
    expect(source.usageCalls).toEqual(['i-flour']);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    release();
    const dialog = await dialogOf('Delete “Flour”?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(bin(region)).not.toBeDisabled(); });
  });
});

describe('answering', () => {
  it('Cancel deletes nothing', async () => {
    const { region, user, source } = await open();
    await user.click(bin(region));
    await user.click(within(await dialogOf('Delete “Flour”?')).getByRole('button', { name: 'Cancel' }));
    expect(source.writes).toEqual([]);
    expect(source.ingredients.has('i-flour')).toBe(true);
  });

  it('Delete removes the item and its price (a price writer), clears its order line, leaves for the list, says it once and focuses the search box', async () => {
    const source = seeded();
    source.draft = { 'i-flour': { qty: 2 }, 'i-rye': { qty: 1 } };
    // A price writer: the role AND the Food cost section.
    const { region, user, router } = await open(source, { session: { location: { sections: { foodcost: true } } } });
    await user.click(bin(region));
    await user.click(within(await dialogOf('Delete “Flour”?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(await screen.findByText('Ingredient deleted.')).toBeInTheDocument();
    expect(screen.queryByText('This ingredient no longer exists.')).not.toBeInTheDocument();
    await waitFor(() => { expect(source.writes.some(write => write.op === 'draft-clear')).toBe(true); });
    expect(source.writes).toContainEqual({ op: 'ingredient-delete', id: 'i-flour', withPrice: true });
    expect(source.prices.has('i-flour')).toBe(false);
    expect(source.draft).toEqual({ 'i-rye': { qty: 1 } });
    await waitFor(() => { expect(main().getByRole('searchbox')).toHaveFocus(); });
    expect(main().queryByRole('button', { name: /^Flour/ })).not.toBeInTheDocument();
  });

  it('⚠️ the price document stays when the venue has Food cost off, whatever the role', async () => {
    const { region, user, source } = await open(seeded(), { session: { location: { sections: { foodcost: false } } } });
    await user.click(bin(region));
    await user.click(within(await dialogOf('Delete “Flour”?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(source.writes.some(write => write.op === 'ingredient-delete')).toBe(true); });
    expect(source.writes).toContainEqual({ op: 'ingredient-delete', id: 'i-flour', withPrice: false });
    expect(source.prices.has('i-flour')).toBe(true);
  });

  it('leaves without asking about unsaved typing: the delete was the answer', async () => {
    const { region, user, router } = await open();
    await user.type(region.getByRole('textbox', { name: 'Brand' }), 'X');
    await user.click(bin(region));
    await user.click(within(await dialogOf('Delete “Flour”?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a refused delete brings the item back and says so', async () => {
    const source = seeded();
    source.refuseWrites.ingredientDelete = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { region, user } = await open(source);
    await user.click(bin(region));
    await user.click(within(await dialogOf('Delete “Flour”?')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Could not delete “Flour”. Check your network and try again.')).toBeInTheDocument();
    await waitFor(() => { expect(source.ingredients.has('i-flour')).toBe(true); });
  });

  it('opened from a supplier\'s screen, the delete goes back to that screen', async () => {
    const view = renderSuppliers('/suppliers/supplier/s-alp', { source: seeded() });
    const sells = await screen.findByRole('region', { name: /Alpine/ }, LOAD);
    await view.user.click(within(sells).getByRole('button', { name: /^Flour/ }));
    const region = within(await screen.findByRole('region', { name: 'Edit ingredient' }, LOAD));
    await view.user.click(bin(region));
    await view.user.click(within(await dialogOf('Delete “Flour”?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers/supplier/s-alp'); });
    const back = await screen.findByRole('region', { name: /Alpine/ }, LOAD);
    await waitFor(() => { expect(within(back).getByRole('button', { name: 'Add ingredient' })).toHaveFocus(); });
  });
});
