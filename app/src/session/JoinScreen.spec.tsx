import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { redeemFailureText } from '@mise/shared/join-code';
import { install } from '../telemetry/errorReport';
import { ACTION_EVENT, SCREEN_EVENT } from '../telemetry/usage';
import { memoryStorage, renderWithSession } from '../testing/renderWithSession';
import { findSpokenAlert, spokenAlerts } from '../testing/spokenAlert';
import { isBusy } from './busy';
import { createJoinFlow, PENDING_INVITE_KEY } from './joinFlow';
import { JoinScreen } from './JoinScreen';
import type { Language } from '../i18n/i18n';
import type { Session } from './session';

// The join form of a signed-in account (staff slice 1). It is a port of joinScreen in js/auth-gate.js; what these specs pin
// is what the plan asks of it (docs/parity/staff-plan.md): it names the account, it checks every field before the network,
// it STAYS on screen until the server answers (fix 9e0a2dac), every refusal is said in the app's own words, success opens
// the venue, Back asks before throwing typing away and forgets the invitation — and the code is never logged.

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const NO_ACCESS: Partial<Session> = { status: 'no-access', locationId: null, location: null, options: [] };

const fnError = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { code: `functions/${code}`, details });

// Everything that could carry the code somewhere it must not go: every console method; the REAL error reporter's
// listeners (install() wraps console.error and listens for uncaught errors and rejections — what it would send is collected
// here); and the usage line's screen and action names.
const heard: unknown[] = [];
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
install({ report: entry => { heard.push(entry); } }, window, console);
const record = (event: Event) => {
  heard.push(event instanceof CustomEvent ? event.detail : (event as ErrorEvent).message ?? String((event as PromiseRejectionEvent).reason));
};
beforeEach(() => {
  heard.length = 0;
  // Called through: console.error reaches the reporter's wrapper underneath. Nothing is expected to call any of them.
  for (const method of METHODS) vi.spyOn(console, method);
  for (const type of ['error', 'unhandledrejection', SCREEN_EVENT, ACTION_EVENT]) window.addEventListener(type, record);
});
afterEach(() => {
  for (const type of ['error', 'unhandledrejection', SCREEN_EVENT, ACTION_EVENT]) window.removeEventListener(type, record);
  vi.restoreAllMocks();
});
const nothingHeardOf = (...secrets: string[]) => {
  const said = [...heard, ...METHODS.map(method => vi.mocked(console[method]).mock.calls)];
  const all = JSON.stringify(said, (_key, value: unknown) => (value instanceof Error ? `${value.message} ${value.stack}` : value));
  for (const secret of secrets) expect(all).not.toContain(secret);
};

test('the watch works: what reaches console.error is what the error reporter would send', () => {
  console.error('probe 777111');
  expect(JSON.stringify(heard)).toContain('777111');
  heard.length = 0;
});

function draw({ invited = '', session = NO_ACCESS, lang = 'en' }: { invited?: string; session?: Partial<Session>; lang?: Language } = {}) {
  const storage = memoryStorage(invited ? { [PENDING_INVITE_KEY]: invited } : {});
  const flow = createJoinFlow(storage);
  if (!invited) flow.openForm();
  const view = renderWithSession(<JoinScreen />, { session, joinFlow: flow, lang });
  return { ...view, storage };
}

async function fill(user: ReturnType<typeof draw>['user'], { first = 'Luca', last = 'Rossi', code = '' } = {}) {
  if (first) await user.type(screen.getByLabelText('Your first name'), first);
  if (last) await user.type(screen.getByLabelText('Your surname'), last);
  if (code) await user.type(screen.getByLabelText('Code'), code);
}

describe('JoinScreen: what it says', () => {
  test('typed by hand: «Enter your code», with the account the code will join', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your code' })).toBeInTheDocument();
    expect(screen.getByText('Type the code you were given.')).toBeInTheDocument();
    expect(screen.getByText('The code will be used for this account:')).toBeInTheDocument();
    expect(screen.getByText('owner@club.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a different account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText('Code')).toHaveAttribute('inputmode', 'numeric');
  });

  test('arrived by link: «You have been invited», the code filled in', () => {
    draw({ invited: TOKEN });
    expect(screen.getByRole('heading', { level: 1, name: 'You have been invited' })).toBeInTheDocument();
    expect(screen.getByText('Your code is already filled in. Add your name to finish.')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue(TOKEN);
    expect(screen.getByLabelText('Code')).toHaveAttribute('inputmode', 'text');
  });

  test('the form is described by the account it is for, and the cursor starts in the first name', () => {
    draw();
    expect(screen.getByLabelText('Your first name')).toHaveFocus();
    const form = screen.getByLabelText('Your first name').closest('form');
    expect(form).toHaveAttribute('aria-describedby', 'join-for-account join-for-address');
  });

  test('speaks Italian', () => {
    draw({ lang: 'it' });
    expect(screen.getByRole('heading', { level: 1, name: 'Inserisci il codice' })).toBeInTheDocument();
    expect(screen.getByText('Il codice verrà usato per questo account:')).toBeInTheDocument();
    expect(screen.getByLabelText('Il tuo nome')).toBeInTheDocument();
    expect(screen.getByLabelText('Il tuo cognome')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accedi con un altro account' })).toBeInTheDocument();
  });
});

describe('JoinScreen: every field checked before the network', () => {
  test.each([
    ['the first name', { first: '' }, 'Your first name', 'Enter your first name.'],
    ['the surname', { last: '' }, 'Your surname', 'Enter your surname.'],
    ['a first name of punctuation', { first: '--' }, 'Your first name', 'That first name needs letters in it.'],
    ['the code', { code: '' }, 'Code', 'Enter your six-digit code, or open the link you were sent.'],
    ['a code of the wrong shape', { code: '12345' }, 'Code', 'Enter your six-digit code, or open the link you were sent.'],
  ])('%s: blocked, the cursor on it, outlined, and the reason under it', async (_name, fields, label, message) => {
    const { user, store } = draw();
    await fill(user, { code: '123456', ...fields });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
    expect(screen.getByLabelText(label)).toHaveFocus();
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    expect(await findSpokenAlert()).toHaveTextContent(message);
  });

  test('typing in the field clears its problem', async () => {
    const { user } = draw();
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByLabelText('Your first name')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('Your first name'), 'L');
    expect(screen.getByLabelText('Your first name')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('Enter in the last box sends the form', async () => {
    const { user, store } = draw();
    await fill(user, { code: '123456' });
    await user.keyboard('{Enter}');
    expect(store.redeemJoinCode).toHaveBeenCalledOnce();
  });
});

describe('JoinScreen: sending', () => {
  test('six digits typed with spaces are sent as six digits, with the name', async () => {
    const { user, store } = draw();
    await fill(user, { code: '123 456' });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(store.redeemJoinCode).toHaveBeenCalledWith('123456', 'digits', 'Luca', 'Rossi');
  });

  test('a link’s token is sent as a link, its case kept', async () => {
    const { user, store } = draw({ invited: TOKEN });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(store.redeemJoinCode).toHaveBeenCalledWith(TOKEN, 'link', 'Luca', 'Rossi');
  });

  // ⚠️⚠️ FIX 9e0a2dac: the form stays, unchanged, until the server answers.
  test('the form STAYS on screen until the answer: Join pending, the boxes read-only, no way out, nothing reloads', async () => {
    const { user, store, flow } = draw();
    let answer: (value: string) => void = () => {};
    store.redeemJoinCode.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    // The live region is there, empty, BEFORE it speaks (a region inserted already filled is not announced reliably).
    const waitRegion = screen.getByRole('status');
    expect(waitRegion).toBeEmptyDOMElement();
    await fill(user, { code: '123456' });
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(screen.getByRole('status')).toHaveTextContent('Checking…');
    expect(screen.getByRole('status')).toBe(waitRegion);
    expect(screen.getByRole('button', { name: /Join/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('Your first name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Code')).toHaveValue('123456');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with a different account' })).toBeDisabled();
    expect(isBusy()).toBe(true);
    expect(flow.getSnapshot().sent).toEqual({ busy: true, invited: '' });

    await act(async () => { answer('joined'); });
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'u1'); });
    expect(isBusy()).toBe(false);
  });

  test('success opens the venue the server named, and the invitation is forgotten everywhere', async () => {
    const { user, store, flow, storage } = draw({ invited: TOKEN });
    let opened: () => void = () => {};
    store.openJoinedVenue.mockImplementation(() => new Promise(resolve => { opened = resolve; }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'u1'); });
    // Forgotten the moment it was used, before the venue has even opened.
    expect(flow.getSnapshot().invited).toBe('');
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('You’re in. Opening…');
    await act(async () => { opened(); });
    expect(flow.getSnapshot()).toMatchObject({ open: false, sent: null });
    nothingHeardOf(TOKEN);
  });
});

describe('JoinScreen: a joined venue that does not open on this page', () => {
  test('the join is not reported as a failure: the invitation is closed and the page starts again', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const { user, store, flow } = draw({ invited: TOKEN });
    store.openJoinedVenue.mockRejectedValue(new Error('boom'));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => { expect(reload).toHaveBeenCalledOnce(); });
    expect(spokenAlerts()).toEqual([]);
    expect(flow.getSnapshot()).toMatchObject({ invited: '', open: false });
    expect(isBusy()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('JoinScreen: one call per answer', () => {
  test('a second submit while the first is in the air is not a second call (each spends one of five tries an hour)', async () => {
    const { user, store } = draw();
    let refuse: (error: unknown) => void = () => {};
    store.redeemJoinCode.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    await fill(user, { code: '123456' });
    const form = screen.getByLabelText('Code').closest('form');
    act(() => {
      form?.requestSubmit();
      form?.requestSubmit();
    });
    await user.keyboard('{Enter}');
    expect(store.redeemJoinCode).toHaveBeenCalledOnce();
    // The answer: the form is sendable again, and a new tap is a new call.
    await act(async () => { refuse(fnError('permission-denied', 'x')); });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(store.redeemJoinCode).toHaveBeenCalledTimes(2);
    await act(async () => { refuse(fnError('permission-denied', 'x')); });
    expect(isBusy()).toBe(false);
  });
});

describe('JoinScreen: under React’s StrictMode (the dev server mounts every screen twice)', () => {
  test('a refusal is still said and the form comes back', async () => {
    const flow = createJoinFlow(memoryStorage());
    flow.openForm();
    const { user, store } = renderWithSession(<StrictMode><JoinScreen /></StrictMode>, { session: NO_ACCESS, joinFlow: flow });
    store.redeemJoinCode.mockRejectedValue(fnError('permission-denied', 'x'));
    await fill(user, { code: '123456' });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await findSpokenAlert()).toHaveTextContent('That code does not work. Ask for a new one.');
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });
});

describe('JoinScreen: a newer invitation opened while the code is checked', () => {
  test('is kept, whatever the answer to the older one', async () => {
    const NEWER = 'zZ9dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
    const { user, store, flow } = draw({ invited: TOKEN });
    let answer: (value: string) => void = () => {};
    store.redeemJoinCode.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    act(() => { flow.remember(NEWER); });
    await act(async () => { answer('joined'); });
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalled(); });
    expect(flow.getSnapshot().invited).toBe(NEWER);
  });
});

describe('JoinScreen: every refusal, in the app’s own words', () => {
  test.each([
    ['a code that does not work', fnError('permission-denied', redeemFailureText('expired')), 'That code does not work. Ask for a new one.'],
    ['already in this business', fnError('failed-precondition', redeemFailureText('already-member'), { reason: 'already-member' }),
      'You are already in this business. A code cannot change what you can do here.'],
    ['six digits paused', fnError('resource-exhausted', redeemFailureText('digits-paused', 1), { reason: 'digits-paused' }),
      'Six-digit codes are paused for a while, for safety. Ask for an invitation link instead.'],
    ['too many tries', fnError('resource-exhausted', redeemFailureText('rate-limited', 7 * 60_000)), 'Too many tries. Wait 7 minutes and try again.'],
    ['too many tries, one minute', fnError('resource-exhausted', redeemFailureText('rate-limited', 1)), 'Too many tries. Wait 1 minute and try again.'],
    ['too many tries, no number', fnError('resource-exhausted', 'Quota'), 'Too many tries. Wait a while and try again.'],
    ['no answer', fnError('unavailable', 'unavailable'), 'Could not reach the server. Check the connection and try again.'],
    ['a timeout', fnError('deadline-exceeded', 'deadline-exceeded'), 'Could not reach the server. Check the connection and try again.'],
    ['anything else', fnError('internal', 'INTERNAL'), 'Could not check the code. Try again in a moment.'],
  ])('%s', async (_name, error, words) => {
    const { user, store } = draw();
    store.redeemJoinCode.mockRejectedValue(error);
    await fill(user, { code: '654321' });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await findSpokenAlert()).toHaveTextContent(words);
    // Still the same form, everything in its boxes, ready for another try.
    expect(screen.getByLabelText('Your first name')).toHaveValue('Luca');
    expect(screen.getByLabelText('Code')).toHaveValue('654321');
    expect(screen.getByRole('button', { name: 'Join' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(store.openJoinedVenue).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
    nothingHeardOf('654321');
  });

  test.each([
    [fnError('permission-denied', 'x'), 'Questo codice non funziona. Chiedine uno nuovo.'],
    [fnError('resource-exhausted', redeemFailureText('rate-limited', 3 * 60_000)), 'Troppi tentativi. Aspetta 3 minuti e riprova.'],
    [fnError('failed-precondition', 'x', { reason: 'already-member' }), 'Sei già dentro questa attività. Un codice non può cambiare cosa puoi fare qui.'],
    [fnError('unavailable', 'x'), 'Non riesco a raggiungere il server. Controlla la connessione e riprova.'],
  ])('in Italian: %#', async (error, words) => {
    const { user, store } = draw({ lang: 'it' });
    store.redeemJoinCode.mockRejectedValue(error);
    await user.type(screen.getByLabelText('Il tuo nome'), 'Luca');
    await user.type(screen.getByLabelText('Il tuo cognome'), 'Rossi');
    await user.type(screen.getByLabelText('Codice'), '123456');
    await user.click(screen.getByRole('button', { name: 'Entra' }));
    expect(await findSpokenAlert()).toHaveTextContent(words);
  });

  test('«already in this business» drops the invitation, which no retry could change', async () => {
    const { user, store, flow, storage } = draw({ invited: TOKEN });
    store.redeemJoinCode.mockRejectedValue(fnError('failed-precondition', 'x', { reason: 'already-member' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await findSpokenAlert();
    expect(flow.getSnapshot().invited).toBe('');
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
    expect(flow.getSnapshot().sent).toEqual({ busy: false, invited: TOKEN });
  });

  test('any other refusal keeps the invitation (the link may be retried after a dropped signal)', async () => {
    const { user, store, flow } = draw({ invited: TOKEN });
    store.redeemJoinCode.mockRejectedValue(fnError('unavailable', 'x'));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await findSpokenAlert();
    expect(flow.getSnapshot().invited).toBe(TOKEN);
    nothingHeardOf(TOKEN);
  });

  // ⚠️ A live region inserted already filled is not announced reliably: the alert is in the page, empty, before it speaks.
  test('the alert is there empty before the answer, and the same one is filled by each refusal', async () => {
    const { user, store } = draw();
    store.redeemJoinCode.mockRejectedValue(fnError('permission-denied', 'x'));
    const region = screen.getAllByRole("alert").find(el => el.className.includes("notice")) as HTMLElement;
    expect(region).toBeEmptyDOMElement();
    await fill(user, { code: '123456' });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => { expect(region).toHaveTextContent('That code does not work. Ask for a new one.'); });
    expect(screen.getAllByRole('alert')).toContain(region);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => { expect(region).toHaveTextContent('That code does not work. Ask for a new one.'); });
    expect(screen.getAllByRole('alert')).toContain(region);
  });
});

describe('JoinScreen: Back', () => {
  test('nothing typed: Back closes the form and forgets the invitation at once', async () => {
    const { user, flow, storage } = draw({ invited: TOKEN });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(flow.getSnapshot()).toMatchObject({ invited: '', open: false, returned: true });
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
  });

  // P20: confirm before discarding typed input.
  test('with typing: «Discard changes?» first; Cancel keeps everything', async () => {
    const { user, flow } = draw();
    await fill(user, { code: '12' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(flow.getSnapshot().open).toBe(true);
    expect(screen.getByLabelText('Code')).toHaveValue('12');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(flow.getSnapshot().open).toBe(false);
  });

  test('a code from a link that was changed is typing too', async () => {
    const { user } = draw({ invited: TOKEN });
    await user.type(screen.getByLabelText('Code'), 'x');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
  });
});
