import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';
import { fakeMergeSource } from './merge/testing/fakeMergeSource';
import type { FakeMergeSource } from './merge/testing/fakeMergeSource';

// «Merge another pack…» (step 3e-7, part 2), through the real screens and the fake sources: the door on the card, the chooser, the
// flow after a tap (parity I117–I130). Invented names and prices only.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;
const NO_FOODCOST = { location: { sections: { foodcost: false } } };

const ALPINE = supplier('s-alp', { name: 'Alpine Mills Ltd' });
const OTHER = supplier('s-oth', { name: 'Other Mill' });
const FLOUR = item('i-flour', { name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp' });
const FLOUR_BIG = item('i-big', { name: 'Flour 00 25kg', supplierId: 's-alp', weight: '25kg' });
const FLOUR_OLD = item('i-old', { name: 'Flour old', supplierId: 's-alp', weight: '1kg', active: false });
const RYE = item('i-rye', { name: 'Rye', supplierId: 's-alp' });
const ELSEWHERE = item('i-else', { name: 'Flour 00 elsewhere', supplierId: 's-oth' });
const BOX = item('i-box', { name: 'Flour box', kind: 'packaging', supplierId: 's-alp' });

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({
  suppliers: [ALPINE, OTHER],
  ingredients: [FLOUR, FLOUR_BIG, FLOUR_OLD, RYE, ELSEWHERE, BOX],
  prices: {
    'i-flour': { priceUnit: 'kg', pricePerUnit: 2 },
    'i-big': { priceUnit: 'kg', pricePerUnit: 1.8 },
  },
});

const CARD = /^(Edit|Modifica) (ingredient|packaging|ingrediente|confezione)$/;
const CHOOSER = /^(Merge another pack|Unisci un’altra confezione)$/;
const DOOR = /^(Merge another pack…|Unisci un’altra confezione…)$/;

async function openCard(path = '/suppliers/ingredient/i-flour', options: Record<string, unknown> = {}, source = seeded()) {
  const merge = fakeMergeSource();
  const view = renderSuppliers(path, { source, ...options, data: { merge: () => merge } });
  const region = within(await screen.findByRole('region', { name: CARD }, LOAD));
  return { ...view, source, merge, region };
}

async function openChooser(options: Record<string, unknown> = {}, source = seeded()) {
  const view = await openCard('/suppliers/ingredient/i-flour', options, source);
  await view.user.click(view.region.getByRole('button', { name: DOOR }));
  const chooser = within(await screen.findByRole('region', { name: CHOOSER }));
  return { ...view, chooser };
}

const rowOf = (chooser: ReturnType<typeof within>, name: RegExp) => chooser.getByRole('button', { name });
const alertOf = (name: RegExp | string) => screen.findByRole('alertdialog', { name });
const methods = (merge: FakeMergeSource) => merge.calls.map(call => call.method);

// The whole flow up to the confirmation: tap B, wait for the question.
async function tapUntilAsked(view: Awaited<ReturnType<typeof openChooser>>, name = /^Flour 00 25kg/) {
  await view.user.click(rowOf(view.chooser, name));
  return alertOf('Merge “Flour 00 25kg” into “Flour”?');
}

describe('the door on the card', () => {
  it('an owner with Food cost on has it on an existing ingredient, above «Not in use at the moment»', async () => {
    const { region } = await openCard();
    const door = region.getByRole('button', { name: 'Merge another pack…' });
    const off = region.getByText('Not in use at the moment');
    expect(door.compareDocumentPosition(off) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('none for packaging, none for a new item', async () => {
    const box = await openCard('/suppliers/ingredient/i-box');
    expect(box.region.queryByRole('button', { name: DOOR })).not.toBeInTheDocument();
    cleanup();
    renderSuppliers('/suppliers/ingredient/new', { source: seeded() });
    const fresh = within(await screen.findByRole('region', { name: 'New ingredient' }, LOAD));
    expect(fresh.queryByRole('button', { name: DOOR })).not.toBeInTheDocument();
  });

  it.each([
    ['an employee', { session: EMPLOYEE }],
    ['a venue with Food cost off', { session: NO_FOODCOST }],
  ])('none for %s', async (_who, options) => {
    const { region } = await openCard('/suppliers/ingredient/i-flour', options);
    expect(region.queryByRole('button', { name: DOOR })).not.toBeInTheDocument();
  });

  it('⚠️ with unsaved edits it says so and goes nowhere (typing is never lost)', async () => {
    const { region, user, router, merge } = await openCard();
    const name = region.getByRole('textbox', { name: 'Name in the message' });
    await user.type(name, 'x');
    await user.click(region.getByRole('button', { name: DOOR }));
    const notice = await alertOf('Save or discard your changes to this ingredient first, then merge.');
    expect(notice).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    expect(merge.calls).toHaveLength(0);
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(name).toHaveValue('Flour 00x');
  });

  it('a clean card opens the chooser one level down, and Back returns to the card', async () => {
    const { region, user, router } = await openCard();
    await user.click(region.getByRole('button', { name: DOOR }));
    const chooser = within(await screen.findByRole('region', { name: CHOOSER }));
    expect(router.state.location.pathname).toBe('/suppliers/ingredient/i-flour/merge');
    expect(chooser.getByRole('heading', { level: 2, name: 'Merge another pack' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await waitFor(() => { expect(chooser.getByRole('heading', { level: 2 })).toHaveFocus(); });
    await user.click(chooser.getByRole('button', { name: 'Back' }));
    await screen.findByRole('region', { name: CARD });
    expect(router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    // ⚠️ The focus is handed back to the door that opened the chooser (P18), not left on the page.
    await waitFor(() => { expect(screen.getByRole('button', { name: DOOR })).toHaveFocus(); });
  });

  it('on the split the list stays on the left while the chooser opens on the right', async () => {
    split();
    const { region, user } = await openCard();
    await user.click(region.getByRole('button', { name: DOOR }));
    await screen.findByRole('region', { name: CHOOSER });
    expect(screen.getByRole('tab', { name: 'Ingredients', selected: true })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Rye/ })).toHaveLength(2);
  });
});

describe('the address', () => {
  it('⚠️ somebody without the right who types it goes to the card (replaced)', async () => {
    const merge = fakeMergeSource();
    const view = renderSuppliers('/suppliers/ingredient/i-flour/merge', { source: seeded(), session: EMPLOYEE, data: { merge: () => merge } });
    await screen.findByRole('region', { name: CARD }, LOAD);
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    expect(view.router.state.historyAction).toBe('REPLACE');
    expect(merge.calls).toHaveLength(0);
  });

  it('`new` is never an id: the address is unknown and goes to the list', async () => {
    const view = renderSuppliers('/suppliers/ingredient/new/merge', { source: seeded() });
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers'); });
  });

  it('an ingredient that no longer exists says so, with Back', async () => {
    renderSuppliers('/suppliers/ingredient/i-nothing/merge', { source: seeded() });
    const region = within(await screen.findByRole('region', { name: CHOOSER }, LOAD));
    expect(await region.findByText('This ingredient no longer exists.', undefined, LOAD)).toBeInTheDocument();
    expect(region.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('⚠️ a packaging item has no chooser: its typed address goes to its card (replaced)', async () => {
    const merge = fakeMergeSource();
    const view = renderSuppliers('/suppliers/ingredient/i-box/merge', { source: seeded(), data: { merge: () => merge } });
    await screen.findByRole('region', { name: CARD }, LOAD);
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-box');
    expect(view.router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: CHOOSER })).not.toBeInTheDocument();
    expect(merge.calls).toHaveLength(0);
  });

  it('Back from a typed address replaces itself with the card', async () => {
    const view = renderSuppliers('/suppliers/ingredient/i-flour/merge', { source: seeded() });
    const chooser = within(await screen.findByRole('region', { name: CHOOSER }, LOAD));
    await view.user.click(chooser.getByRole('button', { name: 'Back' }));
    await screen.findByRole('region', { name: CARD });
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
  });
});

describe('the chooser', () => {
  it('lists only the same supplier’s other ingredients, most alike first, with weight, price and the not-in-use tag', async () => {
    const { chooser } = await openChooser();
    expect(chooser.getByText(/Tap the ingredient that is the same product as “Flour” in another pack\./)).toBeInTheDocument();
    const rows = chooser.getAllByRole('button').filter(button => button.closest('li') !== null);
    expect(rows).toHaveLength(3);
    expect(rows.at(-1)).toHaveTextContent(/^Rye/);
    expect(rowOf(chooser, /^Flour 00 25kg/)).toHaveTextContent(/25kg · .*1\.80.* \/ kg/);
    expect(rowOf(chooser, /^Flour old/)).toHaveTextContent('1kg · Switched off');
    expect(chooser.queryByRole('button', { name: /elsewhere/ })).not.toBeInTheDocument();
    expect(chooser.queryByRole('button', { name: /Flour box/ })).not.toBeInTheDocument();
  });

  it('the search narrows by every word, and both empty states are worded', async () => {
    const { chooser, user } = await openChooser();
    const box = chooser.getByRole('searchbox', { name: 'Search by name' });
    await user.type(box, 'RYE');
    expect(chooser.getAllByRole('button').filter(button => button.closest('li') !== null)).toHaveLength(1);
    await user.clear(box);
    await user.type(box, 'flour kg');
    expect(chooser.getAllByRole('button').filter(button => button.closest('li') !== null)).toHaveLength(1);
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(chooser.getByText('No ingredient matches your search.')).toBeInTheDocument();
  });

  it('a supplier with no other ingredient says so', async () => {
    const source = fakeSuppliersSource({ suppliers: [ALPINE], ingredients: [FLOUR], prices: { 'i-flour': { priceUnit: 'kg', pricePerUnit: 2 } } });
    const { chooser } = await openChooser({}, source);
    expect(chooser.getByText('This supplier has no other ingredients.')).toBeInTheDocument();
  });
});

describe('the flow after a tap', () => {
  it('⚠️ used somewhere: an alert lists the places in order, and nothing else is called', async () => {
    const view = await openChooser();
    view.merge.usage.set('i-big', [
      { kind: 'product', name: 'Loaf' }, { kind: 'recipe', name: 'Bread' }, { kind: 'inventory', month: '2026-10' },
      { kind: 'request' }, { kind: 'draft' },
    ]);
    await view.user.click(rowOf(view.chooser, /^Flour 00 25kg/));
    const notice = await alertOf(/is still used/);
    expect(notice).toHaveTextContent('“Flour 00 25kg” is still used: the product “Loaf”, the recipe “Bread”, the stocktake of October 2026, an open order list, the order in progress. Move those to “Flour” first, then merge. Nothing was changed.');
    expect(methods(view.merge)).toEqual(['checkUsage']);
  });

  it('a failed check says it could not check; offline says it is offline', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await openChooser();
    view.merge.failWith('checkUsage', 'unavailable');
    await view.user.click(rowOf(view.chooser, /^Flour 00 25kg/));
    const first = await alertOf('Could not check where it is used. Try again.');
    await view.user.click(within(first).getByRole('button', { name: 'OK' }));
    view.merge.failWith('checkUsage', 'offline');
    await view.user.click(rowOf(view.chooser, /^Flour 00 25kg/));
    expect(await alertOf('You are offline. Connect and try again: nothing was changed.')).toBeInTheDocument();
    expect(methods(view.merge).filter(method => method !== 'checkUsage')).toEqual([]);
  });

  it('the confirmation counts what moves, in the singular too', async () => {
    const view = await openChooser();
    view.merge.preview = { ...view.merge.preview, counts: { prices: 1, codes: 1, droppedCodes: 0 } };
    const dialog = await tapUntilAsked(view);
    expect(dialog).toHaveTextContent('1 price and 1 invoice code of “Flour 00 25kg” move to “Flour”. “Flour 00 25kg” is deleted. This cannot be undone.');
    expect(within(dialog).getByRole('button', { name: 'Merge' })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('remembers 20 codes');
  });

  it('it also says the dropped codes, the takeover and the price changes', async () => {
    const view = await openChooser();
    view.merge.preview = {
      counts: { prices: 3, codes: 2, droppedCodes: 2 }, takeover: true, bLostPrice: null, hasChanges: true,
      aPrice: { priceUnit: 'kg', pricePerUnit: 2 }, bPrice: { priceUnit: 'kg', pricePerUnit: 1.8 },
    };
    const dialog = await tapUntilAsked(view);
    expect(dialog).toHaveTextContent('3 prices and 2 invoice codes of “Flour 00 25kg” move to “Flour”.');
    expect(dialog).toHaveTextContent('An ingredient remembers 20 codes at most: 2 codes are left out.');
    expect(dialog).toHaveTextContent(/The current price of “Flour” becomes the one of “Flour 00 25kg” \(.*1\.80.* \/ kg\)\./);
    expect(dialog).toHaveTextContent('The price changes of “Flour 00 25kg” are worked out again at the next import.');
    expect(dialog).not.toHaveTextContent('is not kept');
  });

  it.each([
    ['history', 'is not kept: it stays in the history.'],
    ['lost', 'is not kept and is not in the history: it will be lost.'],
  ] as const)('a price that is not kept (%s) is said, and only that line', async (kind, words) => {
    const view = await openChooser();
    view.merge.preview = { ...view.merge.preview, bLostPrice: kind, bPrice: { priceUnit: 'kg', pricePerUnit: 1.8 } };
    const dialog = await tapUntilAsked(view);
    expect(dialog).toHaveTextContent(words);
    expect(dialog).not.toHaveTextContent('becomes the one of');
  });

  it('⚠️ Cancel writes nothing and stays on the chooser', async () => {
    const view = await openChooser();
    const dialog = await tapUntilAsked(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(methods(view.merge)).toEqual(['checkUsage', 'previewMerge']);
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour/merge');
  });

  it('a preview that fails is worded, and nothing is merged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await openChooser();
    view.merge.failWith('previewMerge', 'gone');
    await view.user.click(rowOf(view.chooser, /^Flour 00 25kg/));
    expect(await alertOf('One of the two ingredients no longer exists. Nothing was changed.')).toBeInTheDocument();
    expect(methods(view.merge)).toEqual(['checkUsage', 'previewMerge']);
  });

  it('⚠️ while it writes: rows and Back are off, «Merging…» is said, nothing can leave, a second tap does nothing', async () => {
    const view = await openChooser();
    const release = view.merge.hold('mergeIngredients');
    const dialog = await tapUntilAsked(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => { expect(view.chooser.getByRole('status')).toHaveTextContent('Merging…'); });
    expect(rowOf(view.chooser, /^Rye/)).toBeDisabled();
    expect(view.chooser.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(isBusy()).toBe(true);
    await view.user.click(rowOf(view.chooser, /^Rye/));
    await act(async () => { await view.router.navigate('/suppliers'); });
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour/merge');
    expect(methods(view.merge)).toEqual(['checkUsage', 'previewMerge', 'mergeIngredients']);
    release();
    await screen.findByRole('region', { name: CARD });
    expect(isBusy()).toBe(false);
  });

  it('a success from the card goes BACK onto it (no extra entry), says «Merged ✓» and focuses the door', async () => {
    const view = await openChooser();
    const dialog = await tapUntilAsked(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await screen.findByRole('region', { name: CARD });
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    expect(view.router.state.historyAction).toBe('POP');
    expect(await screen.findByText('Merged ✓')).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('button', { name: DOOR })).toHaveFocus(); });
    expect(view.merge.calls.at(-1)).toEqual({ method: 'mergeIngredients', args: ['i-flour', 'i-big'] });
  });

  it('a success from a typed address replaces the chooser with the card (nothing is underneath)', async () => {
    const merge = fakeMergeSource();
    const view = renderSuppliers('/suppliers/ingredient/i-flour/merge', { source: seeded(), data: { merge: () => merge } });
    const chooser = within(await screen.findByRole('region', { name: CHOOSER }, LOAD));
    await view.user.click(rowOf(chooser, /^Flour 00 25kg/));
    const dialog = await alertOf('Merge “Flour 00 25kg” into “Flour”?');
    await view.user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await screen.findByRole('region', { name: CARD });
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    expect(view.router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('Merged ✓')).toBeInTheDocument();
  });

  describe('Back after a merge', () => {
    async function mergeFrom(view: { user: ReturnType<typeof renderSuppliers>['user'] }) {
      await view.user.click(within(await screen.findByRole('region', { name: CARD })).getByRole('button', { name: DOOR }));
      const chooser = within(await screen.findByRole('region', { name: CHOOSER }));
      await view.user.click(rowOf(chooser, /^Flour 00 25kg/));
      const dialog = await alertOf('Merge “Flour 00 25kg” into “Flour”?');
      await view.user.click(within(dialog).getByRole('button', { name: 'Merge' }));
      await screen.findByText('Merged ✓');
      await screen.findByRole('region', { name: CARD });
    }

    it('⚠️ opened from the list: one Back lands on the list', async () => {
      const merge = fakeMergeSource();
      const view = renderSuppliers('/suppliers', { source: seeded(), data: { merge: () => merge } });
      const list = await screen.findByRole('button', { name: /^Flour(?! )/ }, LOAD);
      await view.user.click(list);
      await mergeFrom(view);
      await view.user.click(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers'); });
    });

    it('⚠️ opened from a supplier’s screen: Back lands on that supplier’s screen', async () => {
      const merge = fakeMergeSource();
      const view = renderSuppliers('/suppliers/supplier/s-alp', { source: seeded(), data: { merge: () => merge } });
      const sells = await screen.findByRole('region', { name: /Alpine/ }, LOAD);
      await view.user.click(within(sells).getByRole('button', { name: /^Flour(?! )/ }));
      await mergeFrom(view);
      await view.user.click(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers/supplier/s-alp'); });
    });
  });

  it('⚠️ while it writes, A leaving the list does not unmount the screen: «Merging…» and the blocker stay', async () => {
    const view = await openChooser();
    const release = view.merge.hold('mergeIngredients');
    const dialog = await tapUntilAsked(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => { expect(view.chooser.getByRole('status')).toHaveTextContent('Merging…'); });
    await act(async () => {
      view.source.ingredients.delete('i-flour');
      view.source.push();
    });
    expect(screen.getByRole('region', { name: CHOOSER })).toBeInTheDocument();
    expect(screen.queryByText('This ingredient no longer exists.')).not.toBeInTheDocument();
    expect(view.chooser.getByRole('status')).toHaveTextContent('Merging…');
    release();
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it.each([
    ['gone', { committed: false }, 'One of the two ingredients no longer exists. Nothing was changed.'],
    ['unavailable', { committed: true }, 'The merge stopped half way: the prices already copied are safe. Tap “Merge” again with the same two ingredients to finish.'],
    ['offline', { committed: false }, 'You are offline. Connect and try again: nothing was changed.'],
    ['unavailable', { committed: false }, 'Could not merge. Nothing is lost: try again and it will finish.'],
  ])('a write that stops (%s, committed %o) says the honest words and stays', async (code, options, words) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await openChooser();
    view.merge.failWith('mergeIngredients', code, options);
    const dialog = await tapUntilAsked(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    const notice = await alertOf(words);
    await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour/merge');
    expect(rowOf(view.chooser, /^Rye/)).toBeEnabled();
    expect(view.chooser.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(isBusy()).toBe(false);
  });

  it('B found used right before the write says where, from the stop itself', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await openChooser();
    view.merge.failWith('mergeIngredients', 'used', { used: [{ kind: 'recipe', name: 'Bread' }] });
    const dialog = await tapUntilAsked(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(await alertOf(/is still used/)).toHaveTextContent('“Flour 00 25kg” is still used: the recipe “Bread”. Move those to “Flour” first, then merge. Nothing was changed.');
  });
});

describe('in Italian', () => {
  it('the door, the chooser, the places and the confirmation speak Italian', async () => {
    const view = await openCard('/suppliers/ingredient/i-flour', { lang: 'it' });
    await view.user.click(view.region.getByRole('button', { name: 'Unisci un’altra confezione…' }));
    const chooser = within(await screen.findByRole('region', { name: 'Unisci un’altra confezione' }));
    expect(chooser.getByText(/Tocca l’ingrediente che è lo stesso prodotto di «Flour» in un’altra confezione\./)).toBeInTheDocument();
    expect(chooser.getByRole('searchbox', { name: 'Cerca per nome' })).toBeInTheDocument();
    expect(rowOf(chooser, /^Flour old/)).toHaveTextContent('Disattivato');
    view.merge.usage.set('i-big', [{ kind: 'inventory', month: '2026-10' }, { kind: 'product', name: 'Pane' }]);
    await view.user.click(rowOf(chooser, /^Flour 00 25kg/));
    expect(await alertOf(/è ancora usato/)).toHaveTextContent('«Flour 00 25kg» è ancora usato: l’inventario di ottobre 2026, il prodotto «Pane». Spostali prima su «Flour», poi unisci. Non è cambiato nulla.');
    view.merge.usage.clear();
    await view.user.click(screen.getByRole('button', { name: 'OK' }));
    await view.user.click(rowOf(chooser, /^Flour 00 25kg/));
    const dialog = await alertOf('Unire «Flour 00 25kg» a «Flour»?');
    expect(dialog).toHaveTextContent('2 prezzi e 1 codice fattura di «Flour 00 25kg» passano a «Flour». «Flour 00 25kg» viene eliminato. Non si può annullare.');
    await view.user.click(within(dialog).getByRole('button', { name: 'Unisci' }));
    expect(await screen.findByText('Unito ✓')).toBeInTheDocument();
  });
});
