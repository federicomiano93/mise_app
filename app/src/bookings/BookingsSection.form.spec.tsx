import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { addProduct } from '../testing/bookingForm';
import { bookingFixture, fakeBookingsSource, priceListOf } from '../testing/fakeBookingsSource';
import type { FakeBookingsSource } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import { dayAfter } from './bookingModel';
import { DEFAULT_SETTINGS } from './bookingSettings';
import type { BookingSettings } from './bookingSettings';
import sectionCss from './BookingsSection.module.css?raw';
import editorCss from './BookingEditor.module.css?raw';

// The booking form's new layout, its product cards and the product window (bookings rebuild step 2, 19 Nov 2026; the owner's
// design, approved on the tablet). ⚠️ Fake customers only.

const TODAY = todayISO();
const TOMORROW = dayAfter(TODAY, 1);
const LOAD = { timeout: 5000 };

// Scacciata by the kilo with two weights and what can be left out; Panettone a favourite piece; Grissini a pack, not a favourite.
const PRICES = () => priceListOf([
  { productId: 'pS', name: 'Scacciata broccoli', price: 16, per: 'kg', favourite: true, weights: [1, 1.5], removable: ['cipolla', 'salsiccia'] },
  { productId: 'pP', name: 'Panettone', price: 25, per: 'piece', favourite: true },
  { productId: 'pG', name: 'Grissini', price: 3.5, per: 'pack', packSize: 250, packUnit: 'g' },
]);
const EXTRAS: BookingSettings = { ...DEFAULT_SETTINGS, extras: ['provola', 'olive'] };

function show(path: string, settings: BookingSettings = DEFAULT_SETTINGS, options: Parameters<typeof renderApp>[1] = {}) {
  const source: FakeBookingsSource = fakeBookingsSource([bookingFixture({ id: 'A1', date: TODAY, number: 3 })], PRICES(), settings);
  const view = renderApp(path, { ...options, data: { bookings: () => source } });
  return { ...view, source };
}

async function openWindow(user: ReturnType<typeof renderApp>['user']) {
  await screen.findByRole('region', { name: 'New booking' }, LOAD);
  await user.click(screen.getByRole('button', { name: 'Add a product' }));
  return screen.findByRole('dialog', { name: 'Add a product' });
}

const tileTexts = (win: HTMLElement) => within(win).getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent);

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the layout', () => {
  it('the order of the form: the customer\'s name, the day and the slot, how it is handed over, the products, the money, the notes', async () => {
    show('/bookings/new');
    const form = await screen.findByRole('region', { name: 'New booking' }, LOAD);
    const order = ['Customer name', 'Phone', 'Day', 'Time', 'Pickup', 'Add a product', 'Total (£, optional)', 'Notes (optional)']
      .map(name => (name === 'Pickup' ? screen.getByRole('radio', { name }) : name === 'Add a product' ? screen.getByRole('button', { name }) : screen.getByLabelText(name)));
    const all = [...form.querySelectorAll('input, button, textarea, select')];
    const at = order.map(element => all.indexOf(element));
    expect(at.every(index => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The two group headings stay for screen readers only; «Products» stays on screen.
    expect(screen.getByText('Customer', { selector: 'legend' })).toHaveClass('visually-hidden');
    expect(screen.getByText('When', { selector: 'legend' })).toHaveClass('visually-hidden');
    expect(screen.getByText('Items', { selector: 'legend' })).not.toHaveClass('visually-hidden');
  });

  it('the name, the day and the slot have the big labels; the day and the slot sit side by side from 520px', async () => {
    show('/bookings/new');
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    for (const name of ['Customer name', 'Day', 'Time']) {
      expect(screen.getByText(name, { selector: 'label' }).className).toContain('bigLabel');
    }
    expect(screen.getByText('Phone', { selector: 'label' }).className).not.toContain('bigLabel');
    expect(editorCss).toMatch(/\.label\.bigLabel\s*\{[^}]*font-size:\s*20px;[^}]*font-weight:\s*700;/);
    expect(editorCss).toMatch(/@media \(min-width: 520px\)\s*\{\s*\.when\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });

  it('⚠️ on the tablet the open form takes the whole width: the list beside it is hidden, and comes back with Back', async () => {
    const { user, router } = show('/bookings/new');
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    const layout = document.querySelector('[data-view]') as HTMLElement;
    expect(layout.className).toContain('fullForm');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/bookings'); });
    expect((document.querySelector('[data-view]') as HTMLElement).className).not.toContain('fullForm');
    // An existing booking's page keeps the list beside it; its editor takes the whole width.
    await router.navigate('/bookings/A1');
    await waitFor(() => { expect((document.querySelector('[data-view]') as HTMLElement).dataset.view).toBe('booking'); });
    expect((document.querySelector('[data-view]') as HTMLElement).className).not.toContain('fullForm');
    await router.navigate('/bookings/A1/edit');
    await waitFor(() => { expect((document.querySelector('[data-view]') as HTMLElement).className).toContain('fullForm'); });
    // The stylesheet does it from the split's width only.
    expect(sectionCss).toMatch(/@media \(min-width: 1000px\)\s*\{\s*\.layout\.fullForm\s*\{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\.layout\.fullForm \.list\s*\{\s*display: none;/);
  });

  it('one mode only: a quiet «✓ Ritiro» line, not a control', async () => {
    show('/bookings/new', { ...DEFAULT_SETTINGS, modes: 'pickup' }, { lang: 'it' });
    await screen.findByRole('region', { name: 'Nuova prenotazione' }, LOAD);
    const mark = screen.getByText('✓ Ritiro');
    expect(mark.tagName).toBe('P');
    expect(mark.className).toContain('onlyMode');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(editorCss).toMatch(/\.onlyMode\s*\{[^}]*color: var\(--ink-2\);[^}]*font-size: 15px;/);
  });
});

describe('the product window', () => {
  it('step 1: the favourites as tiles with their prices, then «Search all products» over the whole list', async () => {
    const { user } = show('/bookings/new');
    const win = await openWindow(user);
    expect(within(win).getByRole('heading', { name: 'Choose the product' })).toBeInTheDocument();
    expect(win).toHaveTextContent('1 of 3');
    // No Back on the first step.
    expect(within(win).queryByRole('button', { name: 'Back' })).toBeNull();
    expect(tileTexts(win)).toEqual(['Panettone £25.00 each', 'Scacciata broccoli £16.00 per kg', 'Search all products', 'Cancel']);
    await user.click(within(win).getByRole('button', { name: 'Search all products' }));
    const search = within(win).getByLabelText('Search the price list');
    expect(search).toHaveFocus();
    expect(tileTexts(win)).toEqual(expect.arrayContaining(['Grissini £3.50 per pack']));
    await user.type(search, 'griss');
    expect(tileTexts(win)).toEqual(['Back', 'Grissini £3.50 per pack', 'Add “griss” (not on the price list)', 'Cancel']);
    await user.clear(search);
    await user.type(search, 'pizza');
    expect(within(win).getByText('Nothing on the price list matches.')).toBeInTheDocument();
    // Back from the search: the favourites again.
    await user.click(within(win).getByRole('button', { name: 'Back' }));
    expect(within(win).getByRole('button', { name: 'Search all products' })).toBeInTheDocument();
  });

  it('a piece with nothing to change: one tap, the window closes and ONE card is added (weight and changes skipped)', async () => {
    const { user } = show('/bookings/new');
    const win = await openWindow(user);
    await user.click(within(win).getByRole('button', { name: 'Panettone £25.00 each' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    const card = screen.getByRole('group', { name: '1. Panettone' });
    expect(within(card).getByLabelText('Quantity of Panettone')).toHaveValue('1');
    expect(card).toHaveTextContent('£25.00 each');
    expect(await screen.findByText('Added: Panettone.')).toBeInTheDocument();
    // The focus is given back to «Add a product».
    expect(screen.getByRole('button', { name: 'Add a product' })).toHaveFocus();
  });

  it('step 2: a kilo product\'s weights, each with its price; step 3: «−» / «+» exclusive, the extras only «+», the note; Add', async () => {
    const { user } = show('/bookings/new', EXTRAS);
    const win = await openWindow(user);
    await user.click(within(win).getByRole('button', { name: 'Scacciata broccoli £16.00 per kg' }));
    expect(within(win).getByRole('heading', { name: 'Choose the weight' })).toHaveFocus();
    expect(win).toHaveTextContent('2 of 3');
    expect(tileTexts(win)).toEqual(['Back', '1 kg £16.00', '1.5 kg £24.00', 'Other weight…', 'Cancel']);
    await user.click(within(win).getByRole('button', { name: '1.5 kg £24.00' }));

    expect(within(win).getByRole('heading', { name: 'Scacciata broccoli · 1.5 kg' })).toHaveFocus();
    expect(win).toHaveTextContent('3 of 3');
    expect(within(win).getByText('No changes')).toBeInTheDocument();
    const recipe = within(win).getByRole('group', { name: 'In the recipe' });
    const without = within(recipe).getByRole('button', { name: 'Without cipolla' });
    const more = within(recipe).getByRole('button', { name: 'More cipolla' });
    await user.click(without);
    expect(without).toHaveAttribute('aria-pressed', 'true');
    expect(without.parentElement).toHaveAttribute('data-mark', 'without');
    expect(within(win).getByText('without cipolla')).toBeInTheDocument();
    // «+» replaces «−»; pressed again it clears.
    await user.click(more);
    expect(without).toHaveAttribute('aria-pressed', 'false');
    expect(more).toHaveAttribute('aria-pressed', 'true');
    expect(within(win).getByText('+ cipolla')).toBeInTheDocument();
    await user.click(more);
    expect(more).toHaveAttribute('aria-pressed', 'false');
    expect(within(win).getByText('No changes')).toBeInTheDocument();
    await user.click(without);
    // «To add»: the venue's extras, each with only a «+».
    const extras = within(win).getByRole('group', { name: 'To add' });
    expect(within(extras).getAllByRole('button').map(button => button.textContent)).toEqual(['provola', 'olive']);
    expect(within(extras).queryByRole('button', { name: /Without/ })).toBeNull();
    await user.click(within(extras).getByRole('button', { name: 'provola' }));
    expect(within(extras).getByRole('button', { name: 'provola' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(win).getByText('without cipolla, + provola')).toBeInTheDocument();
    // Back walks the steps.
    await user.click(within(win).getByRole('button', { name: 'Back' }));
    expect(within(win).getByRole('heading', { name: 'Choose the weight' })).toBeInTheDocument();
    await user.click(within(win).getByRole('button', { name: '1.5 kg £24.00' }));
    await user.click(within(within(win).getByRole('group', { name: 'In the recipe' })).getByRole('button', { name: 'Without cipolla' }));
    await user.click(within(within(win).getByRole('group', { name: 'To add' })).getByRole('button', { name: 'provola' }));
    await user.click(within(win).getByRole('button', { name: 'Add' }));

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    const card = screen.getByRole('group', { name: '1. Scacciata broccoli · 1.5 kg' });
    // The note pre-filled with the changes, still editable; the extras are free: the price is the weight's.
    expect(within(card).getByLabelText('Note for Scacciata broccoli · 1.5 kg')).toHaveValue('without cipolla, + provola');
    expect(card).toHaveTextContent('£24.00 each');
    await user.type(within(card).getByLabelText('Note for Scacciata broccoli · 1.5 kg'), ', well done');
    expect(within(card).getByLabelText('Note for Scacciata broccoli · 1.5 kg')).toHaveValue('without cipolla, + provola, well done');
  });

  it('«Other weight…»: a weight typed in kg or g, refused when it is not one', async () => {
    const { user } = show('/bookings/new');
    const win = await openWindow(user);
    await user.click(within(win).getByRole('button', { name: 'Scacciata broccoli £16.00 per kg' }));
    const other = within(win).getByRole('button', { name: 'Other weight…' });
    expect(other).toHaveAttribute('aria-expanded', 'false');
    await user.click(other);
    expect(other).toHaveAttribute('aria-expanded', 'true');
    const box = within(win).getByLabelText('Weight');
    expect(box).toHaveFocus();
    await user.type(box, 'tanto');
    await user.click(within(win).getByRole('button', { name: 'Use this weight' }));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('A weight from 1 g to 50 kg, like 800 g or 1.5 kg.');
    await user.clear(box);
    await user.type(box, '800 g{Enter}');
    // Something to change (the recipe): step 3, titled with the weight typed.
    expect(within(win).getByRole('heading', { name: 'Scacciata broccoli · 800 g' })).toBeInTheDocument();
    await user.click(within(win).getByRole('button', { name: 'Add' }));
    const card = await screen.findByRole('group', { name: '1. Scacciata broccoli · 800 g' });
    expect(card).toHaveTextContent('£12.80 each');
  });

  it('a name typed freely: by the piece or by a weight, with no price', async () => {
    const { user, source } = show('/bookings/new', { ...DEFAULT_SETTINGS, askPhone: false });
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    await addProduct(user, 'Torta su misura');
    await addProduct(user, 'Pane casereccio', { otherWeight: '2' });
    expect(screen.getByRole('group', { name: '1. Torta su misura' })).not.toHaveTextContent('£');
    expect(screen.getByRole('group', { name: '2. Pane casereccio · 2 kg' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save this booking?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(source.create).toHaveBeenCalledWith(expect.objectContaining({
        lines: [
          { recipeId: null, productId: null, unitPrice: null, name: 'Torta su misura', qty: 1, unit: 'pcs' },
          { recipeId: null, productId: null, unitPrice: null, name: 'Pane casereccio', qty: 1, unit: 'pcs', weightKg: 2 },
        ],
        total: null,
      }));
    });
  });

  it('⚠️ the note is printed on the slips: its words follow the venue\'s COUNTRY, not the screen\'s language', async () => {
    // An Italian venue, the screen in English: the screen speaks English, the note says «senza».
    const { user } = show('/bookings/new', DEFAULT_SETTINGS, { session: { location: { country: 'IT' } } });
    const win = await openWindow(user);
    await user.click(within(win).getByRole('button', { name: /^Scacciata broccoli/ }));
    await user.click(within(win).getByRole('button', { name: /^1 kg/ }));
    await user.click(within(win).getByRole('button', { name: 'Without cipolla' }));
    expect(within(win).getByText('senza cipolla')).toBeInTheDocument();
  });

  it('Enter in the search takes only the exact name, or the name typed when nothing matches', async () => {
    const { user } = show('/bookings/new');
    const win = await openWindow(user);
    await user.click(within(win).getByRole('button', { name: 'Search all products' }));
    const search = within(win).getByLabelText('Search the price list');
    // «Griss» matches one product but is not its name: Enter does nothing, the choice stays a tap.
    await user.type(search, 'Griss{Enter}');
    expect(screen.getByRole('dialog', { name: 'Add a product' })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'grissini{Enter}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(screen.getByRole('group', { name: '1. Grissini · 250 g' })).toBeInTheDocument();
  });

  it('Escape and Cancel close it and add nothing', async () => {
    const { user } = show('/bookings/new');
    let win = await openWindow(user);
    expect(win).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await user.click(screen.getByRole('button', { name: 'Add a product' }));
    win = await screen.findByRole('dialog', { name: 'Add a product' });
    await user.click(within(win).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(screen.queryAllByRole('group', { name: /^\d\. / })).toHaveLength(0);
  });

  it('no product: Save says so and goes to «Add a product»', async () => {
    const { user } = show('/bookings/new', { ...DEFAULT_SETTINGS, askPhone: false });
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    await user.type(screen.getByLabelText('Customer name'), 'Gino Prova');
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Add a product' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Add a product' })).toHaveAccessibleDescription('Add at least one product.');
  });
});

describe('the product cards', () => {
  it('− / N / +: − off at 1, + adds one, the number can be typed; the price of one above what the line comes to', async () => {
    const { user } = show('/bookings/new');
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    await addProduct(user, 'Panettone');
    const card = screen.getByRole('group', { name: '1. Panettone' });
    const less = within(card).getByRole('button', { name: 'One fewer: Panettone' });
    expect(less).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: 'One more: Panettone' }));
    await user.click(within(card).getByRole('button', { name: 'One more: Panettone' }));
    expect(within(card).getByLabelText('Quantity of Panettone')).toHaveValue('3');
    expect(less).not.toBeDisabled();
    expect(card).toHaveTextContent('£25.00 each£75.00');
    await user.click(less);
    expect(within(card).getByLabelText('Quantity of Panettone')).toHaveValue('2');
    const qty = within(card).getByLabelText('Quantity of Panettone');
    await user.clear(qty);
    await user.type(qty, '30');
    expect(card).toHaveTextContent('£750.00');
    expect(screen.getByLabelText('Total (£, optional)')).toHaveAccessibleDescription('Leave empty to use the price list’s total: £750.00.');
  });

  it('numbered from 1 in black circles; a card taken away renumbers the others and hands the focus on', async () => {
    const { user } = show('/bookings/new');
    await screen.findByRole('region', { name: 'New booking' }, LOAD);
    await addProduct(user, 'Panettone');
    await addProduct(user, 'Grissini');
    await addProduct(user, 'Scacciata broccoli', { weight: '1 kg' });
    const names = () => screen.getAllByRole('group', { name: /^\d\. / }).map(card => card.getAttribute('aria-label'));
    expect(names()).toEqual(['1. Panettone', '2. Grissini · 250 g', '3. Scacciata broccoli · 1 kg']);
    expect(screen.getByRole('group', { name: '2. Grissini · 250 g' }).querySelector('[aria-hidden="true"]')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: 'Remove Panettone' }));
    expect(names()).toEqual(['1. Grissini · 250 g', '2. Scacciata broccoli · 1 kg']);
    expect(screen.getByRole('group', { name: '1. Grissini · 250 g' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Remove Scacciata broccoli · 1 kg' }));
    await user.click(screen.getByRole('button', { name: 'Remove Grissini · 250 g' }));
    expect(screen.getByRole('button', { name: 'Add a product' })).toHaveFocus();
    expect(screen.getByText('No product yet: tap “Add a product”.')).toBeInTheDocument();
  });

  it('in Italian: «Togli», «l’una», «Nota (es. senza cipolla)»', async () => {
    const { user } = show('/bookings/new', DEFAULT_SETTINGS, { lang: 'it' });
    await screen.findByRole('region', { name: 'Nuova prenotazione' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Aggiungi un prodotto' }));
    const win = await screen.findByRole('dialog', { name: 'Aggiungi un prodotto' });
    expect(within(win).getByRole('heading', { name: 'Scegli il prodotto' })).toBeInTheDocument();
    expect(win).toHaveTextContent('1 di 3');
    expect(within(win).getByRole('button', { name: 'Cerca tra tutti i prodotti' })).toBeInTheDocument();
    await user.click(within(win).getByRole('button', { name: /^Panettone .* al pezzo$/ }));
    const card = await screen.findByRole('group', { name: '1. Panettone' });
    expect(card).toHaveTextContent('l’una');
    expect(within(card).getByRole('button', { name: 'Togli Panettone' })).toBeInTheDocument();
    expect(within(card).getByLabelText('Nota per Panettone')).toHaveAttribute('placeholder', 'Nota (es. senza cipolla)');
  });
});
