import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { menuFor } from '@mise/shared/client-order-model';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { CLIENTS, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The Clients editor: the address book as a list, one client with its products as cards, ONE working copy for both,
// and the way it saves — a required check, a question, then ONE write of the whole `clients` array over the latest
// configuration.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const LEAVE = 'You have unsaved changes. Leave without saving? Your changes will be lost.';

async function open(path: string, { config = configOf(), lang = 'en' as 'en' | 'it', source = fakeCalculatorSource({ config }) } = {}) {
  const view = renderCalculator(path, { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  // ⚠️ The gate's waiting page has an h2 too («Settings» over «Loading…»): under a loaded full run the editor may
  // still be waiting for the store when the first h2 appears.
  await waitFor(() => { expect(main().queryByText(/^(Loading…|Caricamento…)$/)).toBeNull(); }, LOAD);
  return { ...view, source };
}

type View = Awaited<ReturnType<typeof open>>;

async function saveAndConfirm(user: View['user']) {
  await user.click(saveButton());
  await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
}

const rowNames = () => main().getAllByRole('row').map(row => row.textContent);
const nameBox = () => main().getByRole('textbox', { name: 'Client name' });
const card = (name: string) => within(main().getByRole('group', { name }));

// Opens a client from the list and waits for its screen.
async function openClient(user: View['user'], name: string) {
  await user.click(main().getByRole('row', { name: new RegExp(name) }));
  await main().findByRole('textbox', { name: 'Client name' }, LOAD);
}

describe('the list', () => {
  it('has one row per client, in order, and a Save that waits for a change', async () => {
    await open('/calculator/settings/clients');
    expect(main().getByRole('heading', { level: 2, name: 'Clients' })).toBeInTheDocument();
    expect(rowNames()).toEqual(['Cafe Roma', 'Bar Sole']);
    expect(main().getByRole('button', { name: '+ Add client' })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(main().queryByText(/^No clients yet/)).not.toBeInTheDocument();
  });

  it('an empty address book says what a client is for, above «Add client»', async () => {
    await open('/calculator/settings/clients', { config: configOf({ clients: [] }) });
    const hint = main().getByText(/^No clients yet\. A client is somebody you bake for/);
    const add = main().getByRole('button', { name: '+ Add client' });
    expect(hint.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main().queryAllByRole('row')).toHaveLength(0);
  });

  it('a client whose name was erased is shown as «Unnamed client»', async () => {
    const { user } = await open('/calculator/settings/clients');
    await openClient(user, 'Bar Sole');
    await user.clear(nameBox());
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(rowNames()).toEqual(['Cafe Roma', 'Unnamed client']); });
  });

  it('only a list of two or more has the drag handles', async () => {
    await open('/calculator/settings/clients');
    expect(main().getAllByRole('button', { name: /^Drag to reorder / })).toHaveLength(2);
  });

  it('a lone client has no handle', async () => {
    await open('/calculator/settings/clients', { config: configOf({ clients: [CLIENTS[0]] }) });
    expect(main().queryByRole('button', { name: /^Drag to reorder / })).not.toBeInTheDocument();
  });

  it('a row opens its client', async () => {
    const { user, ...view } = await open('/calculator/settings/clients');
    await openClient(user, 'Bar Sole');
    expect(pathOf(view)).toBe('/calculator/settings/clients/sole');
    expect(main().getByRole('heading', { level: 2, name: 'Bar Sole' })).toBeInTheDocument();
  });

  it('says its words in Italian', async () => {
    await open('/calculator/settings/clients', { lang: 'it', config: configOf({ clients: [] }) });
    expect(main().getByRole('heading', { level: 2, name: 'Clienti' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: '+ Aggiungi cliente' })).toBeInTheDocument();
    expect(main().getByText(/^Ancora nessun cliente/)).toBeInTheDocument();
  });
});

describe('where the focus goes', () => {
  it('a client opened from the list takes the focus on its title, and Back hands it to its row', async () => {
    const { user } = await open('/calculator/settings/clients');
    await openClient(user, 'Bar Sole');
    await waitFor(() => { expect(main().getByRole('heading', { level: 2, name: 'Bar Sole' })).toHaveFocus(); });
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(main().getByRole('row', { name: /Bar Sole/ })).toHaveFocus(); });
  });

  it('a dropped new client hands the focus back to «Add client»', async () => {
    const { user } = await open('/calculator/settings/clients');
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await main().findByRole('textbox', { name: 'Client name' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard this new client? You have not added anything to it.')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(main().getByRole('button', { name: '+ Add client' })).toHaveFocus(); });
  });
});

describe('addresses', () => {
  it('a client the working copy does not have goes back to the list', async () => {
    const view = await open('/calculator/settings/clients/nonsense');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    expect(await main().findByRole('row', { name: /Cafe Roma/ }, LOAD)).toBeInTheDocument();
  });

  it('«new» is not a client: it goes to the list', async () => {
    const view = await open('/calculator/settings/clients/new');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
  });

  it('opens a client by its address', async () => {
    await open('/calculator/settings/clients/roma');
    expect(main().getByRole('heading', { level: 2, name: 'Cafe Roma' })).toBeInTheDocument();
    expect(nameBox()).toHaveValue('Cafe Roma');
  });
});

describe('the working copy is one for the list and the client', () => {
  it('keeps an edit when going from a client back to the list, asks nothing, and asks only when leaving altogether', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients');
    await openClient(user, 'Cafe Roma');
    await user.clear(nameBox());
    await user.type(nameBox(), 'Roma Cafe');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Roma Cafe', 'Bar Sole']);
    expect(saveButton()).toBeEnabled();

    // Opening the client again shows the edit, still unsaved.
    await openClient(user, 'Roma Cafe');
    expect(nameBox()).toHaveValue('Roma Cafe');
    await user.click(main().getByRole('button', { name: 'Back' }));

    // Leaving the editor altogether asks.
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe('/calculator/settings/clients');
    expect(rowNames()).toEqual(['Roma Cafe', 'Bar Sole']);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toEqual([]);
  });

  it('the rail asks too, from a client: every way out goes through the router\'s blocker', async () => {
    const { user, ...view } = await open('/calculator/settings/clients/roma');
    await user.type(nameBox(), '!');
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe('/calculator/settings/clients/roma');
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/stocktake'); });
  });

  it('asks nothing when nothing was changed, or the change was put back', async () => {
    const { user, ...view } = await open('/calculator/settings/clients');
    await openClient(user, 'Cafe Roma');
    await user.type(nameBox(), 'x');
    await user.type(nameBox(), '{Backspace}');
    expect(isBusy()).toBe(false);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('holds the busy marker while edits are unsaved', async () => {
    const { user } = await open('/calculator/settings/clients/roma');
    expect(isBusy()).toBe(false);
    await user.type(nameBox(), 'x');
    expect(isBusy()).toBe(true);
  });
});

describe('adding a client', () => {
  it('opens an empty client at its own address, with placeholders and a «New client» title', async () => {
    const { user, ...view } = await open('/calculator/settings/clients');
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/clients\/c-[0-9a-z]+$/); });
    expect(main().getByRole('heading', { level: 2, name: 'New client' })).toBeInTheDocument();
    expect(nameBox()).toHaveValue('');
    expect(nameBox()).toHaveAttribute('placeholder', 'Client name');
    // No product cards yet: the only group is the ordering link, which asks for a save first.
    expect(main().getAllByRole('group')).toHaveLength(1);
    expect(main().getByRole('group', { name: 'Ordering link' })).toHaveTextContent('Save your changes first');
  });

  it('an untouched new client asks to be discarded on Back, and Discard drops it', async () => {
    const { user, ...view } = await open('/calculator/settings/clients');
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await main().findByRole('textbox', { name: 'Client name' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard this new client? You have not added anything to it.')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    await waitFor(() => { expect(rowNames()).toEqual(['Cafe Roma', 'Bar Sole']); });
    expect(saveButton()).toBeDisabled();
    expect(isBusy()).toBe(false);
  });

  it('Cancel on that question keeps the new client where it is', async () => {
    const { user, ...view } = await open('/calculator/settings/clients');
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await main().findByRole('textbox', { name: 'Client name' }, LOAD);
    const here = pathOf(view);
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard this new client? You have not added anything to it.')).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe(here);
    expect(nameBox()).toBeInTheDocument();
  });

  it('the browser\'s Back asks the same, and drops the client on Discard', async () => {
    const { user, ...view } = await open('/calculator/settings/clients');
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await main().findByRole('textbox', { name: 'Client name' }, LOAD);
    act(() => { void view.router.navigate(-1); });
    await user.click(within(await question('Discard this new client? You have not added anything to it.')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    await waitFor(() => { expect(rowNames()).toEqual(['Cafe Roma', 'Bar Sole']); });
  });

  it('a new client with a name is kept: Back asks nothing and the list shows it', async () => {
    const { user, ...view } = await open('/calculator/settings/clients');
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await user.type(await main().findByRole('textbox', { name: 'Client name' }, LOAD), 'Bakery Nova');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowNames()).toEqual(['Cafe Roma', 'Bar Sole', 'Bakery Nova']);
  });
});

describe('a product card', () => {
  it('shows the product in full: name, recipe, weight, type, crate box, active', async () => {
    await open('/calculator/settings/clients/roma');
    const tray = card('Focaccia tray');
    expect(tray.getByRole('textbox', { name: 'Name' })).toHaveValue('Focaccia tray');
    expect(tray.getByRole('combobox', { name: 'Recipe' })).toHaveValue('focaccia');
    expect(within(tray.getByRole('combobox', { name: 'Recipe' })).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Focaccia', 'Brioche', 'Sourdough']);
    expect(tray.getByRole('spinbutton', { name: 'Weight in grams' })).toHaveValue(500);
    expect(tray.getByRole('combobox', { name: 'Quantity type' })).toHaveValue('number');
    expect(tray.getByRole('switch', { name: 'Crate box' })).toBeChecked();
    expect(tray.getByRole('spinbutton', { name: 'Pieces per crate' })).toHaveValue(10);
    expect(tray.getByRole('switch', { name: 'Active' })).toBeChecked();
    expect(card('Focaccia slab').getByRole('combobox', { name: 'Quantity type' })).toHaveValue('dropdown');
  });

  it('shows the pieces-per-crate box only while the crate switch is on', async () => {
    const { user } = await open('/calculator/settings/clients/roma');
    const slab = card('Focaccia slab');
    expect(slab.queryByRole('spinbutton', { name: 'Pieces per crate' })).not.toBeInTheDocument();
    await user.click(slab.getByRole('switch', { name: 'Crate box' }));
    expect(slab.getByRole('spinbutton', { name: 'Pieces per crate' })).toHaveValue(20);
    await user.click(slab.getByRole('switch', { name: 'Crate box' }));
    expect(slab.queryByRole('spinbutton', { name: 'Pieces per crate' })).not.toBeInTheDocument();
  });

  it('a legacy kg product shows «kg» and has no type or crate options', async () => {
    await open('/calculator/settings/clients/sole');
    const cheese = card('Cheese by the kilo');
    expect(cheese.getByText('kg')).toBeInTheDocument();
    expect(cheese.queryByRole('combobox', { name: 'Quantity type' })).not.toBeInTheDocument();
    expect(cheese.queryByRole('switch', { name: 'Crate box' })).not.toBeInTheDocument();
    expect(cheese.getByRole('spinbutton', { name: 'Weight in grams' })).toHaveValue(1000);
    expect(cheese.getByRole('switch', { name: 'Active' })).toBeChecked();
  });

  it('a paused product carries a «Paused» tag and an Active switch that is off', async () => {
    const { user } = await open('/calculator/settings/clients/roma');
    const paused = card('Paused loaf');
    expect(paused.getByText('Paused')).toBeInTheDocument();
    expect(paused.getByRole('switch', { name: 'Active' })).not.toBeChecked();
    expect(card('Focaccia tray').queryByText('Paused')).not.toBeInTheDocument();
    await user.click(paused.getByRole('switch', { name: 'Active' }));
    expect(paused.queryByText('Paused')).not.toBeInTheDocument();
    await user.click(card('Focaccia tray').getByRole('switch', { name: 'Active' }));
    expect(card('Focaccia tray').getByText('Paused')).toBeInTheDocument();
  });

  it('«Add product» adds an empty card on the first recipe, at 100 g, and puts the focus in its name', async () => {
    const { user } = await open('/calculator/settings/clients/sole');
    await user.click(main().getByRole('button', { name: '+ Add product' }));
    const added = within(main().getByRole('group', { name: 'Product name' }));
    expect(added.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(added.getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'Product name');
    expect(added.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(added.getByRole('combobox', { name: 'Recipe' })).toHaveValue('focaccia');
    expect(added.getByRole('spinbutton', { name: 'Weight in grams' })).toHaveValue(100);
    expect(added.getByRole('combobox', { name: 'Quantity type' })).toHaveValue('number');
    expect(added.getByRole('switch', { name: 'Crate box' })).not.toBeChecked();
    expect(added.getByRole('switch', { name: 'Active' })).toBeChecked();
    expect(saveButton()).toBeEnabled();
  });

  it('a product whose recipe was deleted shows the first recipe', async () => {
    await open('/calculator/settings/clients/roma', { config: configOf({ clients: [{ id: 'roma', name: 'Cafe Roma', products: [
      { id: 'lost', name: 'Lost one', recipeId: 'deleted', weight: 50, kind: 'number', crate: { show: false, perBox: 20 }, active: true },
    ] }] }) });
    expect(card('Lost one').getByRole('combobox', { name: 'Recipe' })).toHaveValue('focaccia');
  });

  it('deleting a product asks first: Cancel keeps it, Delete removes it', async () => {
    const { user } = await open('/calculator/settings/clients/roma');
    await user.click(card('Focaccia slab').getByRole('button', { name: 'Remove product Focaccia slab' }));
    await user.click(within(await question('Remove this product?')).getByRole('button', { name: 'Cancel' }));
    expect(main().getByRole('group', { name: 'Focaccia slab' })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.click(card('Focaccia slab').getByRole('button', { name: 'Remove product Focaccia slab' }));
    await user.click(within(await question('Remove this product?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(main().queryByRole('group', { name: 'Focaccia slab' })).not.toBeInTheDocument(); });
    expect(saveButton()).toBeEnabled();
  });
});

describe('numbers are clamped, never NaN', () => {
  it('a weight is held to 1…5000 when the box is left, and the saved value is clamped', async () => {
    const { user, source } = await open('/calculator/settings/clients/roma');
    const weight = () => card('Focaccia tray').getByRole('spinbutton', { name: 'Weight in grams' });
    await user.clear(weight());
    await user.type(weight(), '99999');
    // While it is typed, what was typed stays; once it is left, the number it stands for.
    expect(weight()).toHaveValue(99999);
    await user.tab();
    expect(weight()).toHaveValue(5000);

    await user.clear(weight());
    await user.tab();
    expect(weight()).toHaveValue(1);

    await user.clear(weight());
    await user.type(weight(), '0');
    await user.tab();
    expect(weight()).toHaveValue(1);

    await user.clear(weight());
    await user.type(weight(), '640');
    await user.tab();
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const roma = (source.savedConfigs[0]?.clients as typeof CLIENTS)[0];
    expect(roma?.products[0]?.weight).toBe(640);
  });

  it('pieces per crate are held to 1…1000, and the box starts at 20', async () => {
    const { user } = await open('/calculator/settings/clients/sole');
    const tray = card('Focaccia tray');
    await user.click(tray.getByRole('switch', { name: 'Crate box' }));
    const perBox = () => tray.getByRole('spinbutton', { name: 'Pieces per crate' });
    expect(perBox()).toHaveValue(20);
    await user.clear(perBox());
    await user.type(perBox(), '5000');
    await user.tab();
    expect(perBox()).toHaveValue(1000);
    await user.clear(perBox());
    await user.type(perBox(), '0');
    await user.tab();
    expect(perBox()).toHaveValue(1);
  });
});

describe('Save', () => {
  it('asks «Save these changes?», writes exactly the working clients, and returns to the list', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients', {
      config: configOf({ askDoughDay: false, extraDough: { brioche: false } }),
    });
    await openClient(user, 'Bar Sole');
    await user.type(nameBox(), ' Nuovo');
    await user.click(card('Focaccia tray').getByRole('switch', { name: 'Crate box' }));
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });

    expect(source.savedConfigs).toHaveLength(1);
    const saved = source.savedConfigs[0] as Record<string, unknown>;
    const clients = saved.clients as typeof CLIENTS;
    expect(clients.map(client => client.name)).toEqual(['Cafe Roma', 'Bar Sole Nuovo']);
    expect(clients[0]).toMatchObject({ id: 'roma' });
    expect(clients[1]?.products[0]).toMatchObject({ id: 'tray', crate: { show: true, perBox: 20 } });
    // Nothing else in the document moved.
    expect(saved).toMatchObject({ askDoughDay: false, extraDough: { focaccia: true, brioche: false, sourdough: true }, configModel: 4 });
    expect(saved.recipes).toHaveLength(3);

    // Saved: nothing is unsaved any more.
    expect(saveButton()).toBeDisabled();
    expect(isBusy()).toBe(false);
    await waitFor(() => { expect(rowNames()).toEqual(['Cafe Roma', 'Bar Sole Nuovo']); });
  });

  it('saved from the list (a reorder) it stays on the list', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients');
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await user.type(await main().findByRole('textbox', { name: 'Client name' }, LOAD), 'Third');
    await user.click(main().getByRole('button', { name: 'Back' }));
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(pathOf(view)).toBe('/calculator/settings/clients');
    expect((source.savedConfigs[0]?.clients as typeof CLIENTS).map(client => client.name)).toEqual(['Cafe Roma', 'Bar Sole', 'Third']);
  });

  it('writes nothing when the question is answered with Cancel', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients/roma');
    await user.type(nameBox(), '!');
    await user.click(saveButton());
    await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Cancel' }));
    expect(source.savedConfigs).toEqual([]);
    expect(pathOf(view)).toBe('/calculator/settings/clients/roma');
    expect(nameBox()).toHaveValue('Cafe Roma!');
  });

  it('writes the address book over the LATEST configuration: another phone\'s change elsewhere survives', async () => {
    const { user, source } = await open('/calculator/settings/clients/roma');
    await user.type(nameBox(), '!');
    act(() => { source.config = configOf({ askDoughDay: false, configRev: 1 }); source.push(); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(source.savedConfigs[0]).toMatchObject({ askDoughDay: false });
    expect((source.savedConfigs[0]?.clients as typeof CLIENTS)[0]?.name).toBe('Cafe Roma!');
  });

  it('clamps what is written even when a box was never left', async () => {
    const { user, source } = await open('/calculator/settings/clients/roma');
    const weight = card('Focaccia tray').getByRole('spinbutton', { name: 'Weight in grams' });
    await user.clear(weight);
    await user.type(weight, '7000');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.clients as typeof CLIENTS)[0]?.products[0]?.weight).toBe(5000);
  });

  it('a deleted client is gone from what is written', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients/sole');
    await user.click(main().getByRole('button', { name: 'Delete client Bar Sole' }));
    await user.click(within(await question('Delete this client and its products?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    await waitFor(() => { expect(rowNames()).toEqual(['Cafe Roma']); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.clients as typeof CLIENTS).map(client => client.id)).toEqual(['roma']);
  });

  it('after a refused save keeps the screen dirty with its edits, says why, and gives Save back', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients/roma');
    source.refuse.configSave = true;
    await user.type(nameBox(), '!');
    await saveAndConfirm(user);
    const dialog = await question('Not saved: this app is out of date. Reload it and try again.');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });

    expect(pathOf(view)).toBe('/calculator/settings/clients/roma');
    expect(nameBox()).toHaveValue('Cafe Roma!');
    expect(saveButton()).toBeEnabled();
    expect(isBusy()).toBe(true);

    source.refuse.configSave = false;
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    expect(source.savedConfigs).toHaveLength(2);
  });

  it('ignores a second tap on Save while the write is in the air', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients/roma');
    source.holdConfigSaves();
    await user.type(nameBox(), '!');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    await user.click(saveButton());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.savedConfigs).toHaveLength(1);
    source.settleConfigSaves();
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    expect(source.savedConfigs).toHaveLength(1);
  });
});

describe('required names', () => {
  it('opens the first client that is incomplete, marks the blank fields, says so, and focuses the first', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients');
    // Bar Sole loses its name; Cafe Roma gets a product with no name.
    await openClient(user, 'Bar Sole');
    await user.clear(nameBox());
    await user.click(main().getByRole('button', { name: 'Back' }));
    await openClient(user, 'Cafe Roma');
    await user.click(main().getByRole('button', { name: '+ Add product' }));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await openClient(user, 'Unnamed client');
    expect(nameBox()).not.toHaveAttribute('aria-invalid');

    await user.click(saveButton());
    expect(await screen.findByRole('alertdialog', { name: 'Please give every client and every product a name before saving.' }, LOAD)).toBeInTheDocument();
    // Cafe Roma comes first in the book.
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients/roma'); });
    await user.click(screen.getByRole('button', { name: 'OK' }));

    const blank = within(main().getByRole('group', { name: 'Product name' })).getByRole('textbox', { name: 'Name' });
    await waitFor(() => { expect(blank).toHaveFocus(); });
    expect(blank).toHaveAttribute('aria-invalid', 'true');
    expect(nameBox()).not.toHaveAttribute('aria-invalid');
    expect(source.savedConfigs).toEqual([]);

    // Typing a name clears the mark.
    await user.type(blank, 'Rolls');
    expect(blank).not.toHaveAttribute('aria-invalid');

    // The other client is still incomplete: Save opens it next.
    await user.click(saveButton());
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients/sole'); });
    await waitFor(() => { expect(nameBox()).toHaveFocus(); });
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(source.savedConfigs).toEqual([]);
  });

  it('a new client left without a name is incomplete too, and is not asked about when Save opens another', async () => {
    const { user, source, ...view } = await open('/calculator/settings/clients');
    await openClient(user, 'Bar Sole');
    await user.clear(nameBox());
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(main().getByRole('button', { name: '+ Add client' }));
    await main().findByRole('textbox', { name: 'Client name' }, LOAD);
    await user.click(saveButton());
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'OK' }));
    // Bar Sole (an earlier row) is opened by Save: the new client does not ask to be discarded.
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients/sole'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.savedConfigs).toEqual([]);
  });
});

describe('the quantity typed for a paused product', () => {
  const typed = () => {
    // Fresh enough that the new-work-day sweep leaves the tab alone.
    window.localStorage.setItem('touched-focaccia', String(Date.now()));
    window.localStorage.setItem('qty-roma::tray', '5');
    window.localStorage.setItem('qty-roma::paused', '7');
    window.localStorage.setItem('qty-sole::tray', '3');
  };

  it('is forgotten after a successful save, and only for the paused products', async () => {
    typed();
    const { user, source } = await open('/calculator/settings/clients/roma');
    await user.click(card('Focaccia tray').getByRole('switch', { name: 'Active' }));
    // Nothing is forgotten before Save.
    expect(window.localStorage.getItem('qty-roma::tray')).toBe('5');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    await waitFor(() => { expect(window.localStorage.getItem('qty-roma::tray')).toBeNull(); });
    expect(window.localStorage.getItem('qty-roma::paused')).toBeNull();
    expect(window.localStorage.getItem('qty-sole::tray')).toBe('3');
  });

  it('stays after a refused save', async () => {
    typed();
    const { user, source } = await open('/calculator/settings/clients/roma');
    source.refuse.configSave = true;
    await user.click(card('Focaccia tray').getByRole('switch', { name: 'Active' }));
    await saveAndConfirm(user);
    await user.click(within(await question('Not saved: this app is out of date. Reload it and try again.')).getByRole('button', { name: 'OK' }));
    expect(window.localStorage.getItem('qty-roma::tray')).toBe('5');
    expect(window.localStorage.getItem('qty-roma::paused')).toBe('7');
  });

  it('stays after a save that was cancelled', async () => {
    typed();
    const { user } = await open('/calculator/settings/clients/roma');
    await user.click(card('Focaccia tray').getByRole('switch', { name: 'Active' }));
    await user.click(saveButton());
    await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Cancel' }));
    expect(window.localStorage.getItem('qty-roma::tray')).toBe('5');
    expect(window.localStorage.getItem('qty-roma::paused')).toBe('7');
  });
});

describe('deleting a client', () => {
  it('asks first: Cancel keeps it, Delete removes it and returns to the list', async () => {
    const { user, ...view } = await open('/calculator/settings/clients/roma');
    const del = () => main().getByRole('button', { name: 'Delete client Cafe Roma' });
    await user.click(del());
    await user.click(within(await question('Delete this client and its products?')).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe('/calculator/settings/clients/roma');
    expect(saveButton()).toBeDisabled();

    await user.click(del());
    await user.click(within(await question('Delete this client and its products?')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
    await waitFor(() => { expect(rowNames()).toEqual(['Bar Sole']); });
    expect(saveButton()).toBeEnabled();
  });
});

describe('reordering', () => {
  it('a keyboard drag of the handle moves the client, enables Save, and the saved book has the new order', async () => {
    const { user, source } = await open('/calculator/settings/clients');
    // A row, then the arrow to the handle inside it (a grid keeps its tab stop on the row).
    main().getByRole('row', { name: /Bar Sole/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(main().getByRole('button', { name: 'Drag to reorder Bar Sole' })).toHaveFocus();
    await user.keyboard('{Enter}');
    // The drop places are announced: after Bar Sole, between the two, before Cafe Roma.
    expect(await screen.findByRole('button', { name: 'Insert before Cafe Roma', hidden: true }, LOAD)).toBeInTheDocument();
    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    await waitFor(() => { expect(rowNames()).toEqual(['Bar Sole', 'Cafe Roma']); });
    expect(saveButton()).toBeEnabled();
    expect(isBusy()).toBe(true);
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect((source.savedConfigs[0]?.clients as typeof CLIENTS).map(client => client.id)).toEqual(['sole', 'roma']);
  });
});

describe('waiting for the configuration', () => {
  it('draws no field and sends nothing before the venue\'s configuration has answered', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator/settings/clients/roma', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('textbox')).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(source.savedConfigs).toEqual([]);
    act(() => { source.release(); });
    expect(await main().findByRole('textbox', { name: 'Client name' }, LOAD)).toHaveValue('Cafe Roma');
  });
});

describe('in Italian', () => {
  it('says the client screen in Italian', async () => {
    const { user } = await open('/calculator/settings/clients/roma', { lang: 'it' });
    expect(main().getByRole('textbox', { name: 'Nome del cliente' })).toHaveValue('Cafe Roma');
    expect(main().getByText('Prodotti ordinati')).toBeInTheDocument();
    expect(main().getByRole('button', { name: '+ Aggiungi prodotto' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Elimina cliente Cafe Roma' })).toBeInTheDocument();
    const tray = within(main().getByRole('group', { name: 'Focaccia tray' }));
    expect(tray.getByRole('switch', { name: 'Cassa' })).toBeChecked();
    expect(tray.getByRole('spinbutton', { name: 'Peso in grammi' })).toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: 'Nome del cliente' }), '!');
    await user.click(main().getByRole('button', { name: 'Salva' }));
    await question('Vuoi salvare queste modifiche?');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });
});

describe('saving republishes the menus of the clients (parity item 69)', () => {
  const VENUE = 'Panificio Miano';

  // The menus as they stand before the save, so only what the save changes is written.
  function publishedBefore() {
    const clientOrders = fakeClientOrdersSource();
    for (const client of CLIENTS) clientOrders.menus.set(client.id, { ...menuFor(client, VENUE, 'IT') });
    return clientOrders;
  }
  const render = (path: string, clientOrders: ReturnType<typeof fakeClientOrdersSource>) => {
    const source = fakeCalculatorSource({ config: configOf() });
    const view = renderCalculator(path, {
      source,
      session: { name: VENUE, location: { country: 'IT' } },
      data: { clientOrders: () => clientOrders },
    });
    return { ...view, source };
  };
  async function ready() {
    await main().findByRole('heading', { level: 2 }, LOAD);
    await waitFor(() => { expect(main().queryByText(/^(Loading…|Caricamento…)$/)).toBeNull(); }, LOAD);
  }

  it('a product added to a client writes the menu of that client with the name and country of the venue', async () => {
    const clientOrders = publishedBefore();
    const { user, source } = render('/calculator/settings/clients/sole', clientOrders);
    await ready();
    await user.click(main().getByRole('button', { name: '+ Add product' }));
    await user.keyboard('Pizza');
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    await waitFor(() => { expect(clientOrders.menuWrites).toEqual(['sole']); });
    const menu = clientOrders.menus.get('sole') as { products: { name: string }[]; bakeryName: string; country: string };
    expect(menu.products.map(product => product.name)).toContain('Pizza');
    expect(menu.bakeryName).toBe(VENUE);
    expect(menu.country).toBe('IT');
  });

  it('a save that changes nothing a client sees writes no menu', async () => {
    const clientOrders = publishedBefore();
    // Not even a read of the menus: the fake would skip an unchanged menu by itself, so the call is what is pinned.
    const publish = vi.spyOn(clientOrders, 'publishMenus');
    const { user, source } = render('/calculator/settings/extra', clientOrders);
    await ready();
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(clientOrders.menuWrites).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });
});
