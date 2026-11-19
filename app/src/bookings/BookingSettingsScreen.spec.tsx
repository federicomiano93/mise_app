import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { screenNameFor } from '../shell/sections';
import { fakeBookingsSource, priceListOf } from '../testing/fakeBookingsSource';
import type { FakeBookingsSource } from '../testing/fakeBookingsSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import type { FakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { renderApp } from '../testing/renderApp';
import { DEFAULT_SETTINGS } from './bookingSettings';
import type { BookingSettings } from './bookingSettings';
import { parseBookingsPath } from './bookingsPath';

// «Impostazioni prenotazioni» (bookings settings, 18 Nov 2026): the phone, the reminder, the modes, the slots and the products
// the counter books (the price list that used to be published from Food cost). One Save writes the settings and publishes the list.

const LOAD = { timeout: 5000 };

const products = () => [
  { id: 'pPizza', name: 'Pizza di cipolla', sellingMode: 'weight', sellingPrice: 16, components: [{ recipeId: 'r1', qtyKg: 1 }] },
  { id: 'pCornetto', name: 'Cornetto', sellingMode: 'piece', sellingPrice: 1.5, components: [] },
  { id: 'pTorta', name: 'Torta', sellingMode: 'piece', sellingPrice: null, components: [] },
];
const recipes = () => [{ id: 'r1', name: 'Pizza', ingredients: [{ label: 'Farina' }, { label: 'Cipolla' }, { label: 'Acciughe' }] }];

function show(
  { settings = DEFAULT_SETTINGS, priceList = null, session = {} }: {
    settings?: BookingSettings; priceList?: Record<string, unknown> | null; session?: NonNullable<Parameters<typeof renderApp>[1]>['session'];
  } = {},
) {
  const bookings: FakeBookingsSource = fakeBookingsSource([], priceListOf((priceList?.items as Array<Record<string, unknown>> | undefined) ?? []), settings);
  const foodcost: FakeFoodcostSource = fakeFoodcostSource({ products: products(), recipes: recipes(), priceList });
  const view = renderApp('/bookings/settings', { session, data: { bookings: () => bookings, foodcost: () => foodcost } });
  return { ...view, bookings, foodcost };
}

const opened = () => screen.findByRole('heading', { level: 2, name: 'Booking settings' }, LOAD);
const question = (name: string) => screen.findByRole('alertdialog', { name }, LOAD);
const card = (name: string) => screen.getByRole('checkbox', { name });

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the address', () => {
  it('/bookings/settings is the settings, named apart in the usage record', () => {
    expect(parseBookingsPath('settings')).toEqual({ kind: 'settings' });
    expect(screenNameFor('/bookings/settings')).toBe('bookings-settings');
  });

  it('⚠️ an employee who types the address is sent to the list', async () => {
    show({ session: { canManage: false, role: 'staff' } });
    await screen.findByRole('button', { name: 'New booking' }, LOAD);
    expect(screen.queryByRole('heading', { name: 'Booking settings' })).toBeNull();
  });

  it('the list\'s «Settings» button opens them, for whoever manages bookings', async () => {
    const { user, router } = show();
    await opened();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await opened();
  });

  it('…and an employee has no «Settings» button', async () => {
    renderApp('/bookings', { session: { canManage: false, role: 'staff' }, data: { bookings: () => fakeBookingsSource() } });
    await screen.findByRole('button', { name: 'Receipt printer' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });
});

describe('the settings', () => {
  it('opens on today\'s behaviour for a venue that never saved them', async () => {
    show();
    await opened();
    expect(screen.getByRole('switch', { name: 'Ask for the phone number' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'WhatsApp reminder' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Bookings are' })).toHaveValue('both');
    expect(screen.getByRole('combobox', { name: 'First slot from' })).toHaveValue('');
    expect(screen.getByText('No slots: the form asks for the exact time.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Slips per piece' })).toBeChecked();
  });

  it('⚠️ waits for the server: a phone with no copy is never offered the defaults to save over the real settings', async () => {
    const bookings = fakeBookingsSource([], undefined, { ...DEFAULT_SETTINGS, askPhone: false });
    bookings.holdSettings();
    renderApp('/bookings/settings', { data: { bookings: () => bookings, foodcost: () => fakeFoodcostSource({ products: products() }) } });
    expect(await screen.findByText('Waiting for the settings from the server — this needs a connection.', {}, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    bookings.releaseSettings();
    await opened();
    expect(screen.getByRole('switch', { name: 'Ask for the phone number' })).not.toBeChecked();
  });

  it('⚠️ the reminder needs the phone: with the phone off it is off and cannot be switched, and its «?» says why', async () => {
    const { user } = show();
    await opened();
    await user.click(screen.getByRole('switch', { name: 'Ask for the phone number' }));
    const reminder = screen.getByRole('switch', { name: 'WhatsApp reminder' });
    expect(reminder).not.toBeChecked();
    expect(reminder).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /WhatsApp reminder/ }));
    expect(screen.getByText(/It needs the phone number/)).toBeVisible();
  });

  it('the slots: half hours, the resulting chips, the last one never past closing', async () => {
    const { user } = show();
    await opened();
    await user.selectOptions(screen.getByRole('combobox', { name: 'First slot from' }), '08:00');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Last slot until' }), '10:30');
    const chips = within(screen.getByRole('list', { name: 'The form’s slots' })).getAllByRole('listitem').map(li => li.textContent);
    expect(chips).toEqual(['08:00–09:00', '09:00–10:00', '10:00–10:30']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Length of a slot' }), '120');
    expect(within(screen.getByRole('list', { name: 'The form’s slots' })).getAllByRole('listitem').map(li => li.textContent))
      .toEqual(['08:00–10:00', '10:00–10:30']);
  });

  it('saves after a question: the settings written, the limit read, leaving to the list', async () => {
    const { user, bookings, foodcost, router } = show();
    await opened();
    await user.click(screen.getByRole('switch', { name: 'Ask for the phone number' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bookings are' }), 'pickup');
    await user.selectOptions(screen.getByRole('combobox', { name: 'First slot from' }), '08:00');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Last slot until' }), '13:00');
    await user.type(screen.getByRole('textbox', { name: 'Bookings per slot' }), '12');
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await question('Save the settings?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(bookings.saveSettings).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(bookings.saveSettings).mock.calls[0]?.[0]).toEqual({
      ...DEFAULT_SETTINGS, askPhone: false, modes: 'pickup', slotFirst: '08:00', slotLast: '13:00', slotLimit: 12,
    });
    // Nothing about the products changed: nothing is published.
    expect(foodcost.publishPriceList).not.toHaveBeenCalled();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
  });

  it('refuses a limit that is not a whole number from 1 to 999', async () => {
    const { user, bookings } = show();
    await opened();
    await user.type(screen.getByRole('textbox', { name: 'Bookings per slot' }), '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A whole number from 1 to 999, or empty.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(bookings.saveSettings).not.toHaveBeenCalled();
  });

  it('⚠️ leaving with changes asks first', async () => {
    const { user, router } = show();
    await opened();
    await user.click(screen.getByRole('switch', { name: 'Slips per piece' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/bookings/settings');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
  });
});

describe('the products', () => {
  it('one card per product with a selling price, and a line for each product without one', async () => {
    show();
    await opened();
    expect(card('Cornetto')).not.toBeChecked();
    expect(card('Pizza di cipolla')).not.toBeChecked();
    expect(screen.getByText('Torta is not on the list: in Food cost it has no selling price.')).toBeInTheDocument();
  });

  it('⚠️ publishes on Save: favourite, per piece, weights, and the recipe\'s ingredients pre-filled then unticked', async () => {
    const { user, foodcost } = show();
    await opened();
    await user.click(card('Pizza di cipolla'));
    await user.click(screen.getByRole('button', { name: 'Favourite: Pizza di cipolla' }));
    expect(screen.getByRole('button', { name: 'Favourite: Pizza di cipolla' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('switch', { name: 'Ask per piece: Pizza di cipolla' }));
    // Weights.
    await user.click(screen.getByRole('button', { name: 'Add weights' }));
    const weights = await screen.findByRole('dialog', { name: 'Weights of Pizza di cipolla' });
    await user.type(within(weights).getByRole('textbox', { name: 'Weight' }), '800 g');
    await user.click(within(weights).getByRole('button', { name: 'Add' }));
    await user.type(within(weights).getByRole('textbox', { name: 'Weight' }), '1,5{Enter}');
    await user.type(within(weights).getByRole('textbox', { name: 'Weight' }), 'heavy');
    await user.click(within(weights).getByRole('button', { name: 'Add' }));
    expect(within(weights).getByText('A weight from 1 g to 50 kg, like 800 g or 1.5 kg.')).toBeInTheDocument();
    await user.clear(within(weights).getByRole('textbox', { name: 'Weight' }));
    await user.click(within(weights).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Weights: 800 g · 1.5 kg' })).toBeInTheDocument();
    // Removable: pre-filled from the recipe when it was ticked; the basic one unticked.
    await user.click(screen.getByRole('button', { name: 'Can be left out: Farina, Cipolla, Acciughe' }));
    const removable = await screen.findByRole('dialog', { name: 'What can be left out of Pizza di cipolla' });
    await user.click(within(removable).getByRole('checkbox', { name: 'Farina' }));
    await user.click(within(removable).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Can be left out: Cipolla, Acciughe' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const ask = await question('Save the settings?');
    expect(ask).toHaveTextContent('the counter books the ticked products at these prices');
    await user.click(within(ask).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(foodcost.publishPriceList).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(foodcost.publishPriceList).mock.calls[0]?.[0]).toEqual([{
      productId: 'pPizza', name: 'Pizza di cipolla', price: 16, per: 'kg',
      favourite: true, perPiece: true, weights: [0.8, 1.5], removable: ['Cipolla', 'Acciughe'],
    }]);
  });

  it('starts from what is published; the per-piece column goes with the master switch', async () => {
    const { user } = show({ priceList: { items: [{ productId: 'pCornetto', name: 'Cornetto', price: 1.5, per: 'piece', perPiece: true }] } });
    await opened();
    expect(card('Cornetto')).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Ask per piece: Cornetto' })).toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Slips per piece' }));
    expect(screen.queryByRole('switch', { name: 'Ask per piece: Cornetto' })).toBeNull();
    expect(screen.queryByText('Ask per piece')).toBeNull();
  });

  it('⚠️ a Save that changed only a setting publishes nothing: no recipe list slipped into a product never chosen', async () => {
    const { user, foodcost, bookings } = show({ priceList: { items: [{ productId: 'pPizza', name: 'Pizza di cipolla', price: 16, per: 'kg' }] } });
    await opened();
    expect(screen.getByRole('button', { name: 'Choose what can be left out' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Ask for the phone number' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await question('Save the settings?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(bookings.saveSettings).toHaveBeenCalledTimes(1); });
    expect(foodcost.publishPriceList).not.toHaveBeenCalled();
  });

  it('says when a price changed in Food cost since the last publish', async () => {
    show({ priceList: { items: [{ productId: 'pCornetto', name: 'Cornetto', price: 1.2, per: 'piece' }] } });
    await opened();
    expect(screen.getByText('Some names or prices changed in Food cost: save to update the counter.')).toBeInTheDocument();
  });

  it('⚠️ read only, with who can change them, for a venue whose Food cost is off', async () => {
    const { user, foodcost } = show({
      priceList: { items: [{ productId: 'pCornetto', name: 'Cornetto', price: 1.5, per: 'piece', favourite: true }] },
      session: { location: { name: 'Test', sections: { foodcost: false } } },
    });
    await opened();
    expect(screen.getByText('Only whoever runs Food cost can change the products.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Cornetto' })).toBeNull();
    expect(screen.getByText('Cornetto')).toBeInTheDocument();
    expect(foodcost.watchProducts).not.toHaveBeenCalled();
    await user.click(screen.getByRole('switch', { name: 'Slips per piece' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await question('Save the settings?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('heading', { name: 'Booking settings' })).toBeNull(); });
    expect(foodcost.publishPriceList).not.toHaveBeenCalled();
  });

  it('the «Da aggiungere» list: chips, add, remove, saved with the settings', async () => {
    const { user, bookings } = show();
    await opened();
    await user.type(screen.getByRole('textbox', { name: 'New extra' }), 'Candeline{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'New extra' }), 'Scritta');
    await user.click(screen.getAllByRole('button', { name: 'Add' }).at(-1) as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Remove Candeline' }));
    // The focus goes to the add field, never to the page.
    expect(screen.getByRole('textbox', { name: 'New extra' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await question('Save the settings?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(bookings.saveSettings).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(bookings.saveSettings).mock.calls[0]?.[0].extras).toEqual(['Scritta']);
  });

  it('reads in Italian', async () => {
    renderApp('/bookings/settings', { lang: 'it', data: { bookings: () => fakeBookingsSource(), foodcost: () => fakeFoodcostSource({ products: products() }) } });
    await screen.findByRole('heading', { level: 2, name: 'Impostazioni prenotazioni' }, LOAD);
    expect(screen.getByRole('switch', { name: 'Chiedi il numero di telefono' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Le prenotazioni sono' })).toBeInTheDocument();
    expect(screen.getByText('Torta non è nell’elenco: in Food cost non ha un prezzo di vendita.')).toBeInTheDocument();
  });
});
