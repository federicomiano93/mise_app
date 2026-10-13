import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { NOW, logOf, versionOf } from '../testing/logFixtures';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The market order: the «Send order» door beside Dough history and Settings, the picker of lists and clients, the
// order form (a dialog) with its quantities filled in from the logs, and the message that goes down the road.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const DAY = 24 * 60 * 60 * 1000;

// Placeholder names (the fixtures in testing/renderCalculator): Cafe Roma orders a tray and a roll, Bar Sole a tray.
const MORNING = {
  id: 'wl1', title: 'Morning list',
  clients: [
    { clientId: 'roma', products: ['tray', 'roll'], extras: [{ id: 'wx-napkins', name: 'Napkins' }] },
    { clientId: 'sole', products: ['tray'], extras: [] },
  ],
};
const EVENING = { id: 'wl2', title: 'Evening list', clients: [{ clientId: 'sole', products: ['cheese'], extras: [] }] };
const DIRECT = { id: 'wc1', name: 'Corner shop', products: ['tray'], extras: [] };

const main = () => within(screen.getByRole('main'));
const form = (name = 'Morning list') => within(screen.getByRole('dialog', { name }));
// hidden: true — a form under a question is hidden from assistive technology but still there.
const formExists = (name = 'Morning list') => screen.queryByRole('dialog', { name, hidden: true }) !== null;
const box = (name: string, scope = form()) => scope.getByRole('spinbutton', { name }) as HTMLInputElement;

const logLine = (clientName: string, id: string, qty: number) => ({ id, name: id, clientName, qty });
const logWith = (id: string, createdAtMs: number, ...items: ReturnType<typeof logLine>[]) =>
  logOf(id, { createdAtMs, versions: [versionOf({ items })] });

type Options = { logs?: ({ id: string } & Record<string, unknown>)[]; lang?: 'en' | 'it'; source?: ReturnType<typeof fakeCalculatorSource> };

async function open(over: Record<string, unknown> = {}, { logs = [], lang = 'en', source = fakeCalculatorSource({ config: configOf(over), logs }) }: Options = {}) {
  const view = renderCalculator('/calculator', { source, lang });
  const door = await main().findByRole('button', { name: lang === 'it' ? 'Manda l’ordine' : 'Send order' }, LOAD);
  return { ...view, source, door };
}

const oneList = { whatsappLists: [MORNING] };

describe('the door', () => {
  it('is a fourth button beside Dough history, Settings and Orders, with an icon and no address', async () => {
    const view = await open(oneList);
    const names = main().getAllByRole('button').slice(0, 4).map(button => button.textContent);
    expect(names).toEqual(['Dough history', 'Settings', 'Client orders', 'Send order']);
    expect(view.door.querySelector('svg')).not.toBeNull();
    await view.user.click(view.door);
    expect(view.router.state.location.pathname).toBe('/calculator');
  });

  it('says nothing is set up when there are no lists and no direct clients, and takes the focus back on OK', async () => {
    const { user, door } = await open();
    await user.click(door);
    const notice = await screen.findByRole('alertdialog', { name: 'No WhatsApp lists or clients yet. Add one in Settings → WhatsApp.' });
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(door).toHaveFocus(); });
  });

  it('opens straight into the form when there is exactly one list', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    const dialog = await screen.findByRole('dialog', { name: 'Morning list' });
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Cafe Roma', 'Bar Sole']);
  });

  it('opens straight into the form when there is exactly one direct client', async () => {
    const { user, door } = await open({ whatsappClients: [DIRECT] });
    await user.click(door);
    expect(await screen.findByRole('dialog', { name: 'Corner shop' })).toBeInTheDocument();
  });

  it('says so, and opens no form, when every client of the only list has been deleted', async () => {
    const { user, door } = await open({ whatsappLists: [{ ...MORNING, clients: [{ clientId: 'gone', products: [], extras: [] }] }] });
    await user.click(door);
    expect(await screen.findByRole('alertdialog', { name: 'This list has no clients yet. Add some in Settings → WhatsApp.' })).toBeInTheDocument();
    expect(formExists()).toBe(false);
  });
});

describe('the picker', () => {
  const both = { whatsappLists: [MORNING, EVENING], whatsappClients: [DIRECT, { id: 'wc2', name: '', products: ['tray'], extras: [] }] };

  it('lists the saved lists first, then the direct clients, each a button, named «Send order»', async () => {
    const { user, door } = await open(both);
    await user.click(door);
    const picker = within(await screen.findByRole('dialog', { name: 'Send order' }));
    expect(picker.getByRole('group', { name: 'Lists' })).toBeInTheDocument();
    expect(picker.getByRole('group', { name: 'Clients' })).toBeInTheDocument();
    expect(picker.getAllByRole('button').map(button => button.textContent))
      .toEqual(['Morning list', 'Evening list', 'Corner shop', 'Unnamed client', 'Cancel']);
    const lists = picker.getByRole('group', { name: 'Lists' });
    const clients = picker.getByRole('group', { name: 'Clients' });
    // eslint-disable-next-line no-bitwise
    expect(lists.compareDocumentPosition(clients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the list picked, and the picker is gone', async () => {
    const { user, door } = await open(both);
    await user.click(door);
    await user.click(within(await screen.findByRole('dialog', { name: 'Send order' })).getByRole('button', { name: 'Evening list' }));
    expect(await screen.findByRole('dialog', { name: 'Evening list' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Send order' })).not.toBeInTheDocument();
  });

  it('opens a direct client, and warns about a list whose clients are all gone', async () => {
    const gone = { id: 'wl3', title: 'Ghost list', clients: [{ clientId: 'gone', products: [], extras: [] }] };
    const { user, door } = await open({ ...both, whatsappLists: [MORNING, gone] });
    await user.click(door);
    await user.click(within(await screen.findByRole('dialog', { name: 'Send order' })).getByRole('button', { name: 'Ghost list' }));
    expect(await screen.findByRole('alertdialog', { name: /^This list has no clients yet/ })).toBeInTheDocument();
    expect(formExists('Ghost list')).toBe(false);
  });

  it('opens a direct client from the picker', async () => {
    const { user, door } = await open(both);
    await user.click(door);
    await user.click(within(await screen.findByRole('dialog', { name: 'Send order' })).getByRole('button', { name: 'Corner shop' }));
    expect(await screen.findByRole('dialog', { name: 'Corner shop' })).toBeInTheDocument();
  });

  it('closes with Cancel and gives the focus back to the door', async () => {
    const { user, door } = await open(both);
    await user.click(door);
    await user.click(within(await screen.findByRole('dialog', { name: 'Send order' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(door).toHaveFocus(); });
  });
});

describe('the form', () => {
  it('has a section per client with a row per product, the free line last, and a labelled box in each', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    const dialog = form();
    const roma = within(await dialog.findByRole('group', { name: 'Cafe Roma' }));
    expect(roma.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Focaccia tray', 'Brioche roll', 'Napkins']);
    // Several clients: the client is in the box's name, which still starts with the label that is drawn.
    expect(box('Focaccia tray, Cafe Roma')).toHaveValue(0);
    expect(box('Focaccia tray, Bar Sole')).toHaveValue(0);
    expect(box('Napkins, Cafe Roma')).toHaveAttribute('inputmode', 'numeric');
  });

  it('names a box by its product alone when there is one client', async () => {
    const { user, door } = await open({ whatsappClients: [DIRECT] });
    await user.click(door);
    expect(box('Focaccia tray', form('Corner shop'))).toHaveValue(0);
  });

  it('empties a 0 when it is tapped and puts the 0 back when it is left empty', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    await screen.findByRole('dialog', { name: 'Morning list' });
    const tray = box('Focaccia tray, Cafe Roma');
    await user.click(tray);
    expect(tray.value).toBe('');
    await user.tab();
    expect(tray.value).toBe('0');
    await user.type(tray, '7');
    expect(tray.value).toBe('7');
  });

  it('is a labelled dialog and puts the focus back on the door when it is closed untouched', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    expect(await screen.findByRole('dialog', { name: 'Morning list' })).toBeInTheDocument();
    await user.click(form().getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(formExists()).toBe(false); });
    await waitFor(() => { expect(door).toHaveFocus(); });
  });

  it('says its words in Italian', async () => {
    const { user, door } = await open({ whatsappClients: [DIRECT] }, { lang: 'it' });
    await user.click(door);
    const dialog = form('Corner shop');
    expect(dialog.getByRole('button', { name: 'Azzera tutto' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
    expect(dialog.getByText(/Niente registrato per questi clienti ieri o oggi/)).toBeInTheDocument();
  });
});

describe('the prefill', () => {
  const NEWEST = NOW - 60_000;
  const YESTERDAY = NOW - DAY;
  const logs = () => [
    logWith('log-new', NEWEST, logLine('Cafe Roma', 'tray', 12), logLine('Cafe Roma', 'roll', 0)),
    logWith('log-old', YESTERDAY, logLine('Cafe Roma', 'tray', 99), logLine('Cafe Roma', 'roll', 7), logLine('Bar Sole', 'tray', 4)),
    logWith('log-ancient', NOW - 3 * DAY, logLine('Bar Sole', 'tray', 50)),
  ];

  it('fills each box from the NEWEST log in the window that names it, and a zero there wins', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('12');
    // The newest log says the rolls are 0: yesterday's 7 must not come back.
    expect(box('Brioche roll, Cafe Roma', form()).value).toBe('0');
    // A row the newest log does not mention falls through to an older one inside the window; three days is outside it.
    expect(box('Focaccia tray, Bar Sole', form()).value).toBe('4');
    expect(box('Napkins, Cafe Roma', form()).value).toBe('0');
  });

  it('says where the numbers came from, naming the window actually used', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    expect(form().getByText('2 quantities filled in from what you logged yesterday or today — check them before sending.')).toBeInTheDocument();
  });

  it('follows the window of the setting: «today» leaves yesterday out and says «today»', async () => {
    const { user, door } = await open({ ...oneList, orderPrefillWindow: 'today' }, { logs: logs() });
    await user.click(door);
    expect(box('Focaccia tray, Bar Sole', form()).value).toBe('0');
    expect(form().getByText('One quantity filled in from what you logged today — check it before sending.')).toBeInTheDocument();
  });

  it('says nothing was logged when the logs have arrived and hold nothing for these clients', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    expect(form().getByText('Nothing logged for these clients yesterday or today — type the quantities.')).toBeInTheDocument();
  });

  it('does NOT say «nothing logged» while the saved doughs have not arrived, and offers no number', async () => {
    const source = fakeCalculatorSource({ config: configOf(oneList), logs: logs() });
    // The logs' stream never answers: the configuration is there, the doughs are not.
    source.watchLogs = () => () => undefined;
    const { user, door } = await open({}, { source });
    await user.click(door);
    expect(form().getByText('The saved doughs have not arrived yet — type the quantities.')).toBeInTheDocument();
    expect(form().queryByText(/Nothing logged/)).not.toBeInTheDocument();
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('0');
  });

  it('says the saved doughs have not arrived in Italian', async () => {
    const source = fakeCalculatorSource({ config: configOf({ whatsappClients: [DIRECT] }) });
    source.watchLogs = () => () => undefined;
    const { user, door } = await open({}, { source, lang: 'it' });
    await user.click(door);
    expect(form('Corner shop').getByText('I registri salvati non sono ancora arrivati — scrivi tu le quantità.')).toBeInTheDocument();
  });

  // The logs answered, but only from this device's own copy (the server has not).
  const fromCopyOnly = (source: ReturnType<typeof fakeCalculatorSource>) => {
    source.watchLogs = (_since, onChange) => {
      onChange([...source.logs.values()], { fromServer: false });
      return () => undefined;
    };
  };

  it('from this device’s copy only, with numbers filled: shows the note AND a second sentence saying they may be old', async () => {
    const source = fakeCalculatorSource({ config: configOf(oneList), logs: logs() });
    fromCopyOnly(source);
    const { user, door } = await open({}, { source });
    await user.click(door);
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('12');
    expect(form().getByText(/quantities filled in from what you logged/)).toBeInTheDocument();
    expect(form().getByText('Fresh data has not arrived yet: these numbers come from this device’s copy — check them before sending.')).toBeInTheDocument();
  });

  it('from this device’s copy only, with nothing to fill: says the doughs have not arrived, never «nothing logged»', async () => {
    const source = fakeCalculatorSource({ config: configOf(oneList) });
    fromCopyOnly(source);
    const { user, door } = await open({}, { source });
    await user.click(door);
    expect(form().getByText('The saved doughs have not arrived yet — type the quantities.')).toBeInTheDocument();
    expect(form().queryByText(/Nothing logged/)).not.toBeInTheDocument();
    expect(form().queryByText(/Fresh data has not arrived/)).not.toBeInTheDocument();
  });

  it('from the server, carries no warning', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    expect(form().queryByText(/Fresh data has not arrived/)).not.toBeInTheDocument();
  });

  it('says the copy warning in Italian', async () => {
    const source = fakeCalculatorSource({ config: configOf(oneList), logs: logs() });
    fromCopyOnly(source);
    const { user, door } = await open({}, { source, lang: 'it' });
    await user.click(door);
    expect(form().getByText('I dati aggiornati non sono ancora arrivati: questi numeri vengono dalla copia di questo dispositivo — controllali prima di mandare.')).toBeInTheDocument();
  });

  it('is worked out once: a log arriving while the form is open changes no box', async () => {
    const source = fakeCalculatorSource({ config: configOf(oneList) });
    const { user, door } = await open({}, { source });
    await user.click(door);
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('0');
    source.logs.set('log-late', logWith('log-late', NEWEST, logLine('Cafe Roma', 'tray', 30)));
    source.push();
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('0');
  });
});

describe('Clear all', () => {
  const logs = () => [logWith('log-new', NOW - 60_000, logLine('Cafe Roma', 'tray', 12), logLine('Bar Sole', 'tray', 4))];

  it('asks first, and Cancel leaves every box as it was', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    await user.click(form().getByRole('button', { name: 'Clear all' }));
    const question = within(await screen.findByRole('alertdialog', { name: 'Set every quantity in this order back to 0?' }));
    await user.click(question.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('12');
  });

  it('zeroes this form’s boxes and only those', async () => {
    window.localStorage.setItem('qty-roma::tray', '4');
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    await user.click(form().getByRole('button', { name: 'Clear all' }));
    const question = within(await screen.findByRole('alertdialog'));
    await user.click(question.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('0');
    expect(box('Focaccia tray, Bar Sole', form()).value).toBe('0');
    // The Calculator’s own boxes behind the form are not touched.
    expect(window.localStorage.getItem('qty-roma::tray')).toBe('4');
  });
});

describe('closing', () => {
  const logs = () => [logWith('log-new', NOW - 60_000, logLine('Cafe Roma', 'tray', 12))];

  it('closes at once when nothing was changed by hand — the prefill alone is not a change', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    // Tapping a box and leaving it as it was is no change either.
    await user.click(box('Focaccia tray, Bar Sole', form()));
    await user.tab();
    expect(isBusy()).toBe(false);
    await user.click(form().getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(formExists()).toBe(false); });
  });

  it('asks first after a quantity was typed, and Keep leaves the form and the typing as they were', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    await user.type(box('Focaccia tray, Bar Sole', form()), '5');
    await user.click(form().getByRole('button', { name: 'Cancel' }));
    const question = within(await screen.findByRole('alertdialog', { name: 'Discard this order?' }));
    await user.click(question.getByRole('button', { name: 'Keep' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(formExists()).toBe(true);
    expect(box('Focaccia tray, Bar Sole', form()).value).toBe('5');
  });

  it('closes after Discard, gives the focus back to the door and lets go of the busy marker', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    await user.type(box('Focaccia tray, Bar Sole', form()), '5');
    expect(isBusy()).toBe(true);
    await user.click(form().getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Discard this order?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(formExists()).toBe(false); });
    expect(isBusy()).toBe(false);
    await waitFor(() => { expect(door).toHaveFocus(); });
  });

  it('asks on Escape too, and after Clear all cleared something', async () => {
    const { user, door } = await open(oneList, { logs: logs() });
    await user.click(door);
    await user.click(form().getByRole('button', { name: 'Clear all' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clear all' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    // React Aria gives the focus back to «Clear all» one animation frame after the question closes; until then it is on
    // the page, outside the form, and an Escape there reaches nobody. A person cannot press it that fast; a loaded CI
    // runner did (twice), so wait for the focus as the person would.
    await waitFor(() => { expect(form().getByRole('button', { name: 'Clear all' })).toHaveFocus(); });
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: 'Discard this order?' })).toBeInTheDocument();
  });

  it('closes at once on Escape when nothing was changed', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    await form().findByRole('button', { name: 'Cancel' });
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(formExists()).toBe(false); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Back with typed quantities asks; Keep keeps them; Discard leaves', async () => {
    const view = await open(oneList, { logs: logs() });
    await view.user.click(view.door);
    await view.user.type(box('Focaccia tray, Bar Sole', form()), '5');
    act(() => { void view.router.navigate('/stocktake'); });
    const question = within(await screen.findByRole('alertdialog', { name: 'Discard this order?' }));
    await view.user.click(question.getByRole('button', { name: 'Keep' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(view.router.state.location.pathname).toBe('/calculator');
    expect(box('Focaccia tray, Bar Sole', form()).value).toBe('5');
    act(() => { void view.router.navigate('/stocktake'); });
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Discard this order?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/stocktake'); });
    expect(isBusy()).toBe(false);
  });

  it('Back on an untouched form leaves', async () => {
    const view = await open(oneList, { logs: logs() });
    await view.user.click(view.door);
    await form().findByRole('button', { name: 'Cancel' });
    act(() => { void view.router.navigate('/stocktake'); });
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/stocktake'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks in Italian', async () => {
    const { user, door } = await open({ whatsappClients: [DIRECT] }, { lang: 'it' });
    await user.click(door);
    await user.type(box('Focaccia tray', form('Corner shop')), '2');
    await user.click(form('Corner shop').getByRole('button', { name: 'Annulla' }));
    const question = within(await screen.findByRole('alertdialog', { name: 'Vuoi buttare via questo ordine?' }));
    expect(question.getByRole('button', { name: 'Scarta' })).toBeInTheDocument();
    expect(question.getByRole('button', { name: 'Tienilo' })).toBeInTheDocument();
  });
});

describe('Send', () => {
  const WHATSAPP = 'https://wa.me/?text=';
  const sentText = (open_: ReturnType<typeof vi.spyOn>) => decodeURIComponent(String(open_.mock.calls[0]?.[0]).slice(WHATSAPP.length));

  async function pickRoad(user: ReturnType<typeof renderCalculator>['user'], name: RegExp) {
    const sheet = within(await screen.findByRole('dialog', { name: 'How do you want to send it?' }));
    await user.click(sheet.getByRole('button', { name }));
  }

  it('says there is nothing to share when every quantity is 0, and the form stays', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    await user.click(form().getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alertdialog', { name: 'No orders to share' })).toBeInTheDocument();
    expect(formExists()).toBe(true);
  });

  it('with one client filled in, closes the form and opens the road sheet with the exact message, headed by the list', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, door } = await open(oneList);
    await user.click(door);
    await user.type(box('Focaccia tray, Bar Sole', form()), '5');
    await user.click(form().getByRole('button', { name: 'Send' }));
    await waitFor(() => { expect(formExists()).toBe(false); });
    // The list has several clients, so the heading stays even though only one holds quantities.
    await pickRoad(user, /^WhatsApp/);
    expect(sentText(open_)).toBe('*Morning list*\n\n*Bar Sole*\n- Focaccia tray: 5');
    expect(open_.mock.calls[0]?.[1]).toBe('_blank');
  });

  it('sends a direct client under its own name, with no repeated heading, and the name as the mail subject', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, door } = await open({ whatsappClients: [{ ...DIRECT, extras: [{ id: 'wx-napkins', name: 'Napkins' }] }] });
    await user.click(door);
    await user.type(box('Focaccia tray', form('Corner shop')), '3');
    await user.type(box('Napkins', form('Corner shop')), '2');
    await user.click(form('Corner shop').getByRole('button', { name: 'Send' }));
    await pickRoad(user, /^Email/);
    expect(String(open_.mock.calls[0]?.[0])).toBe(
      `mailto:?subject=${encodeURIComponent('Corner shop')}&body=${encodeURIComponent('*Corner shop*\n\n- Focaccia tray: 3\n- Napkins: 2')}`,
    );
  });

  it('with several clients filled in, asks «Send to» with the form still open behind it', async () => {
    const { user, door } = await open(oneList);
    await user.click(door);
    await user.type(box('Focaccia tray, Cafe Roma', form()), '5');
    await user.type(box('Focaccia tray, Bar Sole', form()), '2');
    await user.click(form().getByRole('button', { name: 'Send' }));
    const who = within(await screen.findByRole('dialog', { name: 'Send to' }));
    expect(who.getAllByRole('button').map(button => button.textContent))
      .toEqual(['All clients together', 'Cafe Roma', 'Bar Sole', 'Cancel']);
    expect(who.getByText('Or one client')).toBeInTheDocument();

    // Cancel goes back to the form with every quantity as it was.
    await user.click(who.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Send to' })).not.toBeInTheDocument(); });
    expect(box('Focaccia tray, Cafe Roma', form()).value).toBe('5');
    expect(box('Focaccia tray, Bar Sole', form()).value).toBe('2');
  });

  it('sends everything together under the list’s title with a heading per client', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, door } = await open(oneList);
    await user.click(door);
    await user.type(box('Focaccia tray, Cafe Roma', form()), '5');
    await user.type(box('Focaccia tray, Bar Sole', form()), '2');
    await user.click(form().getByRole('button', { name: 'Send' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Send to' })).getByRole('button', { name: 'All clients together' }));
    await waitFor(() => { expect(formExists()).toBe(false); });
    await pickRoad(user, /^WhatsApp/);
    expect(sentText(open_)).toBe('*Morning list*\n\n*Cafe Roma*\n- Focaccia tray: 5\n\n*Bar Sole*\n- Focaccia tray: 2');
  });

  it('sends one client on its own under that client’s name, with no heading and only its lines', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, door } = await open(oneList);
    await user.click(door);
    await user.type(box('Focaccia tray, Cafe Roma', form()), '5');
    await user.type(box('Focaccia tray, Bar Sole', form()), '2');
    await user.click(form().getByRole('button', { name: 'Send' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Send to' })).getByRole('button', { name: 'Bar Sole' }));
    await pickRoad(user, /^WhatsApp/);
    expect(sentText(open_)).toBe('*Bar Sole*\n\n- Focaccia tray: 2');
  });

  it('is not a «discard»: sending asks no question, and the busy marker is let go', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, door } = await open({ whatsappClients: [DIRECT] });
    await user.click(door);
    await user.type(box('Focaccia tray', form('Corner shop')), '3');
    expect(isBusy()).toBe(true);
    await user.click(form('Corner shop').getByRole('button', { name: 'Send' }));
    await screen.findByRole('dialog', { name: 'How do you want to send it?' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });

  it('gives the focus back to the door when the road sheet is cancelled', async () => {
    const { user, door } = await open({ whatsappClients: [DIRECT] });
    await user.click(door);
    await user.type(box('Focaccia tray', form('Corner shop')), '3');
    await user.click(form('Corner shop').getByRole('button', { name: 'Send' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'How do you want to send it?' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(door).toHaveFocus(); });
  });
});
