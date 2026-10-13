import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import type { FakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// Client ordering: the hub's door and the deadline editor behind it (when the orders a client sends from their own link
// close). The link on a client's screen is in CalculatorSettings.orderingLink.spec.tsx.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const timeBox = () => main().getByLabelText('Orders close at') as HTMLInputElement;
const LEAVE = 'You have unsaved changes. Leave without saving? Your changes will be lost.';
const HUB = '/calculator/settings';
const EDITOR = '/calculator/settings/ordering';

async function open(path: string, { cutoff = '18:00' as string | null, orderSource, lang = 'en' as 'en' | 'it' }: { cutoff?: string | null; orderSource?: FakeClientOrdersSource; lang?: 'en' | 'it' } = {}) {
  const clientOrders = orderSource ?? fakeClientOrdersSource({ cutoff });
  const view = renderCalculator(path, { source: fakeCalculatorSource({ config: configOf() }), lang, data: { clientOrders: () => clientOrders } });
  await main().findByRole('heading', { level: 2 }, LOAD);
  return { ...view, clientOrders };
}

type View = Awaited<ReturnType<typeof open>>;

async function openEditor(options?: Parameters<typeof open>[1]) {
  const view = await open(EDITOR, options);
  await waitFor(() => { expect(main().queryByText('Loading…')).toBeNull(); }, LOAD);
  return view;
}

async function saveAndConfirm(user: View['user'], text: string) {
  await user.click(saveButton());
  await user.click(within(await question(text)).getByRole('button', { name: 'Save' }));
}

describe('the hub\'s door', () => {
  it('opens the deadline editor one level down, and Back gives the focus back to it', async () => {
    const { user, ...view } = await open(HUB);
    const door = main().getByRole('button', { name: /^Client ordering/ });
    expect(door).toHaveTextContent('When orders sent from a client’s own link close');
    await user.click(door);
    await waitFor(() => { expect(pathOf(view)).toBe(EDITOR); });
    expect(await main().findByRole('heading', { level: 2, name: 'Client ordering' }, LOAD)).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    await waitFor(() => { expect(main().getByRole('button', { name: /^Client ordering/ })).toHaveFocus(); });
  });

  it('sits in the Clients and orders card, beside the WhatsApp door', async () => {
    await open(HUB);
    const card = within(main().getByRole('region', { name: 'Clients and orders' }));
    const names = card.getAllByRole('button').map(button => button.textContent ?? '');
    const at = (start: string) => names.findIndex(name => name.startsWith(start));
    expect(at('Client ordering')).toBe(at('WhatsApp') + 1);
  });

  it('says its words in Italian', async () => {
    const { user } = await open(HUB, { lang: 'it' });
    await user.click(main().getByRole('button', { name: /^Ordini dei clienti/ }));
    expect(await main().findByLabelText('Gli ordini chiudono alle', undefined, LOAD)).toBeInTheDocument();
    expect(main().getByText(/^Un ordine per un giorno può essere mandato/)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Nessuna scadenza' })).toBeInTheDocument();
  });
});

describe('the editor waits for the server', () => {
  it('says «Loading…» until the SERVER has answered, whatever this phone\'s own database said first', async () => {
    const orderSource = fakeClientOrdersSource({ cutoff: '17:00' });
    orderSource.hold();
    await open(EDITOR, { orderSource });
    expect(main().getByText('Loading…')).toBeInTheDocument();
    expect(main().queryByLabelText('Orders close at')).toBeNull();

    act(() => { orderSource.push({ fromServer: false }); });
    expect(main().getByText('Loading…')).toBeInTheDocument();

    orderSource.cutoff = '18:00';
    act(() => { orderSource.push(); });
    await waitFor(() => { expect(timeBox()).toHaveValue('18:00'); }, LOAD);
  });
});

describe('the form', () => {
  it('copies the deadline, with its help and the consequence nobody guesses, and a Save that waits for a change', async () => {
    await openEditor();
    expect(timeBox()).toHaveValue('18:00');
    expect(main().getByText(/^An order for a day can be sent, and changed, until this time on the day before/)).toBeInTheDocument();
    expect(main().getByText(/With a deadline, clients can order for tomorrow onwards but never for the current day/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('a venue that never set one reads as 16:00, says that nothing is saved, and lets Save store it as shown', async () => {
    const { user, clientOrders, ...view } = await openEditor({ cutoff: null });
    expect(timeBox()).toHaveValue('16:00');
    const note = main().getByRole('note');
    expect(note).toHaveTextContent('No deadline has been saved yet: until you save one, clients can order for any day, today included.');
    expect(saveButton()).toBeEnabled();
    // Pressing it asks the usual question and stores the 16:00 shown.
    await saveAndConfirm(user, 'Close orders at 16:00 the day before? Every client sees this straight away.');
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(clientOrders.savedCutoffs).toEqual(['16:00']);
  });

  it('leaving that editor untouched still asks nothing (Save being pressable is not an unsaved edit)', async () => {
    const { user, ...view } = await openEditor({ cutoff: null });
    expect(isBusy()).toBe(false);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a deadline that is stored (even «no deadline») has no such sentence and a Save that waits for a change', async () => {
    await openEditor({ cutoff: '' });
    expect(main().queryByRole('note')).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it('says that sentence in Italian', async () => {
    const orderSource = fakeClientOrdersSource({ cutoff: null });
    await open(EDITOR, { orderSource, lang: 'it' });
    expect(await main().findByRole('note', undefined, LOAD)).toHaveTextContent('Non è ancora stato salvato un orario: finché non lo salvi, i clienti possono ordinare per qualsiasi giorno, anche oggi.');
  });

  it('a venue with NO deadline shows an empty box', async () => {
    await openEditor({ cutoff: '' });
    expect(timeBox()).toHaveValue('');
    expect(main().getByRole('button', { name: 'No deadline' })).toBeDisabled();
  });

  it('Save is enabled by a change and disabled again when the change is put back', async () => {
    await openEditor();
    fireEvent.change(timeBox(), { target: { value: '19:30' } });
    expect(saveButton()).toBeEnabled();
    fireEvent.change(timeBox(), { target: { value: '18:00' } });
    expect(saveButton()).toBeDisabled();
  });

  it('«No deadline» clears the box and puts the focus back in it', async () => {
    const { user } = await openEditor();
    await user.click(main().getByRole('button', { name: 'No deadline' }));
    expect(timeBox()).toHaveValue('');
    expect(timeBox()).toHaveFocus();
    expect(saveButton()).toBeEnabled();
    expect(main().getByRole('button', { name: 'No deadline' })).toBeDisabled();
  });
});

describe('saving', () => {
  it('asks «close orders at …», writes the deadline, and returns to the hub', async () => {
    const { user, clientOrders, ...view } = await openEditor();
    fireEvent.change(timeBox(), { target: { value: '19:30' } });
    await saveAndConfirm(user, 'Close orders at 19:30 the day before? Every client sees this straight away.');
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(clientOrders.savedCutoffs).toEqual(['19:30']);
    expect(await main().findByRole('heading', { level: 2, name: 'Settings' }, LOAD)).toBeInTheDocument();
  });

  it('with the box empty it asks about removing the deadline, and writes none', async () => {
    const { user, clientOrders, ...view } = await openEditor();
    await user.click(main().getByRole('button', { name: 'No deadline' }));
    await saveAndConfirm(user, 'Remove the deadline? Clients will be able to order for any day, including today.');
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(clientOrders.savedCutoffs).toEqual(['']);
  });

  it('refuses a value that is not a time, says so, and writes nothing', async () => {
    const { user, clientOrders, ...view } = await openEditor();
    // jsdom's time box turns anything invalid into '', so it is made a plain text box, like an old desktop Safari's.
    timeBox().setAttribute('type', 'text');
    fireEvent.change(timeBox(), { target: { value: '9.30' } });
    await user.click(saveButton());
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(dialog).toHaveTextContent('That is not a time');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(pathOf(view)).toBe(EDITOR);
    expect(clientOrders.savedCutoffs).toEqual([]);
  });

  it('writes nothing when the question is answered with Cancel, and stays', async () => {
    const { user, clientOrders, ...view } = await openEditor();
    fireEvent.change(timeBox(), { target: { value: '19:30' } });
    await user.click(saveButton());
    await user.click(within(await question('Close orders at 19:30 the day before? Every client sees this straight away.')).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(EDITOR);
    expect(clientOrders.savedCutoffs).toEqual([]);
    expect(timeBox()).toHaveValue('19:30');
  });

  it('goes back one step when the editor was opened from the hub', async () => {
    const { user, clientOrders, ...view } = await open(HUB);
    await user.click(main().getByRole('button', { name: /^Client ordering/ }));
    await waitFor(() => { expect(pathOf(view)).toBe(EDITOR); });
    await waitFor(() => { expect(main().queryByLabelText('Orders close at')).not.toBeNull(); }, LOAD);
    fireEvent.change(timeBox(), { target: { value: '07:15' } });
    await saveAndConfirm(user, 'Close orders at 07:15 the day before? Every client sees this straight away.');
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(view.router.state.historyAction).toBe('POP');
    expect(clientOrders.savedCutoffs).toEqual(['07:15']);
  });

  it('is local-first: the screen returns at once while the write is still on its way', async () => {
    const { user, clientOrders, ...view } = await openEditor();
    clientOrders.holdWrites();
    fireEvent.change(timeBox(), { target: { value: '19:30' } });
    await saveAndConfirm(user, 'Close orders at 19:30 the day before? Every client sees this straight away.');
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(clientOrders.savedCutoffs).toEqual([]);
    expect(isBusy()).toBe(true);
    act(() => { clientOrders.settleWrites(); });
    await waitFor(() => { expect(clientOrders.savedCutoffs).toEqual(['19:30']); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('a refusal that arrives later is said, and the old deadline stays', async () => {
    const { user, clientOrders, ...view } = await openEditor();
    clientOrders.refuse.cutoffSave = true;
    fireEvent.change(timeBox(), { target: { value: '19:30' } });
    await saveAndConfirm(user, 'Close orders at 19:30 the day before? Every client sees this straight away.');
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(await screen.findByText('Not saved: check the connection and try again.')).toBeInTheDocument();
    expect(clientOrders.cutoff).toBe('18:00');
  });
});

describe('leaving', () => {
  it('asks about unsaved edits on Back and holds the busy marker, and asks nothing when nothing changed', async () => {
    const { user, ...view } = await openEditor();
    expect(isBusy()).toBe(false);
    fireEvent.change(timeBox(), { target: { value: '19:30' } });
    expect(isBusy()).toBe(true);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(EDITOR);
    expect(timeBox()).toHaveValue('19:30');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(view.clientOrders.savedCutoffs).toEqual([]);
    await waitFor(() => { expect(isBusy()).toBe(false); }, LOAD);
  });

  it('the rail asks too: every way out goes through the router\'s blocker', async () => {
    const { user, ...view } = await openEditor();
    fireEvent.change(timeBox(), { target: { value: '19:30' } });
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(EDITOR);
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/stocktake'); });
  });

  it('asks nothing when nothing was changed', async () => {
    const { user, ...view } = await openEditor();
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(HUB); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

