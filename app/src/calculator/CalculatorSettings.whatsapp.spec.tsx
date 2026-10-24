import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The WhatsApp lists editor: the top (the prefill window, the lists, the direct clients), ONE working copy per item
// across its screens, and the way it saves — a required name, a question, then ONE item written over the LATEST
// configuration.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const TOP = '/calculator/settings/whatsapp';
const LIST = '/calculator/settings/whatsapp/list/wl-1';
const ENTRY = '/calculator/settings/whatsapp/list/wl-1/client/roma';
const DIRECT = '/calculator/settings/whatsapp/direct/wc-1';
const LEAVE = 'You have unsaved changes. Leave without saving? Your changes will be lost.';

const LISTS = [
  { id: 'wl-1', title: 'Monday market', clients: [{ clientId: 'roma', products: ['tray'], extras: [{ id: 'wx-cut-loaves', name: 'Cut loaves' }] }] },
  { id: 'wl-2', title: 'Tuesday', clients: [] },
];
const DIRECTS = [{ id: 'wc-1', name: 'Stall', products: ['roll'], extras: [] }];

const withWhatsapp = (over: Record<string, unknown> = {}) => configOf({ whatsappLists: LISTS, whatsappClients: DIRECTS, ...over });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

async function open(path: string, { config = withWhatsapp(), lang = 'en' as 'en' | 'it', source = fakeCalculatorSource({ config }) } = {}) {
  const view = renderCalculator(path, { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  // ⚠️ The gate's waiting page has an h2 too («Settings» over «Loading…»).
  await waitFor(() => { expect(main().queryByText(/^(Loading…|Caricamento…)$/)).toBeNull(); }, LOAD);
  return { ...view, source };
}

type View = Awaited<ReturnType<typeof open>>;

async function saveAndConfirm(user: View['user']) {
  await user.click(saveButton());
  await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
}

const savedLists = (source: View['source']) => (source.savedConfigs.at(-1)?.whatsappLists ?? []) as Array<Record<string, unknown>>;
const nameBox = () => main().getByRole('textbox', { name: 'List name' });

describe('the hub and the top', () => {
  it('the hub has a WhatsApp door that opens the top, and Back hands the focus back to it', async () => {
    const { user, ...view } = await open('/calculator/settings');
    await user.click(main().getByRole('button', { name: /^WhatsApp/ }));
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(await main().findByRole('heading', { level: 2, name: 'WhatsApp lists' }, LOAD)).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    await waitFor(() => { expect(main().getByRole('button', { name: /^WhatsApp/ })).toHaveFocus(); });
  });

  it('lists the saved lists and direct clients, with a delete icon each, and an Add button per group, and no Save', async () => {
    await open(TOP);
    expect(main().getByRole('heading', { level: 2, name: 'WhatsApp lists' })).toBeInTheDocument();
    const lists = within(main().getByRole('region', { name: 'Lists' }));
    expect(lists.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Monday market', 'Tuesday']);
    expect(lists.getByRole('button', { name: 'Delete list Monday market' })).toBeInTheDocument();
    expect(lists.getByRole('button', { name: '+ Add list' })).toBeInTheDocument();
    const clients = within(main().getByRole('region', { name: 'Clients' }));
    expect(clients.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Stall']);
    expect(clients.getByRole('button', { name: 'Delete client Stall' })).toBeInTheDocument();
    expect(clients.getByRole('button', { name: '+ Add client' })).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('an untitled list and an unnamed client have a name to be told apart by', async () => {
    await open(TOP, { config: withWhatsapp({
      whatsappLists: [{ id: 'wl-9', title: '', clients: [{ clientId: 'roma', products: [], extras: [] }] }],
      whatsappClients: [{ id: 'wc-9', name: '', products: ['roll'], extras: [] }],
    }) });
    expect(main().getAllByRole('listitem').map(item => item.textContent)).toHaveLength(2);
  });

  it('says its words in Italian', async () => {
    await open(TOP, { lang: 'it' });
    expect(main().getByRole('heading', { level: 2, name: 'Liste WhatsApp' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: '+ Aggiungi lista' })).toBeInTheDocument();
    expect(main().getByRole('combobox', { name: 'Riempi l’ordine da' })).toBeInTheDocument();
    expect(within(main().getByRole('combobox', { name: 'Riempi l’ordine da' })).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Ieri e oggi', 'Solo ieri', 'Solo oggi']);
    expect(main().getByRole('button', { name: 'Elimina la lista Monday market' })).toBeInTheDocument();
  });
});

describe('the prefill window', () => {
  const select = () => main().getByRole('combobox', { name: 'Fill the order from' });

  it('offers the three windows with the current one chosen, and explains them', async () => {
    await open(TOP, { config: withWhatsapp({ orderPrefillWindow: 'yesterday' }) });
    expect(within(select()).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Yesterday and today', 'Yesterday only', 'Today only']);
    expect(select()).toHaveValue('yesterday');
    expect(select()).toHaveAccessibleDescription(/^Which days of saved logs/);
  });

  it('is applied on the change, with nothing else changed, and no question', async () => {
    const { user, source } = await open(TOP);
    await user.selectOptions(select(), 'today');
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(source.savedConfigs[0]?.orderPrefillWindow).toBe('today');
    expect(savedLists(source).map(list => list.id)).toEqual(['wl-1', 'wl-2']);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(select()).toBeEnabled(); });
    expect(select()).toHaveValue('today');
  });

  it('is disabled while the write is in the air', async () => {
    const source = fakeCalculatorSource({ config: withWhatsapp() });
    const { user } = await open(TOP, { source });
    source.holdConfigSaves();
    await user.selectOptions(select(), 'today');
    await waitFor(() => { expect(select()).toBeDisabled(); });
    source.settleConfigSaves();
    await waitFor(() => { expect(select()).toBeEnabled(); });
  });

  it('goes back to what it was when the write is refused, and says so', async () => {
    const source = fakeCalculatorSource({ config: withWhatsapp() });
    const { user } = await open(TOP, { source });
    source.refuse.configSave = true;
    await user.selectOptions(select(), 'today');
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(select()).toHaveValue('both'); });
    expect(select()).toBeEnabled();
  });
});

describe('deleting from the top', () => {
  it('asks first: Cancel keeps it, Delete removes ONLY that id from the latest configuration and saves at once', async () => {
    const { user, source } = await open(TOP);
    await user.click(main().getByRole('button', { name: 'Delete list Monday market' }));
    await user.click(within(await question('Delete this list?')).getByRole('button', { name: 'Cancel' }));
    expect(source.savedConfigs).toEqual([]);

    // Another phone adds a list while this one is open.
    source.config = { ...source.config, whatsappLists: [...LISTS, { id: 'wl-3', title: 'Added elsewhere', clients: [] }] };
    act(() => { source.push(); });
    await main().findByRole('button', { name: 'Added elsewhere' }, LOAD);

    await user.click(main().getByRole('button', { name: 'Delete list Monday market' }));
    await user.click(within(await question('Delete this list?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(savedLists(source).map(list => list.id)).toEqual(['wl-2', 'wl-3']);
    await waitFor(() => { expect(main().queryByRole('button', { name: 'Monday market' })).not.toBeInTheDocument(); });
  });

  it('deletes a direct client the same way', async () => {
    const { user, source } = await open(TOP);
    await user.click(main().getByRole('button', { name: 'Delete client Stall' }));
    await user.click(within(await question('Delete this client?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(source.savedConfigs[0]?.whatsappClients).toEqual([]);
    expect(savedLists(source)).toHaveLength(2);
  });

  it('a refused delete says so and the row is back', async () => {
    const source = fakeCalculatorSource({ config: withWhatsapp() });
    const { user } = await open(TOP, { source });
    source.refuse.configSave = true;
    await user.click(main().getByRole('button', { name: 'Delete list Tuesday' }));
    await user.click(within(await question('Delete this list?')).getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(main().getByRole('button', { name: 'Tuesday' })).toBeInTheDocument(); });
  });
});

describe('addresses', () => {
  it('a list the configuration does not have goes back to the top', async () => {
    const view = await open('/calculator/settings/whatsapp/list/nonsense');
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
  });

  it('a direct client the configuration does not have goes back to the top', async () => {
    const view = await open('/calculator/settings/whatsapp/direct/nonsense');
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
  });

  it('an unknown address under WhatsApp goes to the hub', async () => {
    const view = await open('/calculator/settings/whatsapp/nonsense');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
  });

  it('a client the list does not have goes back to the list', async () => {
    const view = await open('/calculator/settings/whatsapp/list/wl-1/client/nobody');
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
  });

  it('opens a list by its address, and a direct client by its', async () => {
    await open(LIST);
    expect(main().getByRole('heading', { level: 2, name: 'Edit list' })).toBeInTheDocument();
    expect(nameBox()).toHaveValue('Monday market');
  });

  it('opens a direct client by its address', async () => {
    await open(DIRECT);
    expect(main().getByRole('heading', { level: 2, name: 'Edit client' })).toBeInTheDocument();
    expect(main().getByRole('textbox', { name: 'Client name' })).toHaveValue('Stall');
  });
});

describe('waiting for the server\'s answer', () => {
  it('shows Loading and no editor until the SERVER has answered, then the data', async () => {
    const source = fakeCalculatorSource({ config: withWhatsapp() });
    source.hold();
    renderCalculator(TOP, { source });
    await act(async () => { await pause(100); });
    act(() => { source.push({ fromServer: false }); });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: '+ Add list' })).not.toBeInTheDocument();
    source.config = withWhatsapp({ whatsappLists: [...LISTS, { id: 'wl-3', title: 'Newer list', clients: [] }] });
    act(() => { source.push({ fromServer: true }); });
    expect(await main().findByRole('button', { name: 'Newer list' }, LOAD)).toBeInTheDocument();
  });
});

describe('adding a list or a client', () => {
  it('«Add list» opens an empty list at its own address, REPLACING the «new» address', async () => {
    const { user, ...view } = await open(TOP);
    await user.click(main().getByRole('button', { name: '+ Add list' }));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/whatsapp\/list\/wl-[0-9a-z]+$/); });
    expect(main().getByRole('heading', { level: 2, name: 'Edit list' })).toBeInTheDocument();
    expect(nameBox()).toHaveValue('');
    expect(nameBox()).toHaveAttribute('placeholder', 'List name');
    expect(main().getByText('Add a client, then add the products to send for it.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    // Back goes to the top in one step (the «new» address is not in the history), and asks nothing.
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(main().getAllByRole('listitem')).toHaveLength(3);
  });

  it('«Add client» opens an empty direct client at its own address', async () => {
    const { user, ...view } = await open(TOP);
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/whatsapp\/direct\/wc-[0-9a-z]+$/); });
    expect(main().getByRole('heading', { level: 2, name: 'Edit client' })).toBeInTheDocument();
    expect(main().getByRole('textbox', { name: 'Client name' })).toHaveValue('');
    expect(main().getByText('No products yet. Add products from the address book.')).toBeInTheDocument();
  });

  it('a new list with a name is saved as a NEW item at the end of the latest lists, and the top shows it', async () => {
    const { user, source, ...view } = await open(TOP);
    await user.click(main().getByRole('button', { name: '+ Add list' }));
    await user.type(await main().findByRole('textbox', { name: 'List name' }, LOAD), 'Friday');
    // Another phone adds a list while this one is being typed.
    source.config = { ...source.config, whatsappLists: [...LISTS, { id: 'wl-3', title: 'Added elsewhere', clients: [] }] };
    act(() => { source.push(); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(savedLists(source).map(list => list.title)).toEqual(['Monday market', 'Tuesday', 'Added elsewhere', 'Friday']);
    expect(await main().findByRole('button', { name: 'Friday' }, LOAD)).toBeInTheDocument();
  });
});

describe('a name is required', () => {
  it('blocks Save, marks the field, says so, and moves the focus to it — even from a client\'s lines', async () => {
    const { user, source, ...view } = await open(TOP);
    await user.click(main().getByRole('button', { name: '+ Add list' }));
    await main().findByRole('textbox', { name: 'List name' }, LOAD);
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await user.click(await main().findByRole('button', { name: 'Cafe Roma' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toMatch(/\/client\/roma$/); });

    await user.click(saveButton());
    const notice = await screen.findByRole('alertdialog', { name: 'Please name this list before saving.' }, LOAD);
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/whatsapp\/list\/wl-[0-9a-z]+$/); });
    await waitFor(() => { expect(nameBox()).toHaveFocus(); });
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(source.savedConfigs).toEqual([]);

    // Typing clears the mark.
    await user.type(nameBox(), 'x');
    expect(nameBox()).not.toHaveAttribute('aria-invalid');
  });

  it('a direct client without a name is refused the same way', async () => {
    const { user, source } = await open(DIRECT);
    const name = main().getByRole('textbox', { name: 'Client name' });
    await user.clear(name);
    await user.click(saveButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Please name this client before saving.' }, LOAD)).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(name).toHaveFocus(); });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(source.savedConfigs).toEqual([]);
  });
});

describe('saving one item', () => {
  it('Save waits for a change', async () => {
    await open(LIST);
    expect(saveButton()).toBeDisabled();
    expect(isBusy()).toBe(false);
  });

  it('writes ONLY this list over the latest configuration: another phone\'s change to another list survives, and it returns to the top', async () => {
    const { user, source, ...view } = await open(TOP);
    await user.click(main().getByRole('button', { name: 'Monday market' }));
    await user.clear(await main().findByRole('textbox', { name: 'List name' }, LOAD));
    await user.type(nameBox(), 'Market');
    expect(saveButton()).toBeEnabled();
    expect(isBusy()).toBe(true);

    // Another phone renames Tuesday and switches the prefill window while this one is being edited.
    source.config = { ...source.config, orderPrefillWindow: 'today', whatsappLists: [LISTS[0], { ...LISTS[1], title: 'Tuesday (renamed)' }] };
    act(() => { source.push(); });

    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(source.savedConfigs).toHaveLength(1);
    expect(savedLists(source).map(list => list.title)).toEqual(['Market', 'Tuesday (renamed)']);
    expect(source.savedConfigs[0]?.orderPrefillWindow).toBe('today');
    expect(isBusy()).toBe(false);
    expect(await main().findByRole('button', { name: 'Market' }, LOAD)).toBeInTheDocument();
  });

  it('from three screens deep it returns to the top in one step, leaving no trail', async () => {
    const { user, source, ...view } = await open('/calculator/settings');
    await user.click(main().getByRole('button', { name: /^WhatsApp/ }));
    await user.click(await main().findByRole('button', { name: 'Monday market' }, LOAD));
    await user.click(await main().findByRole('button', { name: /^Cafe Roma/ }, LOAD));
    await user.click(await main().findByRole('button', { name: '+ Add product' }, LOAD));
    await user.click(await main().findByRole('button', { name: 'Brioche roll' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe(ENTRY); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(savedLists(source)[0]?.clients).toEqual([
      { clientId: 'roma', products: ['tray', 'roll'], extras: [{ id: 'wx-cut-loaves', name: 'Cut loaves' }] },
    ]);
    // One browser Back from the top is the hub: nothing of the list, the client or the picker is left behind.
    act(() => { void view.router.navigate(-1); });
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
  });

  it('opened by a typed address and two screens deep, Save still lands on the top', async () => {
    const { user, source, ...view } = await open(LIST);
    await user.click(await main().findByRole('button', { name: /^Cafe Roma/ }, LOAD));
    await user.click(await main().findByRole('button', { name: '+ Add product' }, LOAD));
    await user.click(await main().findByRole('button', { name: 'Brioche roll' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe(ENTRY); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(savedLists(source)[0]?.clients).toEqual([
      { clientId: 'roma', products: ['tray', 'roll'], extras: [{ id: 'wx-cut-loaves', name: 'Cut loaves' }] },
    ]);
    expect(await main().findByRole('button', { name: 'Monday market' }, LOAD)).toBeInTheDocument();
  });

  it('a refused save keeps the edits and gives Save back', async () => {
    const source = fakeCalculatorSource({ config: withWhatsapp() });
    const { user, ...view } = await open(LIST, { source });
    await user.type(nameBox(), '!');
    source.refuse.configSave = true;
    await saveAndConfirm(user);
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'OK' }));
    expect(pathOf(view)).toBe(LIST);
    expect(nameBox()).toHaveValue('Monday market!');
    await waitFor(() => { expect(saveButton()).toBeEnabled(); });
  });

  it('saves a direct client\'s name and products', async () => {
    const { user, source, ...view } = await open(DIRECT);
    const name = main().getByRole('textbox', { name: 'Client name' });
    await user.clear(name);
    await user.type(name, 'Kiosk');
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(source.savedConfigs[0]?.whatsappClients).toEqual([{ id: 'wc-1', name: 'Kiosk', products: ['roll'], extras: [] }]);
    expect(savedLists(source)).toHaveLength(2);
  });
});

describe('leaving with unsaved edits', () => {
  it('Back from the list asks, Cancel stays, Discard goes to the top and saves nothing', async () => {
    const { user, source, ...view } = await open(TOP);
    await user.click(main().getByRole('button', { name: 'Tuesday' }));
    await user.type(await main().findByRole('textbox', { name: 'List name' }, LOAD), '!');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toMatch(/list\/wl-2$/);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(source.savedConfigs).toEqual([]);
    expect(await main().findByRole('button', { name: 'Tuesday' }, LOAD)).toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });

  it('Back from a direct client asks too', async () => {
    const { user, ...view } = await open(DIRECT);
    await user.type(main().getByRole('textbox', { name: 'Client name' }), '!');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
  });

  it('the rail asks too, from a client\'s lines', async () => {
    const { user, ...view } = await open(ENTRY);
    await user.type(main().getByRole('textbox', { name: 'Extra line 1' }), '!');
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(ENTRY);
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/stocktake'); });
  });

  it('asks nothing when nothing changed, or the change was put back', async () => {
    const { user, ...view } = await open(LIST);
    await user.type(nameBox(), 'x');
    await user.type(nameBox(), '{Backspace}');
    expect(isBusy()).toBe(false);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(TOP); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('stepping up from a client, the chooser or a picker asks nothing: the edits stay in the working copy', async () => {
    const { user, ...view } = await open(TOP);
    await user.click(main().getByRole('button', { name: 'Monday market' }));
    await user.type(await main().findByRole('textbox', { name: 'List name' }, LOAD), '!');
    await user.click(main().getByRole('button', { name: /^Cafe Roma/ }));
    await user.click(await main().findByRole('button', { name: '+ Add product' }, LOAD));
    await user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(nameBox()).toHaveValue('Monday market!');
  });
});

describe('a list: its clients', () => {
  it('shows a card per client with what it sends, live from the address book', async () => {
    await open(LIST);
    expect(main().getByRole('heading', { level: 3, name: 'Clients in this list' })).toBeInTheDocument();
    const card = main().getByRole('button', { name: /^Cafe Roma/ });
    expect(card).toHaveTextContent('Focaccia tray, Cut loaves');
  });

  it('a client with nothing to send says so', async () => {
    await open(LIST, { config: withWhatsapp({
      whatsappLists: [{ id: 'wl-1', title: 'M', clients: [{ clientId: 'roma', products: [], extras: [] }] }],
    }) });
    expect(main().getByRole('button', { name: /^Cafe Roma/ })).toHaveTextContent('Nothing to send yet — tap to add');
  });

  it('a client deleted from the address book while the list is open reads «Unknown client»', async () => {
    const { source } = await open(LIST);
    source.config = withWhatsapp({ clients: [] });
    act(() => { source.push(); });
    expect(await main().findByRole('button', { name: /^Unknown client/ }, LOAD)).toBeInTheDocument();
  });

  it('removing a client asks first (danger), and takes it out of the working copy only', async () => {
    const { user, source } = await open(LIST);
    await user.click(main().getByRole('button', { name: 'Remove Cafe Roma from the list' }));
    await user.click(within(await question('Remove this client from the list?')).getByRole('button', { name: 'Cancel' }));
    expect(main().getByRole('button', { name: /^Cafe Roma/ })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.click(main().getByRole('button', { name: 'Remove Cafe Roma from the list' }));
    await user.click(within(await question('Remove this client from the list?')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(main().queryByRole('button', { name: /^Cafe Roma/ })).not.toBeInTheDocument(); });
    expect(main().getByText('Add a client, then add the products to send for it.')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(source.savedConfigs).toEqual([]);
  });
});

describe('choosing a client to add (Level 1b)', () => {
  it('offers only the clients not already in the list, and picking one opens its lines in place of the chooser', async () => {
    const { user, ...view } = await open(LIST);
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    expect(await main().findByRole('heading', { level: 2, name: 'Add client' }, LOAD)).toBeInTheDocument();
    expect(main().getByText('Pick a client to add. Next you add the products to send for it.')).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Cafe Roma' })).not.toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Bar Sole' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/whatsapp/list/wl-1/client/sole'); });
    expect(await main().findByRole('heading', { level: 2, name: 'Bar Sole' }, LOAD)).toBeInTheDocument();
    expect(main().getByText('No products yet. Add products from the address book.')).toBeInTheDocument();

    // Back is the list, not the chooser; the new client is there, empty.
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
    expect(main().getByRole('button', { name: /^Bar Sole/ })).toHaveTextContent('Nothing to send yet — tap to add');
    expect(saveButton()).toBeEnabled();
  });

  it('says so when every client is already in the list, and when there are no clients at all', async () => {
    await open('/calculator/settings/whatsapp/list/wl-1/add', { config: withWhatsapp({
      whatsappLists: [{ id: 'wl-1', title: 'M', clients: [
        { clientId: 'roma', products: [], extras: [] }, { clientId: 'sole', products: [], extras: [] },
      ] }],
    }) });
    expect(main().getByText('All clients are already in this list.')).toBeInTheDocument();
  });

  it('says to add clients first when the address book is empty', async () => {
    await open('/calculator/settings/whatsapp/list/wl-2/add', { config: withWhatsapp({ clients: [] }) });
    expect(main().getByText('No clients yet. Add them in Settings → Clients first.')).toBeInTheDocument();
  });
});

describe('a client\'s lines (Level 2)', () => {
  it('shows the products and the free lines, and takes a product out with no question', async () => {
    const { user } = await open(ENTRY);
    expect(main().getByRole('heading', { level: 2, name: 'Cafe Roma' })).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 3, name: 'Products to send' })).toBeInTheDocument();
    expect(main().getByText('Focaccia tray')).toBeInTheDocument();
    expect(main().getByRole('textbox', { name: 'Extra line 1' })).toHaveValue('Cut loaves');
    expect(main().getByRole('textbox', { name: 'Extra line 1' })).toHaveAttribute('placeholder', 'e.g. Loaves of bread');
    expect(main().getByRole('heading', { level: 3, name: 'Added by hand' })).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Remove product Focaccia tray' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(main().queryByText('Focaccia tray')).not.toBeInTheDocument();
    expect(main().getByText('No products yet. Add products from the address book.')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('does not show a product deleted from the address book', async () => {
    await open(ENTRY, { config: withWhatsapp({
      whatsappLists: [{ id: 'wl-1', title: 'M', clients: [{ clientId: 'roma', products: ['tray', 'slab'], extras: [] }] }],
      clients: [{ id: 'roma', name: 'Cafe Roma', products: [{ id: 'tray', name: 'Focaccia tray', recipeId: 'focaccia', weight: 500, kind: 'number', active: true }] }],
    }) });
    expect(main().getByText('Focaccia tray')).toBeInTheDocument();
    expect(main().getAllByRole('button', { name: /^Remove product / })).toHaveLength(1);
  });

  it('a free line is removed with its icon', async () => {
    const { user } = await open(ENTRY);
    await user.click(main().getByRole('button', { name: 'Remove extra line 1' }));
    expect(main().queryByRole('textbox', { name: 'Extra line 1' })).not.toBeInTheDocument();
  });
});

describe('add to the message (Level 3)', () => {
  const headings = () => main().getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);

  it('puts the client\'s own products first, then the others, then the box for a name in neither; what the message has is left out', async () => {
    const { user } = await open(ENTRY);
    await user.click(main().getByRole('button', { name: '+ Add product' }));
    expect(await main().findByRole('heading', { level: 2, name: 'Add to the message' }, LOAD)).toBeInTheDocument();
    expect(headings()).toEqual(['Cafe Roma’s products', 'Other products', 'Not in the address book?']);
    const own = main().getAllByRole('button').filter(button => ['Focaccia slab', 'Paused loaf', 'Brioche roll'].includes(button.textContent ?? ''));
    expect(own.map(button => button.textContent)).toEqual(['Focaccia slab', 'Paused loaf', 'Brioche roll']);
    expect(main().queryByRole('button', { name: 'Focaccia tray' })).not.toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Cheese by the kilo' })).toBeInTheDocument();
    expect(main().getByText(/^Products of other clients\./)).toBeInTheDocument();
    expect(main().getByRole('textbox', { name: 'Add a line by hand' })).toBeInTheDocument();
  });

  it('picking a product steps back to the client\'s lines, which show it, and Back there is the list (not the picker)', async () => {
    const { user, ...view } = await open(LIST);
    await user.click(main().getByRole('button', { name: /^Cafe Roma/ }));
    await user.click(await main().findByRole('button', { name: '+ Add product' }, LOAD));
    await user.click(await main().findByRole('button', { name: 'Brioche roll' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe(ENTRY); });
    expect(await main().findByText('Brioche roll', undefined, LOAD)).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe(LIST); });
  });

  it('the client\'s own copy of a product sold under the same name by two clients is filed under «own»', async () => {
    const tray = { name: 'Bread', recipeId: 'focaccia', weight: 500, kind: 'number', active: true };
    await open('/calculator/settings/whatsapp/list/wl-1/client/b/add', { config: withWhatsapp({
      clients: [
        { id: 'a', name: 'Alpha', products: [{ ...tray, id: 'a-bread' }] },
        { id: 'b', name: 'Beta', products: [{ ...tray, id: 'b-bread' }] },
      ],
      whatsappLists: [{ id: 'wl-1', title: 'M', clients: [{ clientId: 'b', products: [], extras: [] }] }],
    }) });
    expect(headings()).toEqual(['Beta’s products', 'Not in the address book?']);
    expect(main().getAllByRole('button').filter(button => button.textContent === 'Bread')).toHaveLength(1);
  });

  it('a direct client has no products of its own: everything is under «Products»', async () => {
    await open('/calculator/settings/whatsapp/direct/wc-1/add');
    expect(headings()).toEqual(['Products', 'Not in the address book?']);
    expect(main().queryByRole('button', { name: 'Brioche roll' })).not.toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Focaccia tray' })).toBeInTheDocument();
  });

  it('says when everything is already added, and when the address book has no products', async () => {
    await open('/calculator/settings/whatsapp/direct/wc-1/add', { config: withWhatsapp({
      whatsappClients: [{ id: 'wc-1', name: 'Stall', products: ['tray', 'slab', 'paused', 'roll', 'cheese'], extras: [] }],
    }) });
    expect(main().getByText('Everything in the address book is already added.')).toBeInTheDocument();
    expect(main().getByRole('textbox', { name: 'Add a line by hand' })).toBeInTheDocument();
  });

  it('says when the address book has no products', async () => {
    await open('/calculator/settings/whatsapp/direct/wc-1/add', { config: withWhatsapp({ clients: [] }) });
    expect(main().getByText('No products in the address book yet.')).toBeInTheDocument();
  });

  it('says its words in Italian', async () => {
    await open(`${ENTRY}/add`, { lang: 'it' });
    expect(headings()).toEqual(['Prodotti di Cafe Roma', 'Altri prodotti', 'Non è in rubrica?']);
    expect(main().getByRole('textbox', { name: 'Aggiungi una riga a mano' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Aggiungi questa riga' })).toBeInTheDocument();
  });
});

describe('lines typed by hand', () => {
  const box = () => main().getByRole('textbox', { name: 'Add a line by hand' });

  it('adds a free line and steps back to the lines, which show it in a box of its own', async () => {
    const { user, ...view } = await open(`${ENTRY}/add`);
    await user.type(box(), '  Rolls  ');
    await user.click(main().getByRole('button', { name: 'Add this line' }));
    await waitFor(() => { expect(pathOf(view)).toBe(ENTRY); });
    expect(await main().findByRole('textbox', { name: 'Extra line 2' }, LOAD)).toHaveValue('Rolls');
    expect(saveButton()).toBeEnabled();
  });

  it('Enter in the box adds the line too', async () => {
    const { user, ...view } = await open(`${ENTRY}/add`);
    await user.type(box(), 'Rolls{Enter}');
    await waitFor(() => { expect(pathOf(view)).toBe(ENTRY); });
  });

  it('warns, visibly, about a name the message already carries — a free line or a product — and clears the warning on typing', async () => {
    const { user, ...view } = await open(`${ENTRY}/add`);
    await user.type(box(), 'Cut loaves');
    await user.click(main().getByRole('button', { name: 'Add this line' }));
    expect(await main().findByText('“Cut loaves” is already in this message.', undefined, LOAD)).toBeVisible();
    expect(pathOf(view)).toBe(`${ENTRY}/add`);
    await user.type(box(), 's');
    expect(main().queryByText(/is already in this message/)).not.toBeInTheDocument();

    await user.clear(box());
    await user.type(box(), 'Focaccia tray');
    await user.click(main().getByRole('button', { name: 'Add this line' }));
    expect(await main().findByText('“Focaccia tray” is already in this message.', undefined, LOAD)).toBeInTheDocument();
  });

  it('a blank name adds nothing', async () => {
    const { user, ...view } = await open(`${ENTRY}/add`);
    await user.type(box(), '   ');
    await user.click(main().getByRole('button', { name: 'Add this line' }));
    expect(pathOf(view)).toBe(`${ENTRY}/add`);
    expect(box()).toHaveFocus();
  });

  it('a line\'s id does not follow what is typed in it: it is settled when the configuration is saved', async () => {
    const { user, source } = await open(ENTRY);
    const first = main().getByRole('textbox', { name: 'Extra line 1' });
    await user.type(first, ' of bread');
    await user.click(main().getByRole('button', { name: '+ Add product' }));
    await user.type(await main().findByRole('textbox', { name: 'Add a line by hand' }, LOAD), 'Rolls');
    await user.click(main().getByRole('button', { name: 'Add this line' }));
    const added = await main().findByRole('textbox', { name: 'Extra line 2' }, LOAD);
    await user.type(added, ' and buns');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((savedLists(source)[0]?.clients as Array<{ extras: unknown }>)[0]?.extras).toEqual([
      { id: 'wx-cut-loaves', name: 'Cut loaves of bread' },
      { id: 'wx-rolls-and-buns', name: 'Rolls and buns' },
    ]);
  });

  it('a blank line is dropped when saved', async () => {
    const { user, source } = await open(ENTRY);
    await user.clear(main().getByRole('textbox', { name: 'Extra line 1' }));
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((savedLists(source)[0]?.clients as Array<{ extras: unknown }>)[0]?.extras).toEqual([]);
  });
});
