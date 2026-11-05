import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», step 3e-2: the ingredient card's doors (a row, «New …», a supplier's screen), what it waits for,
// and how the fields open from what is stored.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills Ltd', shortName: 'Alpine' }),
  supplier('s-zed', { name: 'Zed Dairy' }),
];
const ITEMS = [
  item('i-flour', {
    name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', unit: 'kg',
    invoiceName: 'FARINA 00 25KG',
  }),
  item('i-box', { name: 'Cake box', kind: 'packaging', supplierId: 's-alp' }),
  item('i-odd', { name: 'Odd one', weight: '6x1kg', supplierId: 's-gone', category: 'Weird' }),
  item('i-case', { name: 'Passata', packCount: 4, packUnit: 'bag', unit: 'case', weight: '2.5 kg', category: 'Other' }),
  item('i-carton', { name: 'Old cartons', unit: 'cartone', packUnit: 'busta' }),
];

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: ITEMS });
const main = () => within(screen.getByRole('main'));
const newIngredient = () => main().getByRole('button', { name: 'New ingredient' });
const card = (name: string) => screen.findByRole('region', { name }, LOAD);

async function loaded(path = '/suppliers', source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return { ...view, source };
}

describe('the doors', () => {
  it('a row opens its card, one level below the list, and the title takes the focus', async () => {
    const { user, router } = await loaded();
    await user.click(main().getByRole('button', { name: /^Flour/ }));
    const region = within(await card('Edit ingredient'));
    expect(router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    expect(router.state.historyAction).toBe('PUSH');
    await waitFor(() => { expect(region.getByRole('heading', { level: 2, name: 'Edit ingredient' })).toHaveFocus(); });
  });

  it('a packaging row opens a «Edit packaging» card', async () => {
    const { user } = await loaded('/suppliers/packaging');
    await user.click(main().getByRole('button', { name: /^Cake box/ }));
    expect(await card('Edit packaging')).toBeInTheDocument();
  });

  it('«New ingredient» sits under the search box on the Ingredients tab and opens an empty card', async () => {
    const { user, router } = await loaded();
    await user.click(newIngredient());
    const region = within(await card('New ingredient'));
    expect(router.state.location.pathname).toBe('/suppliers/ingredient/new');
    expect(region.getByRole('textbox', { name: 'Name in the message' })).toHaveValue('');
    expect(region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('no-supplier');
    expect(region.queryByRole('button', { name: 'Delete ingredient' })).not.toBeInTheDocument();
  });

  it('«New packaging» sits on the Packaging tab and opens a «New packaging» card', async () => {
    const { user, router } = await loaded('/suppliers/packaging');
    expect(screen.queryByRole('button', { name: 'New ingredient' })).not.toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'New packaging' }));
    expect(await card('New packaging')).toBeInTheDocument();
    expect(router.state.location.pathname + router.state.location.search).toBe('/suppliers/ingredient/new?kind=packaging');
  });

  it('⚠️ is never hidden on a role: an employee has the doors too', async () => {
    const { user } = await loaded('/suppliers', seeded(), { session: { canManage: false, role: 'staff', isOwner: false } });
    await user.click(newIngredient());
    expect(await card('New ingredient')).toBeInTheDocument();
  });

  it('on a supplier\'s screen the rows of «What they sell» open their card, and «Add ingredient» starts a new one on that supplier', async () => {
    const { user, router } = await loaded('/suppliers/supplier/s-alp');
    const sells = await screen.findByRole('region', { name: /Alpine/ }, LOAD);
    await user.click(within(sells).getByRole('button', { name: /^Flour/ }));
    expect(router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    await card('Edit ingredient');
    // Back lands on the supplier's screen, the row it came from owed the focus.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const again = await screen.findByRole('region', { name: /Alpine/ }, LOAD);
    await waitFor(() => { expect(within(again).getByRole('button', { name: /^Flour/ })).toHaveFocus(); });

    await user.click(within(again).getByRole('button', { name: 'Add ingredient' }));
    const region = within(await card('New ingredient'));
    expect(router.state.location.pathname + router.state.location.search).toBe('/suppliers/ingredient/new?supplier=s-alp');
    expect(region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('s-alp');
    // The list beside it is the Suppliers tab, the supplier's row marked.
    expect(screen.getByRole('tab', { name: 'Suppliers' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const back = await screen.findByRole('region', { name: /Alpine/ }, LOAD);
    await waitFor(() => { expect(within(back).getByRole('button', { name: 'Add ingredient' })).toHaveFocus(); });
  });

  it('⚠️ the preset supplier is for a NEW item: an existing item\'s address with a supplier keeps its own', async () => {
    renderSuppliers('/suppliers/ingredient/i-flour?supplier=s-zed', { source: seeded() });
    const region = within(await card('Edit ingredient'));
    expect(region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('s-alp');
  });

  it('Back from a row\'s card returns to the list with the focus on that row; from «New ingredient», on the button', async () => {
    const { user, router } = await loaded();
    await user.click(main().getByRole('button', { name: /^Flour/ }));
    await card('Edit ingredient');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    await waitFor(() => { expect(main().getByRole('button', { name: /^Flour/ })).toHaveFocus(); });

    await user.click(newIngredient());
    await card('New ingredient');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(newIngredient()).toHaveFocus(); });
  });

  it('opened by its address, Back replaces it with the tab of its kind', async () => {
    const { router, user } = renderSuppliers('/suppliers/ingredient/i-box', { source: seeded() });
    await card('Edit packaging');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/packaging'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('the list beside the card', () => {
  it('is the tab the card was opened from, or the tab of its kind when it was opened by its address', async () => {
    renderSuppliers('/suppliers/ingredient/i-box', { source: seeded() });
    await card('Edit packaging');
    expect(screen.getByRole('tab', { name: 'Packaging' })).toHaveAttribute('aria-selected', 'true');
  });

  it('on the split the card opens in the right-hand pane, the open row marked, and another row replaces it', async () => {
    split();
    const { user, router } = await loaded();
    await user.click(main().getByRole('button', { name: /^Flour/ }));
    await card('Edit ingredient');
    expect(main().getByRole('button', { name: /^Flour/ })).toHaveAttribute('aria-current', 'true');
    const entries = router.state.historyAction;
    // The row already open: nothing happens.
    await user.click(main().getByRole('button', { name: /^Flour/ }));
    expect(router.state.historyAction).toBe(entries);
    // Another row is lateral: it REPLACES the card.
    await user.click(main().getByRole('button', { name: /^Odd one/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/ingredient/i-odd'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(main().getByRole('button', { name: /^Odd one/ })).toHaveAttribute('aria-current', 'true');
    // Back goes one level up, to the list.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
  });

  it('the pane says what to do while nothing is chosen', async () => {
    split();
    await loaded();
    expect(screen.getByText('Choose an ingredient')).toBeInTheDocument();
  });
});

describe('what the card waits for', () => {
  it('⚠️ waits for the server: «Loading…» first, and the card only after 1.2 seconds when only the phone\'s copy has answered', async () => {
    const source = seeded();
    source.fromCache = true;
    renderSuppliers('/suppliers/ingredient/i-flour', { source });
    expect(await screen.findAllByText('Loading…', undefined, LOAD)).not.toHaveLength(0);
    await new Promise<void>(resolve => { setTimeout(resolve, 700); });
    expect(screen.queryByRole('region', { name: 'Edit ingredient' })).not.toBeInTheDocument();
    expect(await card('Edit ingredient')).toBeInTheDocument();
  });

  it('opens at once when the phone is offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const source = seeded();
    source.fromCache = true;
    renderSuppliers('/suppliers/ingredient/i-flour', { source });
    expect(await screen.findByRole('region', { name: 'Edit ingredient' }, { timeout: 800 })).toBeInTheDocument();
  });

  it('says «This ingredient no longer exists.» and leaves for the list when the address names none', async () => {
    const { router } = renderSuppliers('/suppliers/ingredient/nope', { source: seeded() });
    expect(await screen.findByText('This ingredient no longer exists.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('⚠️ does not say it from the phone\'s copy alone', async () => {
    const source = seeded();
    source.fromCache = true;
    const { router } = renderSuppliers('/suppliers/ingredient/nope', { source });
    await screen.findAllByText('Loading…', undefined, LOAD);
    await new Promise<void>(resolve => { setTimeout(resolve, 500); });
    expect(screen.queryByText('This ingredient no longer exists.')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/ingredient/nope');
    expect(await screen.findByText('This ingredient no longer exists.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says the ingredients could not be read, with a Back, when the stream failed', async () => {
    const source = seeded();
    source.refuse.ingredients = true;
    const { router, user } = renderSuppliers('/suppliers/ingredient/i-flour', { source });
    expect(await screen.findAllByText('Could not load the suppliers. Check your connection and try again.', undefined, LOAD)).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
  });
});

describe('the fields open from what is stored', () => {
  const open = async (id: string, name = 'Edit ingredient', options = {}) => {
    const view = renderSuppliers(`/suppliers/ingredient/${id}`, { source: seeded(), ...options });
    return { ...view, region: within(await card(name)) };
  };

  it('every stored value, the invoice name as read-only text', async () => {
    const { region } = await open('i-flour');
    expect(region.getByRole('textbox', { name: 'Name in the message' })).toHaveValue('Flour 00');
    expect(region.getByRole('textbox', { name: 'Name in lists' })).toHaveValue('Flour');
    expect(region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('s-alp');
    expect(region.getByRole('textbox', { name: 'Brand' })).toHaveValue('Caputo');
    expect(region.getByRole('textbox', { name: 'Weight amount' })).toHaveValue('25');
    expect(region.getByRole('combobox', { name: 'Weight unit' })).toHaveValue('kg');
    expect(region.getByRole('combobox', { name: 'Category' })).toHaveValue('Bakery');
    expect(region.getByRole('button', { name: 'Single' })).toHaveAttribute('aria-pressed', 'true');
    expect(region.getByRole('button', { name: 'Case' })).toHaveAttribute('aria-pressed', 'false');
    // Read-only: text, never a box.
    const invoice = region.getByRole('group', { name: 'Name on the invoice' });
    expect(within(invoice).getByText('FARINA 00 25KG')).toBeInTheDocument();
    expect(within(invoice).queryByRole('textbox')).not.toBeInTheDocument();
    expect(region.getAllByRole('textbox').map(box => (box as HTMLInputElement).value)).not.toContain('FARINA 00 25KG');
  });

  it('a card without an invoice name draws no such block', async () => {
    const { region } = await open('i-box', 'Edit packaging');
    expect(region.queryByText('Name on the invoice')).not.toBeInTheDocument();
  });

  it('no price, allergen or nutrition field in this step', async () => {
    const { region } = await open('i-flour');
    expect(region.queryByText(/price/i)).not.toBeInTheDocument();
    expect(region.queryByText(/allergen/i)).not.toBeInTheDocument();
    expect(region.queryByText(/nutrition/i)).not.toBeInTheDocument();
  });

  it('⚠️ a weight the boxes cannot show is «Currently: …» with a Remove button, and a deleted supplier falls to «No supplier»', async () => {
    const { region, user } = await open('i-odd');
    expect(region.getByRole('textbox', { name: 'Weight amount' })).toHaveValue('');
    expect(region.getByText('Currently: “6x1kg”')).toBeInTheDocument();
    expect(region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('no-supplier');
    await user.click(region.getByRole('button', { name: 'Remove the current weight “6x1kg”' }));
    expect(region.queryByText('Currently: “6x1kg”')).not.toBeInTheDocument();
    await waitFor(() => { expect(region.getByRole('textbox', { name: 'Weight amount' })).toHaveFocus(); });
  });

  it('a category the list lacks is added so nothing is lost; the stored «Other» reads as none', async () => {
    const odd = await open('i-odd');
    expect(odd.region.getByRole('combobox', { name: 'Category' })).toHaveValue('Weird');
    expect(within(odd.region.getByRole('combobox', { name: 'Category' })).getByRole('option', { name: 'Weird' })).toBeInTheDocument();
  });

  it('the stored «Other» reads as none', async () => {
    const { region } = await open('i-case');
    expect(region.getByRole('combobox', { name: 'Category' })).toHaveValue('');
  });

  it('offers the venue\'s words for categories and packages: English by default, Italian for an Italian venue, whatever the screen says', async () => {
    const english = await open('i-flour');
    const words = (select: HTMLElement) => within(select).getAllByRole('option').map(option => option.textContent);
    expect(words(english.region.getByRole('combobox', { name: 'Category' }))).toEqual(['— none —', 'Bakery', 'Pastry', 'Retail', 'Weird', '+ New category…']);
  });

  it('Italian venue, English screen: the words are still the venue\'s', async () => {
    const { region } = await open('i-flour', 'Edit ingredient', { session: { location: { country: 'IT' }, language: 'en' } });
    const options = within(region.getByRole('combobox', { name: 'Category' })).getAllByRole('option').map(option => option.textContent);
    expect(options).toEqual(['— none —', 'Bakery', 'Panetteria', 'Pasticceria', 'Vendita', 'Weird', '+ New category…']);
  });

  it('a stored case opens as a Case with its count, its word, and the summary line', async () => {
    const { region } = await open('i-case');
    expect(region.getByRole('button', { name: 'Case' })).toHaveAttribute('aria-pressed', 'true');
    expect(region.getByRole('textbox', { name: 'How many in the case' })).toHaveValue('4');
    expect(region.getByRole('combobox', { name: 'What is inside the case' })).toHaveValue('bag');
    expect(region.getByText('Case of 4 bags of 2.5 kg (10 kg)')).toBeInTheDocument();
  });

  it('a carton word as the unit with a package word opens as a Case with an empty count', async () => {
    const { region } = await open('i-carton');
    expect(region.getByRole('button', { name: 'Case' })).toHaveAttribute('aria-pressed', 'true');
    expect(region.getByRole('textbox', { name: 'How many in the case' })).toHaveValue('');
  });

  it('the summary speaks the screen\'s language but the venue\'s package words', async () => {
    const { region } = await open('i-case', 'Modifica ingrediente', { lang: 'it', session: { language: 'it', location: { country: 'IT' } } });
    // The stored word is «bag»; the plural table is the venue's (Italian), which does not know it: «4 × bag».
    expect(region.getByText('Cartone da 4 × bag da 2,5 kg (10 kg)', { exact: false })).toBeInTheDocument();
    expect(region.getByRole('button', { name: 'Cartone' })).toBeInTheDocument();
  });

  it('Case picks the venue\'s default package word, and Single takes it back', async () => {
    const { region, user } = await open('i-flour');
    await user.click(region.getByRole('button', { name: 'Case' }));
    expect(region.getByRole('combobox', { name: 'What is inside the case' })).toHaveValue('bag');
    await user.click(region.getByRole('button', { name: 'Single' }));
    expect(region.queryByRole('combobox', { name: 'What is inside the case' })).not.toBeInTheDocument();
    await user.click(region.getByRole('button', { name: 'Case' }));
    await user.selectOptions(region.getByRole('combobox', { name: 'What is inside the case' }), 'sack');
    await user.click(region.getByRole('button', { name: 'Single' }));
    await user.click(region.getByRole('button', { name: 'Case' }));
    expect(region.getByRole('combobox', { name: 'What is inside the case' })).toHaveValue('sack');
  });
});
