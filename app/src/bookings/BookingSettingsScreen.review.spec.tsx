import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeBookingsSource, permissionDenied, priceListOf } from '../testing/fakeBookingsSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { renderApp } from '../testing/renderApp';
import { DEFAULT_SETTINGS } from './bookingSettings';
import type { BookingSettings } from './bookingSettings';

// The code review of the settings screen (18 Nov 2026): the header bar while waiting, text left in an add box, a refused save.

const LOAD = { timeout: 5000 };

const products = () => [
  { id: 'pPizza', name: 'Pizza di cipolla', sellingMode: 'weight', sellingPrice: 16, components: [] },
  { id: 'pCornetto', name: 'Cornetto', sellingMode: 'piece', sellingPrice: 1.5, components: [] },
];

function show({ settings = DEFAULT_SETTINGS }: { settings?: BookingSettings } = {}) {
  const bookings = fakeBookingsSource([], priceListOf([]), settings);
  const foodcost = fakeFoodcostSource({ products: products(), recipes: [], priceList: null });
  const view = renderApp('/bookings/settings', { data: { bookings: () => bookings, foodcost: () => foodcost } });
  return { ...view, bookings, foodcost };
}

const opened = () => screen.findByRole('heading', { level: 2, name: 'Booking settings' }, LOAD);
const question = (name: string) => screen.findByRole('alertdialog', { name }, LOAD);
const card = (name: string) => screen.getByRole('checkbox', { name });
const confirmSave = async (user: ReturnType<typeof show>['user']) => {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(within(await question('Save the settings?')).getByRole('button', { name: 'Save' }));
};

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the waiting and failed screens keep the header bar', () => {
  it('while waiting for the server: the title and a Back button that steps up to the list', async () => {
    const bookings = fakeBookingsSource([], undefined, DEFAULT_SETTINGS);
    bookings.holdSettings();
    const view = renderApp('/bookings/settings', { data: { bookings: () => bookings, foodcost: () => fakeFoodcostSource({ products: products() }) } });
    await screen.findByText('Waiting for the settings from the server — this needs a connection.', {}, LOAD);
    expect(screen.getByRole('heading', { level: 2, name: 'Booking settings' })).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/bookings'); });
  });

  it('when the settings cannot be read: the same bar, and the reason', async () => {
    const bookings = fakeBookingsSource([], undefined, DEFAULT_SETTINGS);
    bookings.watchSettings = (_onChange, onError) => {
      queueMicrotask(() => { onError(new Error('unavailable')); });
      return () => undefined;
    };
    const view = renderApp('/bookings/settings', { data: { bookings: () => bookings, foodcost: () => fakeFoodcostSource({ products: products() }) } });
    expect(await screen.findByText(/be read now/, {}, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Booking settings' })).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/bookings'); });
  });
});

describe('text typed in an add box is never silently lost', () => {
  it('Done in the weights dialog adds a valid weight first; an invalid one keeps it open with the error and the focus', async () => {
    const { user, foodcost } = show();
    await opened();
    await user.click(card('Pizza di cipolla'));
    await user.click(screen.getByRole('button', { name: 'Add weights' }));
    const weights = await screen.findByRole('dialog', { name: 'Weights of Pizza di cipolla' });
    const box = within(weights).getByRole('textbox', { name: 'Weight' });
    await user.type(box, 'heavy');
    await user.click(within(weights).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('dialog', { name: 'Weights of Pizza di cipolla' })).toBeInTheDocument();
    expect(within(weights).getByText('A weight from 1 g to 50 kg, like 800 g or 1.5 kg.')).toBeInTheDocument();
    expect(box).toHaveFocus();
    await user.clear(box);
    await user.type(box, '900 g');
    await user.click(within(weights).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Weights: 900 g' })).toBeInTheDocument();
    await confirmSave(user);
    await waitFor(() => { expect(foodcost.publishPriceList).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(foodcost.publishPriceList).mock.calls[0]?.[0][0]?.weights).toEqual([0.9]);
  });

  it('Done in the left-out dialog adds the typed ingredient, ticked', async () => {
    const { user } = show();
    await opened();
    await user.click(card('Cornetto'));
    await user.click(screen.getByRole('button', { name: 'Choose what can be left out' }));
    const removable = await screen.findByRole('dialog', { name: 'What can be left out of Cornetto' });
    await user.type(within(removable).getByRole('textbox', { name: 'Another ingredient' }), 'Uvetta');
    await user.click(within(removable).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Can be left out: Uvetta' })).toBeInTheDocument();
  });

  it('the extras box: text left in it is an unsaved change, and Back asks', async () => {
    const { user, router } = show();
    await opened();
    expect(screen.queryByText('Not saved')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'New extra' }), 'Candeline');
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/bookings/settings');
  });

  it('Save adds the text left in the extras box before the question, and writes it', async () => {
    const { user, bookings } = show();
    await opened();
    await user.type(screen.getByRole('textbox', { name: 'New extra' }), 'Candeline');
    await confirmSave(user);
    await waitFor(() => { expect(bookings.saveSettings).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(bookings.saveSettings).mock.calls[0]?.[0].extras).toEqual(['Candeline']);
  });

  it('Save with text that cannot be added (the list is full) is blocked: the error, the focus, no question', async () => {
    const full = Array.from({ length: 40 }, (_, i) => `Extra ${i + 1}`);
    const { user, bookings } = show({ settings: { ...DEFAULT_SETTINGS, extras: full } });
    await opened();
    const box = screen.getByRole('textbox', { name: 'New extra' });
    await user.type(box, 'One too many');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('At most 40.')).toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(bookings.saveSettings).not.toHaveBeenCalled();
  });
});

describe('a refused save says so', () => {
  it('permission-denied is not blamed on the connection (settings and price list)', async () => {
    const { user, bookings, foodcost } = show();
    bookings.refuseSettingsWith = permissionDenied();
    foodcost.refuse.publish = true;
    await opened();
    await user.click(card('Cornetto'));
    await user.click(screen.getByRole('switch', { name: 'Ask for the phone number' }));
    await confirmSave(user);
    expect((await screen.findAllByText('You no longer have permission to change these settings.', {}, LOAD)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/check your connection/)).toBeNull();
  });

  it('any other failure still says to check the connection', async () => {
    const { user, bookings } = show();
    bookings.refuseSettingsWith = new Error('unavailable');
    await opened();
    await user.click(screen.getByRole('switch', { name: 'Ask for the phone number' }));
    await confirmSave(user);
    expect(await screen.findByText(/check your connection/, {}, LOAD)).toBeInTheDocument();
  });
});
