import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», slice B: switching a supplier off and on, and deleting it — who may, what is asked, what is
// said, and where the screen goes.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills Ltd', shortName: 'Alpine' }),
  supplier('s-zed', { name: 'Zed Dairy' }),
  supplier('s-off', { name: 'Old Baker', active: false }),
];

const productsOf = (supplierId: string, n: number) => Array.from({ length: n }, (_, index) => item(`${supplierId}-${index}`, { supplierId }));

const seeded = (alpine = 3): FakeSuppliersSource => fakeSuppliersSource({
  suppliers: SUPPLIERS,
  ingredients: [...productsOf('s-alp', alpine), ...productsOf('s-zed', 1)],
});
const main = () => within(screen.getByRole('main'));
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });
const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;

async function open(name: string, source = seeded(), options: Parameters<typeof renderSuppliers>[1] = {}) {
  const view = renderSuppliers('/suppliers/suppliers', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  await view.user.click(main().getByRole('button', { name: new RegExp(`^${name}`) }));
  const region = within(await screen.findByRole('region', { name: new RegExp(`^${name}`) }, LOAD));
  return { ...view, source, region };
}

const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};

function countSaid(text: string) {
  let count = 0;
  const watcher = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.textContent === text) count += 1;
  });
  watcher.observe(document.body, { childList: true, subtree: true });
  return { count: () => count, stop: () => { watcher.disconnect(); } };
}

describe('switching a supplier off and on', () => {
  it('switching OFF asks first, and Cancel changes nothing', async () => {
    const { region, user, source } = await open('Alpine');
    await user.click(region.getByRole('button', { name: 'Switch off' }));
    const dialog = await dialogOf('Switch this supplier off?');
    expect(within(dialog).getByText('Switch off “Alpine”? It will be hidden from the order screen. You can switch it on again later.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.writes).toEqual([]);
    expect(region.getByRole('button', { name: 'Switch off' })).toBeInTheDocument();
  });

  it('on yes writes `active: false` at once and the button becomes «Switch on»', async () => {
    const { region, user, source } = await open('Alpine');
    await user.click(region.getByRole('button', { name: 'Switch off' }));
    await user.click(within(await dialogOf('Switch this supplier off?')).getByRole('button', { name: 'Switch off' }));
    expect(source.writes).toEqual([{ op: 'active', id: 's-alp', active: false }]);
    expect(await region.findByRole('button', { name: 'Switch on' })).toBeInTheDocument();
  });

  it('switching ON asks nothing', async () => {
    const { region, user, source } = await open('Old Baker');
    await user.click(region.getByRole('button', { name: 'Switch on' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.writes).toEqual([{ op: 'active', id: 's-off', active: true }]);
    expect(await region.findByRole('button', { name: 'Switch off' })).toBeInTheDocument();
  });

  it('⚠️ is for everybody: an employee has it too', async () => {
    const { region, user, source } = await open('Alpine', seeded(), { session: EMPLOYEE });
    expect(region.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    await user.click(region.getByRole('button', { name: 'Switch off' }));
    await user.click(within(await dialogOf('Switch this supplier off?')).getByRole('button', { name: 'Switch off' }));
    expect(source.writes).toEqual([{ op: 'active', id: 's-alp', active: false }]);
  });

  it('is worded in Italian, buttons and question', async () => {
    const { user } = renderSuppliers('/suppliers/supplier/s-alp', { source: seeded(), lang: 'it', session: { language: 'it' } });
    const region = within(await screen.findByRole('region', { name: 'Alpine' }, LOAD));
    await user.click(region.getByRole('button', { name: 'Disattiva' }));
    const dialog = await dialogOf('Disattivare questo fornitore?');
    expect(within(dialog).getByText('Disattivare «Alpine»? Sparirà dalla schermata degli ordini. Puoi riattivarlo quando vuoi.')).toBeInTheDocument();
  });

  it('puts it back and says so when the database refuses', async () => {
    const source = seeded();
    source.refuseWrites.active = true;
    const { region, user } = await open('Old Baker', source);
    await user.click(region.getByRole('button', { name: 'Switch on' }));
    await says('Could not switch “Old Baker” off or on. Check your network and try again.');
    expect(await region.findByRole('button', { name: 'Switch on' })).toBeInTheDocument();
  });
});

describe('deleting a supplier', () => {
  const trash = (region: ReturnType<typeof within>, name: string) => region.getByRole('button', { name: `Delete “${name}”` });

  it('⚠️ is for whoever runs the place only: an employee has no trash, the owner and a manager do', async () => {
    const { region } = await open('Alpine', seeded(), { session: EMPLOYEE });
    expect(region.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it('a manager has it', async () => {
    const { region } = await open('Alpine', seeded(), { session: { role: 'manager', canManage: true, isOwner: false } });
    expect(trash(region, 'Alpine')).toBeInTheDocument();
  });

  it('is a small low-key icon at the end of the page, named for the supplier', async () => {
    const { region } = await open('Alpine');
    const button = trash(region, 'Alpine');
    expect(button.textContent).toBe('');
    expect(button).toHaveAttribute('title', 'Delete “Alpine”');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('asks «Permanently delete…» as a danger question, and Cancel deletes nothing', async () => {
    const { region, user, source, router } = await open('Zed');
    await user.click(trash(region, 'Zed Dairy'));
    const dialog = await dialogOf('Delete this supplier?');
    expect(within(dialog).getByText('Permanently delete “Zed Dairy”? This cannot be undone.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.writes).toEqual([]);
    expect(router.state.location.pathname).toBe('/suppliers/supplier/s-zed');
  });

  it.each([
    [0, null],
    [1, 'Its one product stays in the list, with no supplier.'],
    [3, 'Its 3 products stay in the list, with no supplier.'],
  ])('⚠️ his decision F2: with %i products the question says what becomes of them', async (count, sentence) => {
    const source = fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: productsOf('s-alp', count) });
    const { region, user } = await open('Alpine', source);
    await user.click(trash(region, 'Alpine'));
    const dialog = await dialogOf('Delete this supplier?');
    if (sentence === null) {
      expect(within(dialog).queryByText(/stay in the list|stays in the list/)).not.toBeInTheDocument();
    } else {
      expect(within(dialog).getByText(sentence)).toBeInTheDocument();
    }
  });

  it.each([
    [1, 'Il suo prodotto resta nell’elenco, senza fornitore.'],
    [3, 'I suoi 3 prodotti restano nell’elenco, senza fornitore.'],
  ])('says F2 in Italian with %i products', async (count, sentence) => {
    const source = fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: productsOf('s-alp', count) });
    const { user } = renderSuppliers('/suppliers/supplier/s-alp', { source, lang: 'it', session: { language: 'it' } });
    const region = within(await screen.findByRole('region', { name: 'Alpine' }, LOAD));
    await user.click(region.getByRole('button', { name: 'Elimina «Alpine»' }));
    const dialog = await dialogOf('Eliminare questo fornitore?');
    expect(within(dialog).getByText('Eliminare «Alpine» per sempre? Non si può annullare.')).toBeInTheDocument();
    expect(within(dialog).getByText(sentence)).toBeInTheDocument();
  });

  it('on yes: deletes ONLY the supplier, leaves for the list, says «Supplier deleted.» once and never «no longer exists»', async () => {
    const { region, user, source, router } = await open('Zed');
    const said = countSaid('Supplier deleted.');
    try {
      await user.click(trash(region, 'Zed Dairy'));
      await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
      await says('Supplier deleted.');
      expect(source.writes).toEqual([{ op: 'delete', id: 's-zed' }]);
      await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
      expect(main().queryByRole('button', { name: /^Zed/ })).not.toBeInTheDocument();
      // The products stay: nothing but the supplier was written.
      expect(source.ingredients.size).toBe(4);
      // The row that opened it is gone, so the focus goes to the search box.
      await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
      await new Promise<void>(resolve => { setTimeout(resolve, 80); });
      expect(said.count()).toBe(1);
      expect(screen.queryByText('This supplier no longer exists.')).not.toBeInTheDocument();
    } finally {
      said.stop();
    }
  });

  it('on the split the same: the pane empties, the list stays, and nobody says «no longer exists»', async () => {
    split();
    const { region, user, router } = await open('Zed');
    await user.click(trash(region, 'Zed Dairy'));
    await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    await new Promise<void>(resolve => { setTimeout(resolve, 80); });
    expect(screen.queryByText('This supplier no longer exists.')).not.toBeInTheDocument();
    expect(screen.getByText('Choose a supplier')).toBeInTheDocument();
  });

  // ⚠️ WITH THE REAL DATABASE THE ROW IS STILL IN THE LIST while the screen leaves (the fake drops it only on settleDeletes):
  // the focus must go to the search box and stay there, never to the deleted supplier's own row, which then disappears.
  it('⚠️ the focus lands on the search box after a delete, even while the deleted row is still listed (phone)', async () => {
    const source = seeded();
    source.deferDeletes = true;
    const { region, user, router } = await open('Zed', source);
    await user.click(trash(region, 'Zed Dairy'));
    await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
    expect(main().getByRole('button', { name: /^Zed/ })).not.toHaveFocus();
    act(() => { source.settleDeletes(); });
    await waitFor(() => { expect(main().queryByRole('button', { name: /^Zed/ })).not.toBeInTheDocument(); });
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('⚠️ the same on the split', async () => {
    split();
    const source = seeded();
    source.deferDeletes = true;
    const { region, user, router } = await open('Zed', source);
    await user.click(trash(region, 'Zed Dairy'));
    await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
    expect(main().getByRole('button', { name: /^Zed/ })).not.toHaveFocus();
    act(() => { source.settleDeletes(); });
    await waitFor(() => { expect(main().queryByRole('button', { name: /^Zed/ })).not.toBeInTheDocument(); });
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('⚠️ the trash waits for the ingredients: before they answer the count of products would be a false 0', async () => {
    const source = fakeSuppliersSource({ suppliers: SUPPLIERS });
    source.fromCache = true;
    renderSuppliers('/suppliers/supplier/s-zed', { source });
    const region = within(await screen.findByRole('region', { name: 'Zed Dairy' }, LOAD));
    expect(region.getByRole('button', { name: 'Delete “Zed Dairy”' })).toBeDisabled();
    source.ingredients.set('i-z', item('i-z', { supplierId: 's-zed' }));
    source.fromCache = false;
    act(() => { source.push(); });
    await waitFor(() => { expect(region.getByRole('button', { name: 'Delete “Zed Dairy”' })).toBeEnabled(); });
  });

  it('a supplier opened by its address is replaced by the list', async () => {
    const { user, router } = renderSuppliers('/suppliers/supplier/s-zed', { source: seeded() });
    const region = within(await screen.findByRole('region', { name: 'Zed Dairy' }, LOAD));
    await user.click(region.getByRole('button', { name: 'Delete “Zed Dairy”' }));
    await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('holds the app busy until the database answers', async () => {
    const source = seeded();
    const release = source.holdWrites();
    const { region, user } = await open('Zed', source);
    await user.click(trash(region, 'Zed Dairy'));
    await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(isBusy()).toBe(true); });
    release();
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('when the database refuses, the supplier is back in the list and the refusal is said', async () => {
    const source = seeded();
    source.refuseWrites.delete = true;
    const { region, user } = await open('Zed', source);
    await user.click(trash(region, 'Zed Dairy'));
    await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
    await says('Could not delete “Zed Dairy”. Check your network and try again.');
    expect(await main().findByRole('button', { name: /^Zed/ })).toBeInTheDocument();
  });

  it('a supplier deleted on another phone IS still news afterwards: a refused delete here unmarks it', async () => {
    const source = seeded();
    source.refuseWrites.delete = true;
    const { region, user, router } = await open('Zed', source);
    await user.click(trash(region, 'Zed Dairy'));
    await user.click(within(await dialogOf('Delete this supplier?')).getByRole('button', { name: 'Delete' }));
    source.refuseWrites.delete = false;
    await says('Could not delete “Zed Dairy”. Check your network and try again.');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    await main().findByRole('button', { name: /^Zed/ });
    // Open it again, and let another phone delete it.
    await act(async () => { await router.navigate('/suppliers/supplier/s-zed'); });
    await screen.findByRole('region', { name: 'Zed Dairy' }, LOAD);
    source.suppliers.delete('s-zed');
    act(() => { source.push(); });
    expect(await screen.findByText('This supplier no longer exists.')).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
  });
});

describe('a supplier the phone\'s copy does not know', () => {
  it('⚠️ is not called gone from the copy alone: the supplier screen waits for the server (or 1.2 s)', async () => {
    const source = seeded();
    source.fromCache = true;
    const { router } = renderSuppliers('/suppliers/supplier/nope', { source });
    await screen.findAllByText('Loading…', undefined, LOAD).catch(() => undefined);
    await new Promise<void>(resolve => { setTimeout(resolve, 600); });
    expect(screen.queryByText('This supplier no longer exists.')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/supplier/nope');
    expect(await screen.findByText('This supplier no longer exists.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
  });
});
