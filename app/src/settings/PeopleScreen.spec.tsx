import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { joinLinkFor } from '@mise/shared/join-link';
import type { Session } from '../session/session';
import { isBusy } from '../session/busy';
import { FAKE_DIGITS, FAKE_LINK_TOKEN, fakeSettingsSource } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';
import { ACTION_EVENT } from '../telemetry/usage';
import type { Invitation } from './settingsSource';

// «Who can get in» (staff slice 3): the full owner invites someone, role first. The specs check who sees the row and the address, that
// no role is chosen at the start and none after Done, that six digits are offered for an employee only, the two results (shown once),
// Send / Copy / Done, the refusals in the app's own words, the focus and Back, and that the code never reaches the console.

const main = () => within(screen.getByRole('main'));
const LINK = joinLinkFor(FAKE_LINK_TOKEN);

// The five roles, as the session holds them (shared/src/membership.ts). A head chef holds the manager value.
const ROLES: Readonly<Record<string, Partial<Session>>> = {
  owner: { role: 'owner', canManage: true, canManageVenue: true, isOwner: true },
  'owner-sales': { role: 'owner-sales', canManage: true, canManageVenue: false, isOwner: false },
  'owner-kitchen': { role: 'owner-kitchen', canManage: true, canManageVenue: false, isOwner: false },
  manager: { role: 'manager', canManage: true, canManageVenue: true, isOwner: false },
  staff: { role: 'staff', canManage: false, canManageVenue: false, isOwner: false },
};
const NOT_OWNERS = ['owner-sales', 'owner-kitchen', 'manager', 'staff'] as const;

let consoleCalls: unknown[][] = [];

beforeEach(() => {
  consoleCalls = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleCalls.push(args); });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

async function open(options: NonNullable<Parameters<typeof renderApp>[1]> = {}, source: FakeSettingsSource = fakeSettingsSource()) {
  const view = renderApp('/settings/people', { ...options, data: { settings: () => source } });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Chi può entrare' : 'Who can get in' });
  return { ...view, source };
}

const radios = () => screen.getAllByRole('radio');
const radio = (name: string) => screen.getByRole('radio', { name });

describe('who sees «Who can get in»', () => {
  it('is a row of «The venue» for the full owner, a whole row with its sentence', () => {
    renderApp('/settings');
    const venue = main().getByRole('heading', { level: 2, name: 'The venue' }).closest('section') as HTMLElement;
    const row = within(venue).getByRole('link', { name: 'Who can get in' });
    expect(row).toHaveAttribute('href', '/settings/people');
    expect(row).toHaveAccessibleDescription('Invite someone who works here, with the role you choose.');
  });

  it.each(NOT_OWNERS)('is not drawn for the role %s', role => {
    renderApp('/settings', { session: ROLES[role] });
    expect(main().queryByRole('link', { name: 'Who can get in' })).not.toBeInTheDocument();
  });

  it('opens for the full owner by its address', async () => {
    const { router } = await open({ session: ROLES['owner'] });
    expect(router.state.location.pathname).toBe('/settings/people');
    expect(radios()).toHaveLength(6);
  });

  it.each(NOT_OWNERS)('sends the role %s back to the Settings page when its address is typed', async role => {
    const source = fakeSettingsSource();
    const { router } = renderApp('/settings/people', { session: ROLES[role], data: { settings: () => source } });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Who can get in' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(source.createInvitation).not.toHaveBeenCalled();
  });
});

describe('the screen', () => {
  it('has one h1 (Settings), its own h2, and the intro', async () => {
    await open();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(main().getByText(/Add someone who works here\. They install the app and create their own account/)).toBeInTheDocument();
  });

  it('opens from the page on its title, and Back hands the focus to the row', async () => {
    const { router, user } = renderApp('/settings', { data: { settings: () => fakeSettingsSource() } });
    await user.click(main().getByRole('link', { name: 'Who can get in' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Who can get in' });
    await waitFor(() => { expect(title).toHaveFocus(); });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => { expect(main().getByRole('link', { name: 'Who can get in' })).toHaveFocus(); });
  });

  it('goes Back by the keyboard alone', async () => {
    const { router, user } = renderApp('/settings', { data: { settings: () => fakeSettingsSource() } });
    main().getByRole('link', { name: 'Who can get in' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 2, name: 'Who can get in' });
    screen.getByRole('button', { name: 'Back' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
  });

  it('opened by its address, Back replaces it with the page', async () => {
    const { router, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('choosing the role', () => {
  it('offers the six choices, each with what it can do, and none chosen at the start', async () => {
    await open();
    expect(screen.getByRole('radiogroup', { name: 'Role' })).toBeInTheDocument();
    expect(radios().map(item => item.closest('label')?.querySelector('span span')?.textContent))
      .toEqual(['Owner', 'Sales owner', 'Kitchen owner', 'Manager', 'Head chef', 'Employee']);
    for (const item of radios()) expect(item).not.toBeChecked();
    expect(radio('Employee')).toHaveAccessibleDescription('Does the daily work — quantities, doughs, orders. Cannot delete things or add people.');
    expect(radio('Head chef')).toHaveAccessibleDescription(/^The same as Manager — it is only the job title that differs\./);
    expect(main().getByText('Choose the role first: it decides what they can do in the app.')).toBeInTheDocument();
  });

  it('sends nothing without a role: it says what is missing and puts the keyboard on the list', async () => {
    const { user, source } = await open();
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    expect(source.createInvitation).not.toHaveBeenCalled();
    expect(main().getByText('Choose the role first, then send the link or read out the code.')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    expect(radio('Owner')).toHaveFocus();
    // The focus chose nothing.
    for (const item of radios()) expect(item).not.toBeChecked();

    await user.click(main().getByRole('button', { name: 'Read out a code' }));
    expect(source.createInvitation).not.toHaveBeenCalled();
  });

  it('clears the missing-role sentence once a role is chosen', async () => {
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await user.click(radio('Employee'));
    expect(radio('Employee')).toBeChecked();
    expect(screen.getByRole('radiogroup')).not.toHaveAttribute('aria-invalid');
    expect(main().queryByText('Choose the role first, then send the link or read out the code.')).not.toBeInTheDocument();
  });

  it('offers six digits for an employee only, and says why the button went', async () => {
    const { user } = await open();
    // No role yet: both ways are shown.
    expect(main().getByRole('button', { name: 'Read out a code' })).toBeInTheDocument();
    for (const name of ['Owner', 'Sales owner', 'Kitchen owner', 'Manager', 'Head chef']) {
      await user.click(radio(name));
      expect(main().queryByRole('button', { name: 'Read out a code' }), name).not.toBeInTheDocument();
      expect(main().getByText('A manager, a head chef or an owner is invited with a link. A six-digit code is for employees only.')).toBeInTheDocument();
      expect(main().getByRole('button', { name: 'Send a link' })).toBeInTheDocument();
    }
    await user.click(radio('Employee'));
    expect(main().getByRole('button', { name: 'Read out a code' })).toBeInTheDocument();
    expect(main().queryByText(/A six-digit code is for employees only/)).not.toBeInTheDocument();
  });
});

describe('a link', () => {
  it('is made for the role chosen, title included, and shown once with Send, Copy and Done', async () => {
    const { user, source } = await open();
    await user.click(radio('Head chef'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));

    expect(source.createInvitation).toHaveBeenCalledExactlyOnceWith('manager', 'head-chef', 'link');
    const intro = await main().findByText('Send this link to them. It works once, and when they open it they choose their own email and password.');
    await waitFor(() => { expect(intro).toHaveFocus(); });
    expect(main().getByText(LINK)).toBeInTheDocument();
    expect(LINK).toMatch(/\/index\.html#join=Q7xk2mP9vR4tY8wZ1nB6cD3fG5hJ0sLa$/);
    expect(main().getByText('Joins as head chef · 24 hours left')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Copy the link' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Done' })).toBeInTheDocument();
    // The choosing is gone while the result is on screen.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it.each([
    ['Owner', 'owner', null, 'owner'],
    ['Sales owner', 'owner-sales', null, 'sales owner'],
    ['Kitchen owner', 'owner-kitchen', null, 'kitchen owner'],
    ['Manager', 'manager', 'manager', 'manager'],
    ['Employee', 'staff', null, 'employee'],
  ] as const)('is made for %s as the server is asked', async (name, role, title, inSentence) => {
    const { user, source } = await open();
    await user.click(radio(name));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    expect(source.createInvitation).toHaveBeenCalledExactlyOnceWith(role, title, 'link');
    expect(await main().findByText(`Joins as ${inSentence} · 24 hours left`)).toBeInTheDocument();
  });

  it('says the role the SERVER made, not the one asked for', async () => {
    const source = fakeSettingsSource();
    source.createInvitation = vi.fn(async (): Promise<Invitation> => ({
      code: FAKE_LINK_TOKEN, kind: 'link', role: 'staff', title: null, expiresAt: Date.now() + 3 * 60 * 60 * 1000,
    }));
    const { user } = await open({}, source);
    await user.click(radio('Manager'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    expect(await main().findByText('Joins as employee · 3 hours left')).toBeInTheDocument();
  });

  it('Send asks how, and hands over a message naming the venue, with the link', async () => {
    const popup = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await open({ session: { name: 'Panificio Miano' } });
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await user.click(await main().findByRole('button', { name: 'Send' }));

    const sheet = await screen.findByRole('dialog', { name: 'How do you want to send it?' });
    await user.click(within(sheet).getByRole('button', { name: 'WhatsApp — I choose the chat' }));
    expect(popup).toHaveBeenCalledTimes(1);
    const url = String(popup.mock.calls[0]?.[0]);
    const text = decodeURIComponent(url.replace('https://wa.me/?text=', ''));
    expect(text).toBe(`Hi! Here is your way in to Panificio Miano. Open this link and choose your own password; once you are in, the app will show you how to add it to your phone: ${LINK}`);
    // The result is still there: sending is not the end of it.
    expect(main().getByText(LINK)).toBeInTheDocument();
  });

  it('Copy puts the link on the clipboard and says so', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    const { user } = await open();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await user.click(await main().findByRole('button', { name: 'Copy the link' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText('The link is copied. Paste it into a message to them.')).toBeInTheDocument();
  });

  it('Copy that the clipboard refuses shows the link to copy by hand', async () => {
    const { user } = await open();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await user.click(await main().findByRole('button', { name: 'Copy the link' }));
    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText('Copy this link and send it to them:')).toBeInTheDocument();
    expect(within(notice).getByText(LINK)).toBeInTheDocument();
  });

  it('Done forgets it, starts again with no role, and puts the keyboard on the first choice', async () => {
    const { user } = await open();
    await user.click(radio('Owner'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await user.click(await main().findByRole('button', { name: 'Done' }));

    expect(main().queryByText(LINK)).not.toBeInTheDocument();
    expect(radios()).toHaveLength(6);
    for (const item of radios()) expect(item).not.toBeChecked();
    await waitFor(() => { expect(radio('Owner')).toHaveFocus(); });
    expect(main().getByText('Choose the role first: it decides what they can do in the app.')).toBeInTheDocument();
  });

  it('is gone after leaving the screen and coming back: it is shown once', async () => {
    const { user } = await open();
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await main().findByText(LINK);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await main().findByRole('link', { name: 'Who can get in' }));
    await screen.findByRole('heading', { level: 2, name: 'Who can get in' });
    expect(main().queryByText(LINK)).not.toBeInTheDocument();
    for (const item of radios()) expect(item).not.toBeChecked();
  });
});

describe('six digits', () => {
  it('are made for an employee and shown big, with the role, the time left and what to tap', async () => {
    const { user, source } = await open();
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Read out a code' }));

    expect(source.createInvitation).toHaveBeenCalledExactlyOnceWith('staff', null, 'digits');
    const lead = await main().findByText('Read this out to them:');
    await waitFor(() => { expect(lead).toHaveFocus(); });
    expect(main().getByText(FAKE_DIGITS)).toBeInTheDocument();
    expect(main().getByText('Joins as employee · 24 hours left · they open the app, tap “I have a join code”, create their account and type it.')).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Copy the link' })).not.toBeInTheDocument();

    await user.click(main().getByRole('button', { name: 'Done' }));
    expect(main().queryByText(FAKE_DIGITS)).not.toBeInTheDocument();
    for (const item of radios()) expect(item).not.toBeChecked();
  });
});

describe('while the invitation is made', () => {
  it('turns the buttons and the roles off, says so, and makes ONE call however often it is tapped', async () => {
    const source = fakeSettingsSource();
    let answer: (invitation: Invitation) => void = () => undefined;
    source.createInvitation = vi.fn(() => new Promise<Invitation>(done => { answer = done; }));
    const { user } = await open({}, source);
    await user.click(radio('Employee'));
    const status = within(screen.getByRole('heading', { level: 2, name: 'Who can get in' }).closest('section') as HTMLElement).getByRole('status');
    expect(status).toHaveTextContent('');

    await user.click(main().getByRole('button', { name: 'Read out a code' }));
    expect(status).toHaveTextContent('Making the invitation…');
    expect(main().getByRole('button', { name: 'Read out a code' })).toBeDisabled();
    expect(main().getByRole('button', { name: 'Send a link' })).toBeDisabled();
    for (const item of radios()) expect(item).toBeDisabled();
    await user.click(main().getByRole('button', { name: 'Read out a code' }));
    expect(source.createInvitation).toHaveBeenCalledTimes(1);

    await act(async () => { answer({ code: FAKE_DIGITS, kind: 'digits', role: 'staff', title: null, expiresAt: Date.now() + 86_400_000 }); });
    expect(await main().findByText(FAKE_DIGITS)).toBeInTheDocument();
  });

  it('holds the busy marker while the call is in the air and while the result is on screen, and lets go at Done', async () => {
    const source = fakeSettingsSource();
    let answer: (invitation: Invitation) => void = () => undefined;
    source.createInvitation = vi.fn(() => new Promise<Invitation>(done => { answer = done; }));
    const { user } = await open({}, source);
    await user.click(radio('Employee'));
    // A role chosen is nothing unsaved.
    expect(isBusy()).toBe(false);
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    expect(isBusy()).toBe(true);
    await act(async () => { answer({ code: FAKE_LINK_TOKEN, kind: 'link', role: 'staff', title: null, expiresAt: Date.now() + 86_400_000 }); });
    await main().findByText(LINK);
    expect(isBusy()).toBe(true);
    await user.click(main().getByRole('button', { name: 'Done' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('lets go of the busy marker when the screen is left with the result on it', async () => {
    const { user } = await open();
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await main().findByText(LINK);
    expect(isBusy()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('counts the invitation in the usage record, by name only', async () => {
    const actions: unknown[] = [];
    const listen = (event: Event) => { actions.push((event as CustomEvent).detail); };
    window.addEventListener(ACTION_EVENT, listen);
    try {
      const { user } = await open();
      await user.click(radio('Employee'));
      await user.click(main().getByRole('button', { name: 'Read out a code' }));
      await main().findByText(FAKE_DIGITS);
      expect(actions).toEqual(['join-code-made']);
    } finally {
      window.removeEventListener(ACTION_EVENT, listen);
    }
  });

  it('never writes the code or the link to the console', async () => {
    const { user, source } = await open();
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Read out a code' }));
    await main().findByText(FAKE_DIGITS);
    await user.click(main().getByRole('button', { name: 'Done' }));
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await main().findByText(LINK);
    source.functionsFailWith = Object.assign(new Error('internal'), { code: 'functions/internal' });
    await user.click(main().getByRole('button', { name: 'Done' }));
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    await screen.findByRole('alertdialog');
    const written = JSON.stringify(consoleCalls.map(args => args.map(String)));
    expect(written).not.toContain(FAKE_DIGITS);
    expect(written).not.toContain(FAKE_LINK_TOKEN);
  });
});

describe('refusals, in the app’s own words', () => {
  const CASES = [
    ['functions/permission-denied', 'Only the owner can invite people.', 'Solo il titolare può invitare persone.'],
    ['functions/failed-precondition', 'A manager, a head chef or an owner is invited with a link. A six-digit code is for employees only.',
      'Un responsabile, uno chef di cucina o un titolare si invita con un link. Il codice di sei cifre è solo per i dipendenti.'],
    ['functions/unavailable', 'Could not make a code. Check your connection and try again.', 'Non è stato possibile creare un codice. Controlla la connessione e riprova.'],
    ['functions/deadline-exceeded', 'Could not make a code. Check your connection and try again.', 'Non è stato possibile creare un codice. Controlla la connessione e riprova.'],
    ['functions/internal', 'Could not make the invitation. Try again in a moment.', 'Non è stato possibile creare l’invito. Riprova tra un momento.'],
  ] as const;
  const ROWS = CASES.flatMap(([code, english, italian]) => [
    ['en', code, english, 'Send a link', 'Employee'],
    ['it', code, italian, 'Manda un link', 'Dipendente'],
  ] as const);

  it.each(ROWS)('in %s, %s is said in the app’s words, and the focus goes back to the button', async (lang, code, sentence, button, role) => {
    const source = fakeSettingsSource();
    // The server's own English must never be what is shown.
    source.functionsFailWith = Object.assign(new Error('Only the owner can do that.'), { code });
    const { user } = await open({ lang }, source);
    await user.click(radio(role));
    await user.click(main().getByRole('button', { name: button }));
    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText(sentence)).toBeInTheDocument();
    expect(within(notice).queryByText('Only the owner can do that.')).not.toBeInTheDocument();
    expect(isBusy()).toBe(false);
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(main().getByRole('button', { name: button })).toHaveFocus(); });
    // Nothing was made: the choosing is still there, with the role kept.
    expect(radio(role)).toBeChecked();
  });

  it('a malformed answer from the server is a failure, never half a screen', async () => {
    const source = fakeSettingsSource();
    source.createInvitation = vi.fn(() => Promise.reject(new Error('The invitation answer was not an invitation.')));
    const { user } = await open({}, source);
    await user.click(radio('Employee'));
    await user.click(main().getByRole('button', { name: 'Send a link' }));
    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText('Could not make the invitation. Try again in a moment.')).toBeInTheDocument();
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(main().queryByText(/#join=/)).not.toBeInTheDocument();
    expect(radio('Employee')).toBeChecked();
  });
});

describe('in Italian', () => {
  it('names the screen, the roles and the buttons', async () => {
    const { user } = await open({ lang: 'it', session: { language: 'it' } });
    expect(screen.getByRole('radiogroup', { name: 'Ruolo' })).toBeInTheDocument();
    expect(radios().map(item => item.closest('label')?.querySelector('span span')?.textContent))
      .toEqual(['Titolare', 'Titolare vendita', 'Titolare cucina', 'Responsabile', 'Chef di cucina', 'Dipendente']);
    expect(main().getByText('Scegli prima il ruolo: decide cosa potrà fare nell’app.')).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Manda un link' }));
    expect(main().getByText('Prima scegli il ruolo, poi manda il link o detta il codice.')).toBeInTheDocument();

    await user.click(radio('Dipendente'));
    await user.click(main().getByRole('button', { name: 'Detta un codice' }));
    expect(await main().findByText('Leggilo a voce a loro:')).toBeInTheDocument();
    expect(main().getByText('Entra come dipendente · scade fra 24 ore · apre l’app, tocca “Ho un codice di accesso”, crea il suo account e digita il codice.')).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Fatto' }));

    await user.click(radio('Chef di cucina'));
    expect(main().getByText('Un responsabile, uno chef di cucina o un titolare si invita con un link. Il codice di sei cifre è solo per i dipendenti.')).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Manda un link' }));
    expect(await main().findByText('Entra come chef di cucina · scade fra 24 ore')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Manda' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Copia il link' })).toBeInTheDocument();
  });

  it('is the row «Chi può entrare» on the Settings page', () => {
    renderApp('/settings', { lang: 'it' });
    expect(main().getByRole('link', { name: 'Chi può entrare' })).toHaveAccessibleDescription('Invita chi lavora qui, con il ruolo che scegli tu.');
  });
});
