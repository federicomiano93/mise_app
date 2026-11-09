import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», slice B: a NEW supplier — the button, the card, the one rule, the question, the payload, and
// the way out.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills Ltd', shortName: 'Alpine', category: 'Flour' }),
  supplier('s-zed', { name: 'Zed Dairy' }),
];

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [item('i-1', { supplierId: 's-alp' })] });
const main = () => within(screen.getByRole('main'));
const newButton = () => main().getByRole('button', { name: 'New supplier' });
const card = () => screen.findByRole('region', { name: 'New supplier' }, LOAD);
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });
const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;

async function loaded(path = '/suppliers/suppliers', source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return { ...view, source };
}

async function openCard(options = {}) {
  const view = await loaded('/suppliers/suppliers', seeded(), options);
  await view.user.click(newButton());
  const element = await card();
  return { ...view, element, region: within(element) };
}

const nameBox = (region: ReturnType<typeof within>) => region.getByRole('textbox', { name: 'Name on invoices' });

describe('the «New supplier» button', () => {
  it('is on the Suppliers tab', async () => {
    await loaded('/suppliers/suppliers');
    expect(newButton()).toBeInTheDocument();
  });

  it.each(['/suppliers', '/suppliers/packaging'])('is not on the other tabs (%s): each has its own «New …» button', async path => {
    renderSuppliers(path, { source: seeded() });
    await screen.findByRole('searchbox', undefined, LOAD);
    expect(screen.queryByRole('button', { name: 'New supplier' })).not.toBeInTheDocument();
  });

  it('⚠️ is never hidden on a role: an employee has it too', async () => {
    await loaded('/suppliers/suppliers', seeded(), { session: EMPLOYEE });
    expect(newButton()).toBeInTheDocument();
  });

  it('stands over «No suppliers yet» too, the way to the first one', async () => {
    renderSuppliers('/suppliers/suppliers', { source: fakeSuppliersSource() });
    await screen.findByText('No suppliers yet', undefined, LOAD);
    expect(newButton()).toBeInTheDocument();
  });

  it('opens the empty card as a new entry, with the focus on its title', async () => {
    const { router, user } = await loaded();
    const before = router.state.location.key;
    await user.click(newButton());
    const region = await card();
    expect(router.state.location.pathname).toBe('/suppliers/supplier/new');
    expect(router.state.historyAction).toBe('PUSH');
    expect(router.state.location.key).not.toBe(before);
    await waitFor(() => { expect(within(region).getByRole('heading', { level: 2, name: 'New supplier' })).toHaveFocus(); });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('is marked as the screen shown while the card is open beside the list', async () => {
    split();
    const { user } = await loaded();
    await user.click(newButton());
    await card();
    expect(newButton()).toHaveAttribute('aria-current', 'true');
  });
});

describe('the card of a new supplier', () => {
  it('has the fields of the current app in its order, empty, with its hints and placeholders', async () => {
    const { region, element } = await openCard();
    const labels = [...element.querySelectorAll('label, legend')].map(node => node.textContent);
    expect(labels).toEqual([
      'Name on invoices', 'Name in lists', 'Category',
      'Delivery days — when they deliver', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
      'Order days — when you place the order', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
      'Phone (WhatsApp, digits only)', 'Email', 'VAT number',
    ]);
    expect(nameBox(region)).toHaveValue('');
    expect(nameBox(region)).toHaveAttribute('aria-required', 'true');
    const short = region.getByRole('textbox', { name: 'Name in lists' });
    expect(short).toHaveAttribute('maxlength', '60');
    expect(short).toHaveAccessibleDescription('Optional — shorter, for the app’s lists and the order heading. Empty: the name on invoices.');
    expect(region.getByRole('textbox', { name: 'Category' })).toBeInTheDocument();
    const phone = region.getByLabelText('Phone (WhatsApp, digits only)');
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('placeholder', 'e.g. 447700900123');
    expect(region.getByLabelText('Email')).toHaveAttribute('type', 'email');
    const vat = region.getByLabelText('VAT number');
    expect(vat).toHaveAttribute('maxlength', '30');
    expect(vat).toHaveAttribute('autocomplete', 'off');
    expect(vat).toHaveAttribute('placeholder', 'IT01234567890');
    for (const box of region.getAllByRole('checkbox')) expect(box).not.toBeChecked();
  });

  it('is in Italian with its labels, «P.IVA» and the Italian phone example', async () => {
    renderSuppliers('/suppliers/supplier/new', { source: seeded(), lang: 'it', session: { language: 'it' } });
    const region = within(await screen.findByRole('region', { name: 'Nuovo fornitore' }, LOAD));
    expect(region.getByLabelText('Nome in fattura')).toBeInTheDocument();
    expect(region.getByLabelText('P.IVA')).toBeInTheDocument();
    expect(region.getByLabelText('Telefono (WhatsApp, solo cifre)')).toHaveAttribute('placeholder', 'es. 393331234567');
    expect(region.getByRole('group', { name: 'Giorni di consegna — quando consegnano' })).toBeInTheDocument();
    expect(region.getAllByText('lun')).toHaveLength(2);
  });

  it('⚠️ a blank name is no save: the box is marked and focused, a sentence stands under it, and nothing is asked or written', async () => {
    const { region, user, source } = await openCard();
    await user.type(nameBox(region), '   ');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(nameBox(region)).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => { expect(nameBox(region)).toHaveFocus(); });
    const sentence = region.getByText('Enter the supplier’s name.');
    expect(sentence.closest('[role="status"]')).not.toBeNull();
    expect(nameBox(region)).toHaveAccessibleDescription('Enter the supplier’s name.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.writes).toEqual([]);

    // Typing a name takes the mark and the sentence away.
    await user.type(nameBox(region), 'Rossi');
    expect(nameBox(region)).not.toHaveAttribute('aria-invalid');
    expect(region.queryByText('Enter the supplier’s name.')).not.toBeInTheDocument();
  });

  it('asks «Save “name”?» first; Cancel writes nothing and stays', async () => {
    const { region, user, source, router } = await openCard();
    await user.type(nameBox(region), '  Rossi Foods ');
    await user.click(region.getByRole('button', { name: 'Save' }));
    const dialog = await dialogOf('Save supplier?');
    expect(within(dialog).getByText('Save “Rossi Foods”?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.writes).toEqual([]);
    expect(router.state.location.pathname).toBe('/suppliers/supplier/new');
  });

  it('⚠️ saves EXACTLY the current app\'s payload: trimmed, the short name as an empty string, English weekdays in week order, the VAT in its canonical form, active true', async () => {
    const { region, user, source } = await openCard();
    await user.type(nameBox(region), '  Rossi Foods ');
    await user.type(region.getByRole('textbox', { name: 'Name in lists' }), '   ');
    await user.type(region.getByRole('textbox', { name: 'Category' }), ' Flour ');
    const delivery = within(region.getByRole('group', { name: 'Delivery days — when they deliver' }));
    // Ticked out of order on purpose: they are saved in the order of the week.
    await user.click(delivery.getByRole('checkbox', { name: 'Fri' }));
    await user.click(delivery.getByRole('checkbox', { name: 'Mon' }));
    await user.click(delivery.getByRole('checkbox', { name: 'Sun' }));
    await user.click(delivery.getByRole('checkbox', { name: 'Sun' }));
    const order = within(region.getByRole('group', { name: 'Order days — when you place the order' }));
    await user.click(order.getByRole('checkbox', { name: 'Sun' }));
    await user.click(order.getByRole('checkbox', { name: 'Wed' }));
    await user.type(region.getByLabelText('Phone (WhatsApp, digits only)'), ' 447700900123 ');
    await user.type(region.getByLabelText('Email'), ' orders@rossi.test ');
    await user.type(region.getByLabelText('VAT number'), '01234567890');

    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    const write = source.writes[0];
    expect(write).toEqual({
      op: 'save',
      id: expect.stringMatching(/^new-supplier-/),
      data: {
        name: 'Rossi Foods',
        shortName: '',
        category: 'Flour',
        phone: '447700900123',
        email: 'orders@rossi.test',
        deliveryDays: ['Monday', 'Friday'],
        orderDays: ['Wednesday', 'Sunday'],
        active: true,
        vatNumber: 'IT01234567890',
      },
    });
  });

  it('keeps a foreign VAT number as typed, in capitals, and an empty one as an empty string', async () => {
    const { region, user, source } = await openCard();
    await user.type(nameBox(region), 'Dubois');
    await user.type(region.getByLabelText('VAT number'), 'fr 12 345.678');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toMatchObject({ data: { vatNumber: 'FR12345678', phone: '', email: '', category: '' } });
  });

  it('goes back to the Suppliers list, the new supplier in it, the button owed the focus, and says it was saved', async () => {
    const { region, user, router, source } = await openCard();
    await user.type(nameBox(region), 'Rossi Foods');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(await screen.findByText('Supplier saved.')).toBeInTheDocument();
    expect(await main().findByRole('button', { name: /^Rossi Foods/ })).toBeInTheDocument();
    await waitFor(() => { expect(newButton()).toHaveFocus(); });
    expect(source.suppliers.size).toBe(3);
    // Back from the list leaves the section: the card is not an entry to come back to.
    expect(screen.queryByRole('region', { name: 'New supplier' })).not.toBeInTheDocument();
  });

  it('ignores a second tap on Save while the question is open', async () => {
    const { region, user, source } = await openCard();
    await user.type(nameBox(region), 'Rossi Foods');
    const save = region.getByRole('button', { name: 'Save' });
    await user.click(save);
    await dialogOf('Save supplier?');
    // The dialog covers the page: the second tap is made on the button itself, as a fast thumb would.
    await act(async () => { save.click(); });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
  });

  it('saves while the network is away: the supplier is on screen at once and the write waits', async () => {
    const source = seeded();
    const release = source.holdWrites();
    const { region, user, router } = await openCard({ source });
    await user.type(nameBox(region), 'Rossi Foods');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    // Not released yet: the card has already gone and the supplier is in the list.
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(await main().findByRole('button', { name: /^Rossi Foods/ })).toBeInTheDocument();
    expect(isBusy()).toBe(true);
    release();
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });
});

describe('leaving a new supplier\'s card', () => {
  it('with nothing typed leaves in silence, to the list, the button owed the focus', async () => {
    const { region, user, router } = await openCard();
    await user.click(region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(newButton()).toHaveFocus(); });
  });

  it('with something typed asks «Discard changes?»: Cancel stays, Discard leaves and writes nothing', async () => {
    const { region, user, router, source } = await openCard();
    await user.type(nameBox(region), 'Rossi');
    await user.click(region.getByRole('button', { name: 'Back' }));
    const dialog = await dialogOf('Discard changes?');
    expect(within(dialog).getByText(/What you typed on this card is not saved/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/suppliers/supplier/new');
    expect(nameBox(region)).toHaveValue('Rossi');

    await user.click(region.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(source.writes).toEqual([]);
  });

  it('asks on the browser\'s Back and on the rail too', async () => {
    const { region, user, router } = await openCard();
    await user.type(nameBox(region), 'Rossi');
    act(() => { void router.navigate(-1); });
    await user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/suppliers/supplier/new');

    await user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Recipes' }));
    expect(await dialogOf('Discard changes?')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/suppliers/supplier/new');
  });

  it('holds the app busy while something is unsaved', async () => {
    const { region, user } = await openCard();
    expect(isBusy()).toBe(false);
    await user.type(nameBox(region), 'R');
    expect(isBusy()).toBe(true);
  });

  it('opened by its address, Back replaces it with the Suppliers list', async () => {
    const { router, user } = renderSuppliers('/suppliers/supplier/new', { source: seeded() });
    const region = within(await card());
    await user.click(region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
