import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { install } from '../telemetry/errorReport';
import { ACTION_EVENT, SCREEN_EVENT } from '../telemetry/usage';
import { memoryStorage, renderWithSession } from '../testing/renderWithSession';
import { findSpokenAlert, spokenAlerts } from '../testing/spokenAlert';
import { isBusy } from './busy';
import { createJoinFlow, PENDING_INVITE_KEY } from './joinFlow';
import { JoinScreen } from './JoinScreen';
import type { Language } from '../i18n/i18n';
import type { Session } from './session';

// The join form for a NEW account (staff slice 2, docs/parity/staff-plan.md): reached signed out, it adds the email twice and
// the password twice; every box is checked before ANY call (the sign-up cannot be undone, and each code check spends one of
// five tries an hour); the account is created, then the code is checked, in that order, once per tap; an email that already
// has an account gets «Sign in with that email»; and when the account was created but the code refused, the form comes back
// FOR THAT ACCOUNT with the reason (current-app fix 9e0a2dac). Neither the code nor the password is ever logged.

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const PASSWORD = 'Tr1cky-Secret-42';
const SIGNED_OUT: Partial<Session> = { status: 'signed-out', user: null, locationId: null, location: null, options: [] };
const PASSWORD_LABEL = 'Choose a password (at least 10 characters)';

const fnError = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { code: `functions/${code}`, details });
const authError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

// Everything that could carry a secret somewhere it must not go: every console method, the REAL error reporter's listeners,
// and the usage line's screen and action names (as JoinScreen.spec.tsx watches them).
const heard: unknown[] = [];
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
install({ report: entry => { heard.push(entry); } }, window, console);
const record = (event: Event) => {
  heard.push(event instanceof CustomEvent ? event.detail : (event as ErrorEvent).message ?? String((event as PromiseRejectionEvent).reason));
};
beforeEach(() => {
  heard.length = 0;
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

function draw({ invited = '', lang = 'en' }: { invited?: string; lang?: Language } = {}) {
  const storage = memoryStorage(invited ? { [PENDING_INVITE_KEY]: invited } : {});
  const flow = createJoinFlow(storage);
  if (!invited) flow.openForm();
  const view = renderWithSession(<JoinScreen />, { session: SIGNED_OUT, joinFlow: flow, lang });
  return { ...view, storage };
}

type User = ReturnType<typeof draw>['user'];

async function fill(user: User, {
  first = 'Anna', last = 'Bianchi', email = 'anna.b@club.test', email2 = email, password = PASSWORD, password2 = password,
  code = '',
}: Partial<Record<'first' | 'last' | 'email' | 'email2' | 'password' | 'password2' | 'code', string>> = {}) {
  if (first) await user.type(screen.getByLabelText('Your first name'), first);
  if (last) await user.type(screen.getByLabelText('Your surname'), last);
  if (email) await user.type(screen.getByLabelText('Your email'), email);
  if (email2) await user.type(screen.getByLabelText('Repeat your email'), email2);
  if (password) await user.type(screen.getByLabelText(PASSWORD_LABEL), password);
  if (password2) await user.type(screen.getByLabelText('Repeat the password'), password2);
  if (code) await user.type(screen.getByLabelText('Code'), code);
}

const join = () => screen.getByRole('button', { name: 'Join' });

describe('the form for a new account: what it says', () => {
  test('typed by hand: «Join with a code», email twice, password twice, no account named', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1, name: 'Join with a code' })).toBeInTheDocument();
    expect(screen.getByText('Create your account, then type the code you were given.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Your email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Repeat your email')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText(PASSWORD_LABEL)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(PASSWORD_LABEL)).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Repeat the password')).toHaveAttribute('type', 'password');
    expect(screen.queryByText('The code will be used for this account:')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with a different account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with that email' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to install the app' })).toHaveAttribute('href', new URL('install-guide.html', window.location.href).href);
  });

  test('arrived by link: «You have been invited», the code filled in', () => {
    draw({ invited: TOKEN });
    expect(screen.getByRole('heading', { level: 1, name: 'You have been invited' })).toBeInTheDocument();
    expect(screen.getByText('Your code is already filled in. Add your name and choose a password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue(TOKEN);
  });

  test('in Italian', () => {
    draw({ lang: 'it' });
    expect(screen.getByRole('heading', { level: 1, name: 'Entra con un codice' })).toBeInTheDocument();
    expect(screen.getByLabelText('La tua email')).toBeInTheDocument();
    expect(screen.getByLabelText('Ripeti la tua email')).toBeInTheDocument();
    expect(screen.getByLabelText('Scegli una password (almeno 10 caratteri)')).toBeInTheDocument();
    expect(screen.getByLabelText('Ripeti la password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Come installare l’app' })).toBeInTheDocument();
  });
});

describe('every box is checked before anything is sent', () => {
  const cases: Array<[string, Parameters<typeof fill>[1], string, string]> = [
    ['no email', { email: '', email2: '' }, 'Your email', 'Enter your email.'],
    ['the email not repeated', { email2: '' }, 'Repeat your email', 'Type your email again in the box below.'],
    ['two different emails', { email2: 'anna.c@club.test' }, 'Repeat your email', 'The two emails do not match. Check them.'],
    ['no password', { password: '', password2: '' }, PASSWORD_LABEL, 'Choose a password.'],
    ['a short password', { password: 'short', password2: 'short' }, PASSWORD_LABEL, 'Make it at least 10 characters — length is what keeps it safe.'],
    ['an obvious password', { password: 'P@ssw0rd!!', password2: 'P@ssw0rd!!' }, PASSWORD_LABEL, 'That one is guessed first. Pick something only you would think of.'],
    ['the email as the password', { password: 'anna.b-kitchen', password2: 'anna.b-kitchen' }, PASSWORD_LABEL, 'Do not use your email address as your password.'],
    ['the password not repeated', { password2: '' }, 'Repeat the password', 'Type the password again in the box below.'],
    ['two different passwords', { password2: `${PASSWORD}x` }, 'Repeat the password', 'The two passwords do not match. Type them again.'],
    ['no code', {}, 'Code', 'Enter your six-digit code, or open the link you were sent.'],
  ];
  test.each(cases)('%s: the box is marked, the reason is under it, the cursor is there, and nothing is called', async (_name, typed, label, words) => {
    const { user, store } = draw();
    await fill(user, { code: '123456', ...typed, ...(label === 'Code' ? { code: '' } : {}) });
    await user.click(join());
    const box = screen.getByLabelText(label);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(words);
    expect(box).toHaveFocus();
    expect(store.signUp).not.toHaveBeenCalled();
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
  });

  test('the name comes first, as on the form', async () => {
    const { user, store } = draw();
    await fill(user, { first: '', email: '', email2: '', code: '123456' });
    await user.click(join());
    expect(screen.getByLabelText('Your first name')).toHaveFocus();
    expect(store.signUp).not.toHaveBeenCalled();
  });
});

describe('joining with a new account', () => {
  test('the account is made, then the code is checked, then the venue opens for THAT account — one of each per tap', async () => {
    const { user, store } = draw();
    const order: string[] = [];
    store.signUp.mockImplementation(async email => { order.push('signUp'); return { uid: 'new-uid', email, isAnonymous: false }; });
    store.redeemJoinCode.mockImplementation(async () => { order.push('redeem'); return 'joined'; });
    store.openJoinedVenue.mockImplementation(async () => { order.push('open'); });
    await fill(user, { email2: 'Anna.B@club.test', code: '123 456' });
    await user.dblClick(join());
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalled(); });
    expect(order).toEqual(['signUp', 'redeem', 'open']);
    expect(store.signUp).toHaveBeenCalledWith('anna.b@club.test', PASSWORD);
    expect(store.redeemJoinCode).toHaveBeenCalledWith('123456', 'digits', 'Anna', 'Bianchi');
    expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'new-uid');
    nothingHeardOf(PASSWORD, '123456');
  });

  test('while it runs: «Creating your account…», then «Checking your code…»; boxes read-only, Back off, reloads held', async () => {
    const { user, store } = draw();
    let made: (value: { uid: string; email: string; isAnonymous: boolean }) => void = () => {};
    let answer: (lid: string) => void = () => {};
    store.signUp.mockImplementation(() => new Promise(resolve => { made = resolve; }));
    store.redeemJoinCode.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    await fill(user, { code: '123456' });
    await user.click(join());
    expect(screen.getByRole('status')).toHaveTextContent('Creating your account…');
    expect(screen.getByLabelText('Your email')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    // Leaving the page now would cut the join off half-way: the guide's door is off too.
    expect(screen.getByRole('link', { name: 'How to install the app' })).toHaveAttribute('aria-disabled', 'true');
    expect(isBusy()).toBe(true);
    await act(async () => { made({ uid: 'new-uid', email: 'anna.b@club.test', isAnonymous: false }); });
    expect(screen.getByRole('status')).toHaveTextContent('Checking your code…');
    // ⚠️ The passwords are dropped from memory the moment the account exists.
    expect(screen.getByLabelText(PASSWORD_LABEL)).toHaveValue('');
    expect(screen.getByLabelText('Repeat the password')).toHaveValue('');
    await act(async () => { answer('joined'); });
    expect(screen.getByRole('status')).toHaveTextContent('You’re in. Opening…');
  });

  test('the invitation is forgotten the moment the code is accepted', async () => {
    const { user, flow, storage } = draw({ invited: TOKEN });
    await fill(user);
    await user.click(join());
    await waitFor(() => { expect(flow.getSnapshot().invited).toBe(''); });
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
    nothingHeardOf(TOKEN, PASSWORD);
  });
});

describe('an email that already has an account', () => {
  test('is said on the email box, and «Sign in with that email» appears; nothing else is called', async () => {
    const { user, store } = draw();
    store.signUp.mockRejectedValueOnce(authError('auth/email-already-in-use'));
    await fill(user, { code: '123456' });
    await user.click(join());
    const box = await screen.findByLabelText('Your email');
    await waitFor(() => { expect(box).toHaveAttribute('aria-invalid', 'true'); });
    expect(box).toHaveAccessibleDescription('That email already has an account. Sign in with it instead.');
    expect(box).toHaveFocus();
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in with that email' })).toBeInTheDocument();
    // Typing another address takes the way out away again: it was about that address.
    await user.type(box, 'x');
    expect(screen.queryByRole('button', { name: 'Sign in with that email' })).not.toBeInTheDocument();
  });

  test('«Sign in with that email» goes to the sign-in form with the address, and the invitation goes along', async () => {
    const { user, store, flow, storage } = draw({ invited: TOKEN });
    store.signUp.mockRejectedValueOnce(authError('auth/email-already-in-use'));
    await fill(user);
    await user.click(join());
    await user.click(await screen.findByRole('button', { name: 'Sign in with that email' }));
    expect(flow.getSnapshot()).toMatchObject({ signInFirst: true, signInEmail: 'anna.b@club.test', invited: TOKEN, open: false });
    expect(storage.map.get(PENDING_INVITE_KEY)).toBe(TOKEN);
  });

  test('no connection is said in the alert, and the form is ready again', async () => {
    const { user, store } = draw();
    store.signUp.mockRejectedValueOnce(authError('auth/network-request-failed'));
    await fill(user, { code: '123456' });
    await user.click(join());
    expect(await findSpokenAlert()).toHaveTextContent('No connection. The first sign-in on a device needs internet.');
    expect(join()).toBeEnabled();
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
  });
});

describe('the account was created, and only the code was refused', () => {
  test('the form comes back FOR THAT ACCOUNT: named, no email or password boxes, name and code kept, the reason said, the cursor on the code', async () => {
    const { user, store } = draw();
    store.redeemJoinCode.mockRejectedValueOnce(fnError('permission-denied', 'That code does not work.'));
    await fill(user, { code: '123456' });
    await user.click(join());
    const alert = await findSpokenAlert();
    expect(alert).toHaveTextContent('That code does not work. Ask for a new one.');
    expect(screen.getByText('The code will be used for this account:')).toBeInTheDocument();
    expect(screen.getByText('anna.b@club.test')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(PASSWORD_LABEL)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your code' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your first name')).toHaveValue('Anna');
    const code = screen.getByLabelText('Code');
    expect(code).toHaveValue('123456');
    await waitFor(() => { expect(code).toHaveFocus(); });
    expect(code).toHaveAccessibleDescription('That code does not work. Ask for a new one.');
    expect(screen.getByRole('button', { name: 'Sign in with a different account' })).toBeInTheDocument();
    nothingHeardOf(PASSWORD, '123456');
  });

  test('a second try checks the code again for that account, and never makes a second account', async () => {
    const { user, store } = draw();
    store.redeemJoinCode.mockRejectedValueOnce(fnError('permission-denied', 'That code does not work.'));
    await fill(user, { code: '123456' });
    await user.click(join());
    await findSpokenAlert();
    const code = screen.getByLabelText('Code');
    await user.clear(code);
    await user.type(code, '654321');
    await user.click(join());
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'new-uid'); });
    expect(store.signUp).toHaveBeenCalledOnce();
    expect(store.redeemJoinCode).toHaveBeenLastCalledWith('654321', 'digits', 'Anna', 'Bianchi');
  });

  test('the same refusal twice is spoken twice', async () => {
    const { user, store } = draw();
    store.redeemJoinCode.mockRejectedValue(fnError('permission-denied', 'That code does not work.'));
    await fill(user, { code: '123456' });
    await user.click(join());
    await findSpokenAlert();
    await user.click(join());
    await waitFor(() => { expect(store.redeemJoinCode).toHaveBeenCalledTimes(2); });
    expect(await findSpokenAlert()).toHaveTextContent('That code does not work. Ask for a new one.');
    expect(spokenAlerts()).toHaveLength(1);
  });
});

describe('the ways out', () => {
  test('Back with nothing typed, opened by «I have a join code»: back to sign-in, nothing to keep', async () => {
    const { user, flow } = draw();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(flow.getSnapshot()).toMatchObject({ open: false, signInFirst: false });
  });

  // ⚠️ The person who already has an account reaches sign-in by Back: the link goes with them (the current app's way).
  test('Back on an invitation: to sign-in, the invitation KEPT for after the sign-in', async () => {
    const { user, flow, storage } = draw({ invited: TOKEN });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(flow.getSnapshot()).toMatchObject({ signInFirst: true, invited: TOKEN });
    expect(storage.map.get(PENDING_INVITE_KEY)).toBe(TOKEN);
  });

  test('Back with something typed asks first', async () => {
    const { user, flow } = draw();
    await user.type(screen.getByLabelText(PASSWORD_LABEL), 'x');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(flow.getSnapshot().open).toBe(true);
  });

  // ⚠️ A sign-up now would replace that person's session in every tab (code review, 13 Nov 2026).
  test('somebody signed in from another tab: the form becomes the form for that account, nothing is created', async () => {
    const { store, flow } = draw({ invited: TOKEN });
    const before = flow.getSnapshot().formKey;
    act(() => { store.set({ status: 'loading', user: { uid: 'x', email: 'x@club.test', isAnonymous: false } }); });
    expect(flow.getSnapshot().formKey).toBe(before);
    act(() => { store.set({ status: 'no-access', user: { uid: 'x', email: 'x@club.test', isAnonymous: false } }); });
    expect(flow.getSnapshot()).toMatchObject({ open: true, invited: TOKEN });
    expect(flow.getSnapshot().formKey).toBeGreaterThan(before);
    expect(store.signUp).not.toHaveBeenCalled();
  });

  // The session holds a new account's sign-in still while its form is up (session.ts signUpHeld): the form going away lets
  // the session resolve it.
  test('the form going away releases the account it may hold', () => {
    const { store, unmount } = draw();
    expect(store.releaseSignUp).not.toHaveBeenCalled();
    unmount();
    expect(store.releaseSignUp).toHaveBeenCalled();
  });
});
