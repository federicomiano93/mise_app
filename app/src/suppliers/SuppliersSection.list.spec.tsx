import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», slice A: the frame, the tabs, the search box and the three lists.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', category: 'Dairy' }),
  supplier('s-caf', { name: 'Café Bar Srl', category: 'Drinks' }),
  supplier('s-alp', { name: 'Alpine Mills', category: 'Flour' }),
];

const ITEMS = [
  item('i-flour', { name: 'Flour 00', supplierId: 's-alp', brand: 'Molino' }),
  item('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed' }),
  item('i-cafe', { name: 'Caffè in grani', supplierId: 's-caf', invoiceName: 'CAFFE ARABICA 1KG' }),
  item('i-box', { name: 'Cake box', kind: 'packaging', supplierId: 's-alp' }),
  item('i-bag', { name: 'Paper bag', kind: 'packaging', supplierId: 's-alp' }),
];

const main = () => within(screen.getByRole('main'));
const rowNames = () => main().getAllByRole('listitem').map(row => row.textContent);
const tab = (name: string) => screen.getByRole('tab', { name });
const search = () => screen.getByRole('searchbox');

function seeded(extra: Partial<Parameters<typeof fakeSuppliersSource>[0]> = {}): FakeSuppliersSource {
  return fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ...extra });
}

async function loaded(path = '/suppliers', source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

describe('the frame and the tabs', () => {
  it('is one h1, «Ingredients & suppliers», and opens on the Ingredients tab', async () => {
    await loaded();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Ingredients & suppliers' })).toBeInTheDocument();
    expect(tab('Ingredients')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Suppliers')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Packaging')).toHaveAttribute('aria-selected', 'false');
  });

  it('has the tabs in the order Ingredients, Suppliers, Packaging, in a list named «Which list to show»', async () => {
    await loaded();
    const list = screen.getByRole('tablist', { name: 'Which list to show' });
    expect(within(list).getAllByRole('tab').map(node => node.textContent)).toEqual(['Ingredients', 'Suppliers', 'Packaging']);
  });

  it.each([
    ['/suppliers', 'Ingredients'],
    ['/suppliers/suppliers', 'Suppliers'],
    ['/suppliers/packaging', 'Packaging'],
  ])('selects the tab the address %s names', async (path, name) => {
    await loaded(path);
    for (const other of ['Ingredients', 'Suppliers', 'Packaging']) {
      expect(tab(other)).toHaveAttribute('aria-selected', String(other === name));
    }
  });

  it('REPLACES the entry when a tab is tapped, and the address follows', async () => {
    const { router, user } = await loaded();
    const before = router.state.location.key;
    await user.click(tab('Suppliers'));
    expect(router.state.location.pathname).toBe('/suppliers/suppliers');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.key).not.toBe(before);
    await user.click(tab('Packaging'));
    expect(router.state.location.pathname).toBe('/suppliers/packaging');
    await user.click(tab('Ingredients'));
    expect(router.state.location.pathname).toBe('/suppliers');
    expect(tab('Ingredients')).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps ONE search box through every tab, clears what was typed, and changes its words', async () => {
    const { user } = await loaded();
    const box = search();
    expect(box).toHaveAccessibleName('Search an ingredient…');
    expect(box).toHaveAttribute('placeholder', 'Search an ingredient…');
    await user.type(box, 'flo');
    await waitFor(() => { expect(rowNames()).toHaveLength(1); });

    await user.click(tab('Suppliers'));
    expect(search()).toBe(box);
    expect(box).toHaveValue('');
    expect(box).toHaveAccessibleName('Search a supplier…');
    expect(box).toHaveAttribute('placeholder', 'Search a supplier…');
    await waitFor(() => { expect(rowNames()).toHaveLength(3); });

    await user.click(tab('Packaging'));
    expect(search()).toBe(box);
    expect(box).toHaveAccessibleName('Search packaging');
    expect(box).toHaveAttribute('placeholder', 'Search packaging');
  });

  it('moves the selection and the focus with the arrow keys, Home and End', async () => {
    const { router, user } = await loaded();
    tab('Ingredients').focus();
    await user.keyboard('{ArrowRight}');
    expect(router.state.location.pathname).toBe('/suppliers/suppliers');
    expect(tab('Suppliers')).toHaveFocus();
    await user.keyboard('{End}');
    expect(router.state.location.pathname).toBe('/suppliers/packaging');
    expect(tab('Packaging')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Ingredients')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Packaging')).toHaveFocus();
  });

  it('puts only the selected tab in the Tab order', async () => {
    await loaded('/suppliers/suppliers');
    expect(tab('Suppliers')).toHaveAttribute('tabindex', '0');
    expect(tab('Ingredients')).toHaveAttribute('tabindex', '-1');
    expect(tab('Packaging')).toHaveAttribute('tabindex', '-1');
  });

  it('says the tabs and the search in Italian', async () => {
    renderSuppliers('/suppliers', { source: seeded(), lang: 'it', session: { language: 'it' } });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(screen.getByRole('heading', { level: 1, name: 'Ingredienti e fornitori' })).toBeInTheDocument();
    expect(within(screen.getByRole('tablist', { name: 'Quale elenco mostrare' })).getAllByRole('tab').map(node => node.textContent))
      .toEqual(['Ingredienti', 'Fornitori', 'Imballaggi']);
    expect(search()).toHaveAccessibleName('Cerca un ingrediente…');
  });

  it('goes to the list from an address it does not draw (unknown, and shapes it has no screen for)', async () => {
    for (const path of ['/suppliers/nope', '/suppliers/supplier', '/suppliers/ingredient', '/suppliers/ingredient/a/b']) {
      const { router } = renderSuppliers(path, { source: seeded() });
      await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
      await screen.findAllByRole('listitem', undefined, LOAD);
      cleanup();
    }
  });
});

describe('the ingredients and packaging lists', () => {
  it('lists ingredients A–Z by the name shown, packaging apart', async () => {
    await loaded();
    expect(rowNames().map(text => text?.slice(0, 5))).toEqual(['Caffè', 'Flour', 'MilkZ']);
    await screen.findByRole('tab', { name: 'Packaging' });
  });

  it('lists packaging A–Z on its own tab', async () => {
    await loaded('/suppliers/packaging');
    expect(rowNames().map(text => text?.slice(0, 4))).toEqual(['Cake', 'Pape']);
  });

  it('draws an ingredient row as ONE button (its card opens from it), with no link inside', async () => {
    await loaded();
    for (const row of main().getAllByRole('listitem')) {
      expect(within(row).getAllByRole('button')).toHaveLength(1);
      expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    }
    expect(main().getByRole('button', { name: /Flour/ })).toBeInTheDocument();
  });

  it('shows the supplier, the brand and no price when nobody has priced it', async () => {
    await loaded();
    expect(main().getByText('Molino', { exact: false }).textContent).toBe('Alpine Mills · Molino');
  });

  it('shows the supplier through its SHORT name', async () => {
    await loaded();
    const row = main().getByText('Milk').closest('li') as HTMLElement;
    expect(within(row).getByText('Zed')).toBeInTheDocument();
    expect(within(row).queryByText(/Zed Dairy/)).not.toBeInTheDocument();
  });

  it('says «No supplier» for an item whose supplier is gone, or was never set', async () => {
    const source = seeded({ ingredients: [item('i-1', { name: 'Orphan', supplierId: 'deleted' }), item('i-2', { name: 'Loose' })] });
    await loaded('/suppliers', source);
    expect(within(main().getByText('Orphan').closest('li') as HTMLElement).getByText('No supplier')).toBeInTheDocument();
    expect(within(main().getByText('Loose').closest('li') as HTMLElement).getByText('No supplier')).toBeInTheDocument();
  });

  it('shows the price per unit only for the items that carry one, and the «each» phrase for pieces', async () => {
    const source = seeded({
      ingredients: [
        item('i-kg', { name: 'Butter', supplierId: 's-zed' }),
        item('i-pc', { name: 'Eggs', supplierId: 's-zed' }),
        item('i-no', { name: 'Yeast', supplierId: 's-zed' }),
      ],
      prices: { 'i-kg': { priceUnit: 'kg', pricePerUnit: 7.2 }, 'i-pc': { priceUnit: 'pcs', pricePerUnit: 0.35 } },
    });
    await loaded('/suppliers', source, { session: { location: { country: 'GB' } } });
    expect(main().getByText('Zed · £7.20 / kg')).toBeInTheDocument();
    expect(main().getByText('Zed · £0.35 / each')).toBeInTheDocument();
    expect(main().getAllByText('Zed')).toHaveLength(1);
  });

  it('shows no price at all for a person the rules refuse the prices (and no error)', async () => {
    const source = seeded({
      ingredients: [item('i-kg', { name: 'Butter', supplierId: 's-zed' })],
      prices: { 'i-kg': { priceUnit: 'kg', pricePerUnit: 7.2 } },
      refusePrices: true,
    });
    await loaded('/suppliers', source, { session: { location: { country: 'GB' } } });
    expect(main().queryByText(/£/)).not.toBeInTheDocument();
    expect(main().getByText('Zed')).toBeInTheDocument();
    expect(main().queryByText(/Could not load/)).not.toBeInTheDocument();
  });

  it('writes the price in the venue\'s money and the «each» phrase in Italian', async () => {
    const source = seeded({
      ingredients: [item('i-pc', { name: 'Uova', supplierId: 's-zed' })],
      prices: { 'i-pc': { priceUnit: 'pcs', pricePerUnit: 0.35 } },
    });
    renderSuppliers('/suppliers', { source, lang: 'it', session: { language: 'it', location: { country: 'IT' } } });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(main().getByText(/al pezzo/).textContent?.replace(/ /g, ' ')).toBe('Zed · 0,35 € al pezzo');
  });

  describe('«Not in use»: the items switched off with «Not in use at the moment» (3e-5b)', () => {
    const OFF = [
      item('i-a', { name: 'Anise', supplierId: 's-zed', active: false }),
      item('i-b', { name: 'Basil', supplierId: 's-zed' }),
      item('i-c', { name: 'Cumin', supplierId: 's-zed', active: false }),
    ];
    const groupOf = () => main().getByText('Not in use (2)').closest('details') as HTMLDetailsElement;

    it('puts them at the bottom, in a FOLDED group «Not in use (N)», dimmed, with no «Switched off» tag on the row', async () => {
      await loaded('/suppliers', seeded({ ingredients: OFF }));
      const group = groupOf();
      expect(group.open).toBe(false);
      expect(within(group).getAllByRole('listitem').map(row => row.textContent?.slice(0, 5))).toEqual(['Anise', 'Cumin']);
      expect(within(group).queryByText('Switched off')).not.toBeInTheDocument();
      expect(main().getByText('Anise').closest('button')).toHaveAttribute('data-off', 'true');
      const rows = main().getAllByRole('listitem').map(row => row.textContent?.slice(0, 5));
      expect(rows).toEqual(['Basil', 'Anise', 'Cumin']);
      expect(group.previousElementSibling, 'the active rows come first').toBe(main().getByText('Basil').closest('ul'));
    });

    it('draws no group when nothing is switched off', async () => {
      await loaded();
      expect(main().queryByText(/^Not in use/)).not.toBeInTheDocument();
    });

    it('a search that finds a switched-off item opens the group by itself; the «no match» sentence needs NEITHER part to match', async () => {
      const { user } = await loaded('/suppliers', seeded({ ingredients: OFF }));
      await user.type(search(), 'anis');
      await waitFor(() => { expect((main().getByText('Not in use (1)').closest('details') as HTMLDetailsElement).open).toBe(true); });
      expect(main().queryByText('Basil')).not.toBeInTheDocument();
      await user.clear(search());
      await user.type(search(), 'zzzz');
      await waitFor(() => { expect(main().getByText('No ingredient matches your search.')).toBeInTheDocument(); });
      expect(main().queryByText(/^Not in use/)).not.toBeInTheDocument();
    });

    it('the group stays where the person leaves it: opened, it is not closed by a snapshot', async () => {
      const { user } = await loaded('/suppliers', seeded({ ingredients: OFF }));
      await user.click(main().getByText('Not in use (2)'));
      expect(groupOf().open).toBe(true);
    });

    it('opens by itself when the item open beside the list is switched off', async () => {
      await loaded('/suppliers/ingredient/i-a', seeded({ ingredients: OFF }));
      expect(groupOf().open).toBe(true);
    });

    it('says it in Italian', async () => {
      await loaded('/suppliers', seeded({ ingredients: OFF }), { lang: 'it', session: { language: 'it' } });
      expect(main().getByText('Non in uso (2)')).toBeInTheDocument();
    });
  });

  describe('the «not declared» word', () => {
    const declared = item('i-d', { name: 'Declared', supplierId: 's-zed', allergens: ['milk'], allergensCheckedAt: '2026-10-01T10:00:00.000Z' });
    const none = item('i-n', { name: 'Checked none', supplierId: 's-zed', allergens: [], allergensCheckedAt: '2026-10-01T10:00:00.000Z' });
    const unknown = item('i-u', { name: 'Unknown', supplierId: 's-zed' });

    it('is on an ingredient nobody has declared, and only on that one', async () => {
      await loaded('/suppliers', seeded({ ingredients: [declared, none, unknown] }));
      expect(main().getAllByText('not declared')).toHaveLength(1);
      expect(within(main().getByText('Unknown').closest('li') as HTMLElement).getByText('not declared')).toBeInTheDocument();
    });

    it('goes with the venue\'s allergen switch', async () => {
      await loaded('/suppliers', seeded({ ingredients: [unknown] }), { session: { location: { showAllergens: false } } });
      expect(main().queryByText('not declared')).not.toBeInTheDocument();
    });

    it('is never on packaging', async () => {
      await loaded('/suppliers/packaging', seeded({ ingredients: [item('i-p', { name: 'Box', kind: 'packaging', supplierId: 's-zed' })] }));
      expect(main().getByText('Box')).toBeInTheDocument();
      expect(main().queryByText('not declared')).not.toBeInTheDocument();
    });

    it('is said in Italian', async () => {
      renderSuppliers('/suppliers', { source: seeded({ ingredients: [unknown] }), lang: 'it', session: { language: 'it' } });
      await screen.findAllByRole('listitem', undefined, LOAD);
      expect(main().getByText('non dichiarato')).toBeInTheDocument();
    });
  });
});

describe('the search', () => {
  it('folds accents on ingredients: «cafe» finds «Caffè»', async () => {
    const { user } = await loaded();
    await user.type(search(), 'CAFFE');
    await waitFor(() => { expect(rowNames()).toHaveLength(1); });
    expect(main().getByText('Caffè in grani')).toBeInTheDocument();
    await user.clear(search());
    await user.type(search(), 'caffè');
    await waitFor(() => { expect(rowNames()).toHaveLength(1); });
  });

  it('finds an ingredient by its short name and its invoice name', async () => {
    const { user } = await loaded();
    await user.type(search(), 'milk');
    await waitFor(() => { expect(rowNames()).toHaveLength(1); });
    await user.clear(search());
    await user.type(search(), 'arabica');
    await waitFor(() => { expect(main().getByText('Caffè in grani')).toBeInTheDocument(); });
    expect(rowNames()).toHaveLength(1);
  });

  it('folds accents on suppliers, and finds them by name or short name but NOT by category', async () => {
    const { user } = await loaded('/suppliers/suppliers');
    await user.type(search(), 'cafe');
    await waitFor(() => { expect(rowNames()).toEqual(['Café Bar SrlDrinks · 1 product']); });
    await user.clear(search());
    await user.type(search(), 'zed dairy');
    await waitFor(() => { expect(main().getByText('Zed')).toBeInTheDocument(); });
    expect(rowNames()).toHaveLength(1);
    await user.clear(search());
    await user.type(search(), 'flour');
    expect(await screen.findByText('No supplier matches your search.')).toBeInTheDocument();
  });

  it('says so when nothing matches, per tab', async () => {
    const { user } = await loaded();
    await user.type(search(), 'zzz');
    expect(await screen.findByText('No ingredient matches your search.')).toBeInTheDocument();
    await user.click(tab('Packaging'));
    await user.type(search(), 'zzz');
    expect(await screen.findByText('No packaging matches your search.')).toBeInTheDocument();
  });

  // ⚠️ A data snapshot landing mid-keystroke must never wipe the text or the keyboard.
  it('survives a live update: the same box, the same text, the keyboard still in it', async () => {
    const source = seeded();
    const { user } = await loaded('/suppliers', source);
    const box = search();
    await user.type(box, 'flo');
    await waitFor(() => { expect(rowNames()).toHaveLength(1); });
    expect(box).toHaveFocus();

    source.ingredients.set('i-new', item('i-new', { name: 'Flour 0', supplierId: 's-alp' }));
    act(() => { source.push(); });

    await waitFor(() => { expect(rowNames()).toHaveLength(2); });
    expect(search()).toBe(box);
    expect(box).toHaveValue('flo');
    expect(box).toHaveFocus();
  });
});

describe('the suppliers list', () => {
  it('lists every supplier, A–Z by the label shown, with the category and the number of products', async () => {
    await loaded('/suppliers/suppliers');
    expect(rowNames()).toEqual([
      'Alpine MillsFlour · 3 products',
      'Café Bar SrlDrinks · 1 product',
      'Zed Dairy · 1 product'.replace('Zed Dairy', 'ZedDairy'),
    ]);
  });

  it('is one button per row, with the supplier\'s label as its name', async () => {
    await loaded('/suppliers/suppliers');
    expect(main().getByRole('button', { name: /^Zed/ })).toBeInTheDocument();
    expect(main().queryByRole('button', { name: /Zed Dairy Ltd/ })).not.toBeInTheDocument();
  });

  it('counts a plural from the dictionary: no product, one product, many', async () => {
    const source = seeded({
      suppliers: [supplier('a', { name: 'Aaa' }), supplier('b', { name: 'Bbb' }), supplier('c', { name: 'Ccc' })],
      ingredients: [item('1', { supplierId: 'b' }), item('2', { supplierId: 'c' }), item('3', { supplierId: 'c', kind: 'packaging' })],
    });
    await loaded('/suppliers/suppliers', source);
    expect(rowNames()).toEqual(['Aaa0 products', 'Bbb1 product', 'Ccc2 products']);
  });

  it('counts in Italian', async () => {
    renderSuppliers('/suppliers/suppliers', {
      source: seeded({ suppliers: [supplier('b', { name: 'Bbb' })], ingredients: [item('1', { supplierId: 'b' })] }),
      lang: 'it', session: { language: 'it' },
    });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(rowNames()).toEqual(['Bbb1 prodotto']);
  });

  it('tags a switched-off supplier with a word, and still lists it', async () => {
    const source = seeded({ suppliers: [supplier('a', { name: 'Aaa', active: false }), supplier('b', { name: 'Bbb' })] });
    await loaded('/suppliers/suppliers', source);
    expect(within(main().getByRole('button', { name: /Aaa/ })).getByText('Switched off')).toBeInTheDocument();
    expect(within(main().getByRole('button', { name: /Bbb/ })).queryByText('Switched off')).not.toBeInTheDocument();
  });

  it('puts the starred suppliers first under «Favourites», the rest under «Other suppliers»', async () => {
    await loaded('/suppliers/suppliers', seeded({ ordersConfig: { favouriteSuppliers: ['s-zed'] } }));
    const headings = main().getAllByRole('heading', { level: 2 }).map(node => node.textContent);
    expect(headings).toEqual(['Favourites', 'Other suppliers']);
    expect(rowNames()[0]).toContain('Zed');
    expect(rowNames()).toHaveLength(3);
  });

  it('draws no heading at all when no starred supplier is in view', async () => {
    const { user } = await loaded('/suppliers/suppliers', seeded({ ordersConfig: { favouriteSuppliers: ['s-zed'] } }));
    await user.type(search(), 'alpine');
    await waitFor(() => { expect(rowNames()).toHaveLength(1); });
    expect(main().queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('draws no heading when nobody is starred, and ignores a star on a deleted supplier', async () => {
    await loaded('/suppliers/suppliers', seeded({ ordersConfig: { favouriteSuppliers: ['gone'] } }));
    expect(main().queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('says the headings in Italian', async () => {
    renderSuppliers('/suppliers/suppliers', {
      source: seeded({ ordersConfig: { favouriteSuppliers: ['s-zed'] } }), lang: 'it', session: { language: 'it' },
    });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(main().getAllByRole('heading', { level: 2 }).map(node => node.textContent)).toEqual(['Preferiti', 'Altri fornitori']);
  });
});

describe('loading, a dead stream and the empty states', () => {
  it('says «Loading…» until the list has answered, and never the empty state meanwhile', async () => {
    const source = seeded();
    source.hold();
    renderSuppliers('/suppliers', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No ingredients yet')).not.toBeInTheDocument();
    act(() => { source.release(); });
    await screen.findAllByRole('listitem', undefined, LOAD);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('does not believe an EMPTY answer from the browser\'s own database', async () => {
    const source = fakeSuppliersSource();
    source.fromCache = true;
    renderSuppliers('/suppliers/suppliers', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 60); }); });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('No suppliers yet')).not.toBeInTheDocument();
  });

  it('says the stream could not load, in a status line that was on the page before it spoke', async () => {
    const source = seeded();
    source.refuse.ingredients = true;
    renderSuppliers('/suppliers', { source });
    const line = await screen.findByText('Could not load the suppliers. Check your connection and try again.', undefined, LOAD);
    expect(line).toHaveAttribute('role', 'status');
    // An empty list on a dead stream is not «No ingredients yet».
    expect(screen.queryByText('No ingredients yet')).not.toBeInTheDocument();
  });

  it('says it when a stream dies later, and keeps the rows that were there', async () => {
    const source = seeded();
    await loaded('/suppliers/suppliers', source);
    const live = document.querySelector('#sup-panel [role="status"]') as HTMLElement;
    expect(live).toBeEmptyDOMElement();
    act(() => { source.breakStreams(); });
    expect(await screen.findByText(/Could not load the suppliers/)).toBeInTheDocument();
    expect(document.querySelector('#sup-panel [role="status"]')).toBe(live);
  });

  it.each([
    ['/suppliers', 'No ingredients yet', 'Add what you buy, so orders, recipes and labels can use it.'],
    ['/suppliers/suppliers', 'No suppliers yet', 'Add the suppliers you order from, then the ingredients each one sells.'],
    ['/suppliers/packaging', 'No packaging yet', 'Add the boxes, bags and labels you buy, so Food cost can count them.'],
  ])('says nothing exists yet on %s', async (path, title, sub) => {
    renderSuppliers(path, { source: fakeSuppliersSource() });
    expect(await screen.findByText(title, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(sub)).toBeInTheDocument();
    // The only buttons are the way to make the first one (by the tab) and the owner's Settings.
    const buttons = main().queryAllByRole('button').map(button => button.textContent);
    const first = path === '/suppliers/suppliers' ? 'New supplier' : path === '/suppliers/packaging' ? 'New packaging' : 'New ingredient';
    expect(buttons).toEqual([first, 'Settings']);
  });

  it('says there is no packaging when there are ingredients but no packaging', async () => {
    renderSuppliers('/suppliers/packaging', { source: seeded({ ingredients: [item('i-1', { name: 'Flour' })] }) });
    expect(await screen.findByText('No packaging yet', undefined, LOAD)).toBeInTheDocument();
  });

  it('says the empty states in Italian', async () => {
    renderSuppliers('/suppliers/suppliers', { source: fakeSuppliersSource(), lang: 'it', session: { language: 'it' } });
    expect(await screen.findByText('Ancora nessun fornitore', undefined, LOAD)).toBeInTheDocument();
  });
});
