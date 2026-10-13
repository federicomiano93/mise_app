import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Session } from '../session/session';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import type { FakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { CLIENTS, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// A client's ordering link, on the client's screen: the states it can be in, who may do what, and every tap that
// writes to the database.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const group = () => within(main().getByRole('group', { name: 'Ordering link' }));
const alertWith = (text: string | RegExp) => screen.findByRole('alertdialog', undefined, LOAD).then(dialog => {
  expect(dialog).toHaveTextContent(text);
  return within(dialog);
});
const LINK = 'order.html#b=bakery&k=tok-roma';
const ROMA = { uid: 'old-uid', clientId: 'roma', clientName: 'Cafe Roma', createdAt: '', linkToken: 'tok-roma' };
const MANAGER_NOT: Partial<Session> = { canManage: false, isOwner: false, role: 'staff' };

type Options = {
  accounts?: typeof ROMA[];
  session?: Partial<Session>;
  config?: Record<string, unknown>;
  path?: string;
  lang?: 'en' | 'it';
  orderSource?: FakeClientOrdersSource;
  writeText?: (text: string) => Promise<void>;
};

async function open({ accounts = [], session, config = configOf(), path = '/calculator/settings/clients/roma', lang = 'en', orderSource, writeText }: Options = {}) {
  const clientOrders = orderSource ?? fakeClientOrdersSource({ accounts });
  const view = renderCalculator(path, {
    source: fakeCalculatorSource({ config }),
    lang,
    data: { clientOrders: () => clientOrders },
    ...(session ? { session } : {}),
  });
  const copied = vi.fn<(text: string) => Promise<void>>(writeText ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: copied }, configurable: true });
  // The name box is told apart by its label in English only; any textbox shows the client screen is up.
  if (path.endsWith('/clients')) await main().findByRole('button', { name: '+ Add client' }, LOAD);
  else await main().findAllByRole('textbox', undefined, LOAD);
  return { ...view, clientOrders, copied };
}

// The group once the links have been read.
async function ready() {
  await waitFor(() => { expect(main().queryByRole('group', { name: 'Ordering link' })?.textContent).not.toContain('Loading…'); }, LOAD);
}

describe('the states', () => {
  it('says «Loading…» while the links are being read, then the hint', async () => {
    const orderSource = fakeClientOrdersSource();
    let release: () => void = () => undefined;
    const real = orderSource.listAccounts.bind(orderSource);
    orderSource.listAccounts = () => new Promise(resolve => { release = () => { void real().then(resolve); }; });
    await open({ orderSource });
    expect(group().getByText('Loading…')).toBeInTheDocument();
    expect(group().queryByRole('button')).toBeNull();
    release();
    expect(await group().findByText(/^Create a link and send it to this client/)).toBeInTheDocument();
  });

  it('says the links could not be read, and offers NO «Create» (it could cut off a working link)', async () => {
    const orderSource = fakeClientOrdersSource({ accounts: [ROMA] });
    orderSource.refuse.accounts = true;
    await open({ orderSource });
    expect(await group().findByText('The ordering links could not be read. Check your connection and open this client again.')).toBeInTheDocument();
    expect(group().queryByRole('button')).toBeNull();
  });

  it('says «Save your changes first» while the editor holds an unsaved change, with no button', async () => {
    const { user, clientOrders } = await open({ accounts: [ROMA] });
    await ready();
    expect(group().getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: 'Client name' }), 'x');
    expect(group().getByText('Save your changes first — the link shows this client the products as they are saved.')).toBeInTheDocument();
    expect(group().queryByRole('button')).toBeNull();
    expect(clientOrders.menuWrites).toEqual([]);
  });

  it('a client added and never saved gets the same sentence', async () => {
    const { user } = await open({ path: '/calculator/settings/clients' });
    await user.click(await main().findByRole('button', { name: '+ Add client' }, LOAD));
    await main().findByRole('textbox', { name: 'Client name' }, LOAD);
    expect(group().getByText('Save your changes first — the link shows this client the products as they are saved.')).toBeInTheDocument();
    expect(group().queryByRole('button')).toBeNull();
  });

  it('reads the links again when the save completes, so a just-saved client is known', async () => {
    const orderSource = fakeClientOrdersSource();
    const reads = vi.spyOn(orderSource, 'listAccounts');
    const { user } = await open({ orderSource });
    await ready();
    expect(reads).toHaveBeenCalledTimes(1);
    await user.type(main().getByRole('textbox', { name: 'Client name' }), '!');
    await user.click(main().getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save these changes?' }, LOAD)).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(reads.mock.calls.length).toBeGreaterThanOrEqual(2); }, LOAD);
  });
});

describe('the hint and who may do what', () => {
  it('a client with a link: the hint, Copy, Send, Replace and Turn off, for a manager', async () => {
    await open({ accounts: [ROMA] });
    await ready();
    expect(group().getByText(/^Cafe Roma can send orders straight into the app\./)).toBeInTheDocument();
    expect(group().getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(group().getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(group().getByRole('button', { name: 'Replace with a new link' })).toBeInTheDocument();
    expect(group().getByRole('button', { name: 'Turn off ordering' })).toBeInTheDocument();
    expect(group().queryByRole('button', { name: '+ Create ordering link' })).toBeNull();
  });

  it('a client without a link: a manager is offered «Create», and nothing to copy or send', async () => {
    await open();
    await ready();
    expect(group().getByText(/^Create a link and send it to this client/)).toBeInTheDocument();
    expect(group().getByRole('button', { name: '+ Create ordering link' })).toBeInTheDocument();
    expect(group().queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(group().queryByRole('button', { name: 'Send' })).toBeNull();
    expect(group().queryByRole('button', { name: 'Turn off ordering' })).toBeNull();
  });

  it('somebody who cannot manage sees Copy and Send but not Create, Replace or Turn off', async () => {
    await open({ accounts: [ROMA], session: MANAGER_NOT });
    await ready();
    expect(group().getByText(/^Cafe Roma can send orders straight into the app\./)).toBeInTheDocument();
    expect(group().getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(group().getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(group().queryByRole('button', { name: 'Replace with a new link' })).toBeNull();
    expect(group().queryByRole('button', { name: 'Turn off ordering' })).toBeNull();
  });

  it('somebody who cannot manage, on a client without a link, is told the owner or a manager can set it up', async () => {
    await open({ session: MANAGER_NOT });
    await ready();
    expect(group().getByText('This client cannot order through the app yet. The owner or a manager can set that up.')).toBeInTheDocument();
    expect(group().queryByRole('button')).toBeNull();
  });

  it('a client whose id is not a valid order client id is never offered «Create» (the store would refuse)', async () => {
    const config = configOf({ clients: [{ id: 'bad_id', name: 'Odd Client', products: [] }, ...CLIENTS] });
    await open({ config, path: '/calculator/settings/clients/bad_id' });
    await ready();
    // Whoever looks, the reason is the id, not the role: a manager is not told to ask a manager.
    expect(group().getByText('This client cannot have an ordering link until it has been saved.')).toBeInTheDocument();
    expect(group().queryByText(/owner or a manager/)).toBeNull();
    expect(group().queryByRole('button')).toBeNull();
  });

  it('the same sentence for somebody who cannot manage, in Italian too', async () => {
    const config = configOf({ clients: [{ id: 'bad_id', name: 'Odd Client', products: [] }, ...CLIENTS] });
    await open({ config, path: '/calculator/settings/clients/bad_id', session: MANAGER_NOT, lang: 'it' });
    await waitFor(() => { expect(main().queryByRole('group', { name: 'Link per ordinare' })?.textContent).not.toContain('Caricamento'); }, LOAD);
    expect(within(main().getByRole('group', { name: 'Link per ordinare' })).getByText('Questo cliente non può avere un link per ordinare finché non è stato salvato.')).toBeInTheDocument();
  });

  it('a grant without its secret cannot be shown: no Copy or Send, only Replace', async () => {
    await open({ accounts: [{ ...ROMA, linkToken: null as unknown as string }] });
    await ready();
    expect(group().queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(group().getByRole('button', { name: 'Replace with a new link' })).toBeInTheDocument();
  });

  it('says its words in Italian', async () => {
    await open({ accounts: [ROMA], lang: 'it' });
    await waitFor(() => { expect(main().queryByRole('group', { name: 'Link per ordinare' })?.textContent).not.toContain('Caricamento'); }, LOAD);
    const italian = within(main().getByRole('group', { name: 'Link per ordinare' }));
    expect(italian.getByRole('button', { name: 'Copia il link' })).toBeInTheDocument();
    expect(italian.getByRole('button', { name: 'Sostituisci con un nuovo link' })).toBeInTheDocument();
    expect(italian.getByRole('button', { name: 'Disattiva gli ordini' })).toBeInTheDocument();
  });
});

describe('a failure in the link', () => {
  it('stays inside the group: the rest of the client screen, with its edits, keeps working', async () => {
    // A grant whose secret cannot be turned into a link makes the group throw while it draws.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = await open({ accounts: [{ ...ROMA, linkToken: Symbol('broken') as unknown as string }] });
    expect(await main().findByText('The rest of the screen works.', undefined, LOAD)).toBeInTheDocument();
    const name = main().getByRole('textbox', { name: 'Client name' });
    await user.type(name, '!');
    expect(name).toHaveValue('Cafe Roma!');
    expect(main().getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('copy and send', () => {
  it('Copy puts the link on the clipboard and says so', async () => {
    const { user, copied } = await open({ accounts: [ROMA] });
    await ready();
    await user.click(group().getByRole('button', { name: 'Copy link' }));
    const dialog = await alertWith('The ordering link for Cafe Roma is copied. Paste it into a message.');
    expect(copied).toHaveBeenCalledTimes(1);
    expect(String(copied.mock.calls[0]?.[0])).toContain(LINK);
    expect(String(copied.mock.calls[0]?.[0])).toMatch(/^https?:\/\/[^/]+\/order\.html#/);
    await user.click(dialog.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('when the clipboard does not take it, the link is spelled out to copy by hand', async () => {
    const { user } = await open({ accounts: [ROMA], writeText: () => Promise.reject(new Error('denied')) });
    await ready();
    await user.click(group().getByRole('button', { name: 'Copy link' }));
    const dialog = await alertWith(/^Copy this link and send it to Cafe Roma:/);
    expect(dialog.getByText(new RegExp(`order\\.html#b=bakery&k=tok-roma$`))).toBeInTheDocument();
  });

  it('Send opens the «which road» sheet with the client\'s name and the VENUE\'S name in the message', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await open({ accounts: [ROMA] });
    await ready();
    await user.click(group().getByRole('button', { name: 'Send' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'How do you want to send it?' }, LOAD));
    await user.click(sheet.getByRole('button', { name: /WhatsApp/ }));
    expect(opened).toHaveBeenCalledTimes(1);
    const url = String(opened.mock.calls[0]?.[0]);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(url.slice('https://wa.me/?text='.length));
    expect(text).toMatch(/^Hello Cafe Roma, you can send your order to Bakery here: https?:\/\/[^/]+\/order\.html#b=bakery&k=tok-roma$/);
  });

  it('Send by mail carries the client\'s name as the subject; a venue with no name says «us»', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await open({ accounts: [ROMA], session: { name: '' } });
    await ready();
    await user.click(group().getByRole('button', { name: 'Send' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'How do you want to send it?' }, LOAD));
    await user.click(sheet.getByRole('button', { name: /Email/ }));
    const url = String(opened.mock.calls[0]?.[0]);
    expect(url).toContain('mailto:?subject=Cafe%20Roma&body=');
    expect(decodeURIComponent(url)).toContain('you can send your order to us here:');
  });

  it('Copy and Send work for somebody who cannot manage', async () => {
    const { user, copied } = await open({ accounts: [ROMA], session: MANAGER_NOT });
    await ready();
    await user.click(group().getByRole('button', { name: 'Copy link' }));
    await alertWith('The ordering link for Cafe Roma is copied.');
    expect(copied).toHaveBeenCalledTimes(1);
  });
});

describe('creating and replacing', () => {
  it('Create makes the link, publishes the menu, shows the new buttons and copies the link', async () => {
    const { user, clientOrders, copied } = await open();
    await ready();
    await user.click(group().getByRole('button', { name: '+ Create ordering link' }));
    const dialog = await alertWith('The ordering link for Cafe Roma is copied. Paste it into a message.');
    expect([...clientOrders.accounts.values()].map(account => account.clientId)).toEqual(['roma']);
    expect(clientOrders.menuWrites).toEqual(['roma']);
    expect(String(copied.mock.calls[0]?.[0])).toContain('order.html#b=bakery&k=token-uid-1');
    await user.click(dialog.getByRole('button', { name: 'OK' }));
    expect(group().getByRole('button', { name: 'Replace with a new link' })).toBeInTheDocument();
    expect(group().getByRole('button', { name: 'Turn off ordering' })).toBeInTheDocument();
    expect(group().getByText(/^Cafe Roma can send orders straight into the app\./)).toBeInTheDocument();
  });

  it('a failure is said, nothing is created, and the button comes back', async () => {
    const orderSource = fakeClientOrdersSource();
    orderSource.refuse.create = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, clientOrders } = await open({ orderSource });
    await ready();
    await user.click(group().getByRole('button', { name: '+ Create ordering link' }));
    const dialog = await alertWith('Could not create the link. Check your connection and try again.');
    await user.click(dialog.getByRole('button', { name: 'OK' }));
    expect(clientOrders.accounts.size).toBe(0);
    expect(group().getByRole('button', { name: '+ Create ordering link' })).toBeEnabled();
  });

  it('Replace asks first, in the danger style, and Cancel changes nothing', async () => {
    const { user, clientOrders } = await open({ accounts: [ROMA] });
    await ready();
    await user.click(group().getByRole('button', { name: 'Replace with a new link' }));
    const question = await screen.findByRole('alertdialog', { name: 'Replace this link?' }, LOAD);
    expect(question).toHaveTextContent('Cafe Roma’s current link will stop working immediately, including on a phone that is using it right now.');
    expect(within(question).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect([...clientOrders.accounts.keys()]).toEqual(['old-uid']);
    expect(clientOrders.menuWrites).toEqual([]);
  });

  it('Replace, confirmed, mints a new link and the old grant goes', async () => {
    const { user, clientOrders, copied } = await open({ accounts: [ROMA] });
    await ready();
    await user.click(group().getByRole('button', { name: 'Replace with a new link' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Replace this link?' }, LOAD)).getByRole('button', { name: 'Replace' }));
    await alertWith('The ordering link for Cafe Roma is copied.');
    expect([...clientOrders.accounts.keys()]).toEqual(['uid-1']);
    expect(String(copied.mock.calls[0]?.[0])).toContain('k=token-uid-1');
  });
});

describe('turning ordering off', () => {
  it('asks first, and Cancel keeps the link', async () => {
    const { user, clientOrders } = await open({ accounts: [ROMA] });
    await ready();
    await user.click(group().getByRole('button', { name: 'Turn off ordering' }));
    const question = await screen.findByRole('alertdialog', { name: /^Stop Cafe Roma sending orders through the app\?/ }, LOAD);
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(clientOrders.accounts.size).toBe(1);
  });

  it('removes the grant, and the group offers «Create» again', async () => {
    const { user, clientOrders } = await open({ accounts: [ROMA] });
    await ready();
    await user.click(group().getByRole('button', { name: 'Turn off ordering' }));
    const question = await screen.findByRole('alertdialog', { name: /^Stop Cafe Roma sending orders through the app\?/ }, LOAD);
    expect(question).toHaveTextContent('Their link will stop working. Orders they have already sent are kept.');
    await user.click(within(question).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => { expect(clientOrders.accounts.size).toBe(0); });
    expect(await group().findByRole('button', { name: '+ Create ordering link' })).toBeInTheDocument();
    expect(group().queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('a failure is said and the link stays', async () => {
    const orderSource = fakeClientOrdersSource({ accounts: [ROMA] });
    orderSource.refuse.revoke = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, clientOrders } = await open({ orderSource });
    await ready();
    await user.click(group().getByRole('button', { name: 'Turn off ordering' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: /^Stop Cafe Roma/ }, LOAD)).getByRole('button', { name: 'Turn off' }));
    await alertWith('Could not turn it off. Check your connection and try again.');
    expect(clientOrders.accounts.size).toBe(1);
  });
});
