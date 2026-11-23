import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { install } from '../telemetry/errorReport';
import { memoryStorage, renderWithSession } from '../testing/renderWithSession';
import { findSpokenAlert } from '../testing/spokenAlert';
import { isBusy } from './busy';
import { createJoinFlow, PENDING_INVITE_KEY } from './joinFlow';
import { JoinScreen } from './JoinScreen';
import type { Language } from '../i18n/i18n';
import type { Session } from './session';

// «Check your email» (the join form's second screen for a NEW account): the account is made, a confirmation email goes in the
// language on screen with a link back to this very origin, and the code is checked only after «I’ve confirmed» finds the email
// confirmed (the ID token renewed first). The server's own refusal, `email-unverified`, brings an account that came back later to the
// same screen. Neither the password nor the code is ever logged.

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const PASSWORD = 'Tr1cky-Secret-42';
const EMAIL = 'anna.b@club.test';
const SIGNED_OUT: Partial<Session> = { status: 'signed-out', user: null, locationId: null, location: null, options: [] };
const NO_ACCESS: Partial<Session> = {
  status: 'no-access', user: { uid: 'old-uid', email: 'old@club.test', isAnonymous: false }, locationId: null, location: null, options: [],
};

const fnError = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { code: `functions/${code}`, details });
const authError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });
const unverified = () => fnError('failed-precondition', 'Confirm your email first.', { reason: 'email-unverified' });

const heard: unknown[] = [];
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
install({ report: entry => { heard.push(entry); } }, window, console);
beforeEach(() => {
  heard.length = 0;
  for (const method of METHODS) vi.spyOn(console, method);
});
afterEach(() => { vi.restoreAllMocks(); });
const nothingHeardOf = (...secrets: string[]) => {
  const said = [...heard, ...METHODS.map(method => vi.mocked(console[method]).mock.calls)];
  const all = JSON.stringify(said, (_key, value: unknown) => (value instanceof Error ? `${value.message} ${value.stack}` : value));
  for (const secret of secrets) expect(all).not.toContain(secret);
};

function draw({ invited = '', lang = 'en', session = SIGNED_OUT }: { invited?: string; lang?: Language; session?: Partial<Session> } = {}) {
  const storage = memoryStorage(invited ? { [PENDING_INVITE_KEY]: invited } : {});
  const flow = createJoinFlow(storage);
  if (!invited) flow.openForm();
  const view = renderWithSession(<JoinScreen />, { session, joinFlow: flow, lang });
  return { ...view, storage };
}
type User = ReturnType<typeof draw>['user'];

const LABELS = {
  en: { first: 'Your first name', last: 'Your surname', email: 'Your email', email2: 'Repeat your email', pass: 'Choose a password (at least 10 characters)', pass2: 'Repeat the password', code: 'Code', join: 'Join' },
  it: { first: 'Il tuo nome', last: 'Il tuo cognome', email: 'La tua email', email2: 'Ripeti la tua email', pass: 'Scegli una password (almeno 10 caratteri)', pass2: 'Ripeti la password', code: 'Codice', join: 'Entra' },
} as const;

async function fillAndJoin(user: User, lang: Language = 'en', code = '123456') {
  const l = LABELS[lang];
  await user.type(screen.getByLabelText(l.first), 'Anna');
  await user.type(screen.getByLabelText(l.last), 'Bianchi');
  await user.type(screen.getByLabelText(l.email), EMAIL);
  await user.type(screen.getByLabelText(l.email2), EMAIL);
  await user.type(screen.getByLabelText(l.pass), PASSWORD);
  await user.type(screen.getByLabelText(l.pass2), PASSWORD);
  if (code) await user.type(screen.getByLabelText(l.code), code);
  await user.click(screen.getByRole('button', { name: l.join }));
}

const confirmedButton = () => screen.getByRole('button', { name: 'I’ve confirmed' });

describe('after the sign-up: «Check your email», and nothing is redeemed', () => {
  test('the screen: one h1 with the focus on it, the address, three steps, the buttons', async () => {
    const { user, store } = draw();
    await fillAndJoin(user);
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Check your email' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1).toHaveFocus();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(EMAIL).tagName).toBe('B');
    expect(screen.getByText(/We sent an email to/)).toHaveTextContent(`We sent an email to ${EMAIL} to confirm it is yours.`);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Open the email we sent you', 'Tap the link in it', 'Come back here and tap “I’ve confirmed”',
    ]);
    expect(confirmedButton()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wrong email? Go back' })).toBeInTheDocument();
    expect(screen.getByText('Can’t find it? Look in spam or junk mail.')).toBeInTheDocument();
    // The form is gone and the code has not been asked about.
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
    expect(store.signUp).toHaveBeenCalledOnce();
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
    expect(store.openJoinedVenue).not.toHaveBeenCalled();
    // Nothing is in the air while the person goes to read their email.
    expect(isBusy()).toBe(false);
    nothingHeardOf(PASSWORD, '123456');
  });

  test('the email goes once, in the language on screen, with this origin as the way back', async () => {
    const { user, store } = draw();
    await fillAndJoin(user);
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });
    expect(store.sendEmailVerification).toHaveBeenCalledOnce();
    const [language, url, uid] = store.sendEmailVerification.mock.calls[0] ?? [];
    expect(language).toBe('en');
    expect(uid).toBe('new-uid');
    expect(new URL(String(url)).origin).toBe(window.location.origin);
  });

  test('in Italian: the screen, the language of the email', async () => {
    const { user, store } = draw({ lang: 'it' });
    await fillAndJoin(user, 'it');
    expect(await screen.findByRole('heading', { level: 1, name: 'Controlla la tua email' })).toBeInTheDocument();
    expect(store.sendEmailVerification.mock.calls[0]?.[0]).toBe('it');
    expect(screen.getByText(/Ti abbiamo mandato un’email a/)).toHaveTextContent(`Ti abbiamo mandato un’email a ${EMAIL} per confermare che è tua.`);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Apri l’email che ti abbiamo mandato', 'Tocca il link dentro', 'Torna qui e tocca «Ho confermato»',
    ]);
    expect(screen.getByRole('button', { name: 'Ho confermato' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mandala di nuovo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'L’email è sbagliata? Torna indietro' })).toBeInTheDocument();
    expect(screen.getByText('Non la trovi? Guarda nello spam o nella posta indesiderata.')).toBeInTheDocument();
  });

  test('the first email could not be sent: the screen is there all the same, with a friendly line, and «Send it again» works', async () => {
    const { user, store } = draw();
    store.sendEmailVerification.mockRejectedValueOnce(authError('auth/network-request-failed'));
    await fillAndJoin(user);
    expect(await findSpokenAlert()).toHaveTextContent('We could not send it. Try again shortly.');
    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send it again' }));
    await waitFor(() => { expect(store.sendEmailVerification).toHaveBeenCalledTimes(2); });
    expect(await screen.findByText('We have sent it again.')).toBeInTheDocument();
  });

  // ⚠️ A live region inserted already filled is not announced reliably: the view mounts with an EMPTY alert, and the words
  // are put in afterwards (a later change to the same element).
  test('the first email could not be sent: the alert is in the page empty, and only then filled', async () => {
    const { user, store } = draw();
    store.sendEmailVerification.mockRejectedValueOnce(authError('auth/network-request-failed'));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => { records.push(...list); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    await fillAndJoin(user);
    const alert = await findSpokenAlert();
    records.push(...observer.takeRecords());
    observer.disconnect();
    const inserted = records.findIndex(record => [...record.addedNodes].some(node => node instanceof Element && node.contains(alert)));
    const filled = records.findIndex(record => alert.contains(record.target));
    expect(inserted).toBeGreaterThanOrEqual(0);
    expect(filled).toBeGreaterThan(inserted);
  });
});

describe('«I’ve confirmed»', () => {
  test('not confirmed yet: the warning, no redeem; and again it can be tapped', async () => {
    const { user, store } = draw();
    store.checkEmailVerified.mockResolvedValue(false);
    await fillAndJoin(user);
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });
    await user.click(confirmedButton());
    const alert = await findSpokenAlert();
    expect(alert).toHaveTextContent('Not confirmed yet. Tap the link in the email, then come back here.');
    expect(alert.querySelector('strong')).toHaveTextContent('Not confirmed yet.');
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
    await user.click(confirmedButton());
    await waitFor(() => { expect(store.checkEmailVerified).toHaveBeenCalledTimes(2); });
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
  });

  test('not confirmed, in Italian', async () => {
    const { user, store } = draw({ lang: 'it' });
    store.checkEmailVerified.mockResolvedValue(false);
    await fillAndJoin(user, 'it');
    await user.click(await screen.findByRole('button', { name: 'Ho confermato' }));
    expect(await findSpokenAlert()).toHaveTextContent('Non risulta ancora confermata. Tocca il link nell’email, poi torna qui.');
  });

  test('confirmed: the token is refreshed, THEN the code is checked with the same arguments, then the venue opens', async () => {
    const { user, store } = draw({ invited: TOKEN });
    const order: string[] = [];
    store.signUp.mockImplementation(async email => { order.push('signUp'); return { uid: 'new-uid', email, isAnonymous: false }; });
    store.sendEmailVerification.mockImplementation(async () => { order.push('send'); });
    store.checkEmailVerified.mockImplementation(async () => { order.push('check'); return true; });
    store.redeemJoinCode.mockImplementation(async () => { order.push('redeem'); return 'joined'; });
    store.openJoinedVenue.mockImplementation(async () => { order.push('open'); });
    await fillAndJoin(user, 'en', '');
    await user.click(await screen.findByRole('button', { name: 'I’ve confirmed' }));
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalled(); });
    expect(order).toEqual(['signUp', 'send', 'check', 'redeem', 'open']);
    expect(store.redeemJoinCode).toHaveBeenCalledWith(TOKEN, 'link', 'Anna', 'Bianchi');
    expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'new-uid');
    nothingHeardOf(PASSWORD, TOKEN);
  });

  test('two quick taps are one check, and while it runs the button is pending and the others are off', async () => {
    const { user, store } = draw();
    let answer: (verified: boolean) => void = () => {};
    store.checkEmailVerified.mockImplementation(() => new Promise<boolean>(resolve => { answer = resolve; }));
    await fillAndJoin(user);
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });
    await user.dblClick(confirmedButton());
    expect(store.checkEmailVerified).toHaveBeenCalledOnce();
    expect(isBusy()).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Checking…');
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Wrong email? Go back' })).toBeDisabled();
    await act(async () => { answer(false); });
    expect(isBusy()).toBe(false);
  });

  test('a check that cannot reach Firebase says so, in the app’s words, and redeems nothing', async () => {
    const { user, store } = draw();
    store.checkEmailVerified.mockRejectedValueOnce(authError('auth/network-request-failed'));
    await fillAndJoin(user);
    await user.click(await screen.findByRole('button', { name: 'I’ve confirmed' }));
    expect(await findSpokenAlert()).toHaveTextContent('Could not check the code. Try again in a moment.');
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
  });

  test('confirmed but the code is refused: the form comes back for that account with the reason', async () => {
    const { user, store } = draw();
    store.redeemJoinCode.mockRejectedValueOnce(fnError('permission-denied', 'That code does not work.'));
    await fillAndJoin(user);
    await user.click(await screen.findByRole('button', { name: 'I’ve confirmed' }));
    expect(await findSpokenAlert()).toHaveTextContent('That code does not work. Ask for a new one.');
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue('123456');
    expect(screen.queryByLabelText('Your email')).not.toBeInTheDocument();
  });

  test('the server still says «email-unverified» after a yes from Firebase: back to the warning, no new email', async () => {
    const { user, store } = draw();
    store.redeemJoinCode.mockRejectedValueOnce(unverified());
    await fillAndJoin(user);
    await user.click(await screen.findByRole('button', { name: 'I’ve confirmed' }));
    expect(await findSpokenAlert()).toHaveTextContent('Not confirmed yet.');
    expect(store.sendEmailVerification).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
  });
});

describe('«Send it again»', () => {
  async function onTheScreen(lang: Language = 'en') {
    const drawn = draw({ lang });
    await fillAndJoin(drawn.user, lang);
    await screen.findByRole('heading', { level: 1, name: lang === 'it' ? 'Controlla la tua email' : 'Check your email' });
    return drawn;
  }

  test('sent: «We have sent it again.»', async () => {
    const { user, store } = await onTheScreen();
    await user.click(screen.getByRole('button', { name: 'Send it again' }));
    expect(await screen.findByText('We have sent it again.')).toBeInTheDocument();
    expect(store.sendEmailVerification).toHaveBeenCalledTimes(2);
  });

  test('too many requests: wait a few minutes', async () => {
    const { user, store } = await onTheScreen();
    store.sendEmailVerification.mockRejectedValueOnce(authError('auth/too-many-requests'));
    await user.click(screen.getByRole('button', { name: 'Send it again' }));
    expect(await findSpokenAlert()).toHaveTextContent('We have just sent one: wait a few minutes before asking for another.');
  });

  test('any other failure: a friendly line, never the raw error', async () => {
    const { user, store } = await onTheScreen();
    store.sendEmailVerification.mockRejectedValueOnce(authError('auth/internal-error'));
    await user.click(screen.getByRole('button', { name: 'Send it again' }));
    const alert = await findSpokenAlert();
    expect(alert).toHaveTextContent('We could not send it. Try again shortly.');
    expect(alert).not.toHaveTextContent('auth/');
  });

  test('in Italian: the three answers', async () => {
    const { user, store } = await onTheScreen('it');
    await user.click(screen.getByRole('button', { name: 'Mandala di nuovo' }));
    expect(await screen.findByText('Te l’abbiamo mandata di nuovo.')).toBeInTheDocument();
    store.sendEmailVerification.mockRejectedValueOnce(authError('auth/too-many-requests'));
    await user.click(screen.getByRole('button', { name: 'Mandala di nuovo' }));
    expect(await findSpokenAlert()).toHaveTextContent('Ne abbiamo appena mandata una: aspetta qualche minuto prima di chiederne un’altra.');
    store.sendEmailVerification.mockRejectedValueOnce(authError('auth/internal-error'));
    await user.click(screen.getByRole('button', { name: 'Mandala di nuovo' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Non siamo riusciti a mandarla. Riprova fra poco.');
    });
  });

  test('a double tap sends one email', async () => {
    const { user, store } = await onTheScreen();
    let sent: () => void = () => {};
    store.sendEmailVerification.mockImplementation(() => new Promise<void>(resolve => { sent = resolve; }));
    await user.dblClick(screen.getByRole('button', { name: 'Send it again' }));
    expect(store.sendEmailVerification).toHaveBeenCalledTimes(2);
    await act(async () => { sent(); });
  });
});

describe('«Wrong email? Go back»', () => {
  async function onTheScreen(invited = '') {
    const drawn = draw({ invited });
    await fillAndJoin(drawn.user, 'en', invited ? '' : '123456');
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });
    return drawn;
  }

  test('it asks first; Cancel changes nothing', async () => {
    const { user, store } = await onTheScreen();
    await user.click(screen.getByRole('button', { name: 'Wrong email? Go back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Go back?' })).toHaveTextContent('This account is removed and you can type another email.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.deleteNewAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
  });

  test('yes: the account is deleted, the typed names and email are carried to the next form, the invitation is held', async () => {
    const { user, store, flow } = await onTheScreen(TOKEN);
    const carry = vi.spyOn(flow, 'carryToNextForm');
    const hold = vi.spyOn(flow, 'holdThroughSignOut');
    await user.click(screen.getByRole('button', { name: 'Wrong email? Go back' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(store.deleteNewAccount).toHaveBeenCalledOnce(); });
    expect(carry).toHaveBeenCalledWith({ firstName: 'Anna', lastName: 'Bianchi', email: EMAIL });
    expect(hold).toHaveBeenCalledWith(true);
    expect(store.signOut).not.toHaveBeenCalled();
    expect(flow.getSnapshot().invited).toBe(TOKEN);
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  test('the account is deleted for the uid the screen waits for', async () => {
    const { user, store } = await onTheScreen();
    await user.click(screen.getByRole('button', { name: 'Wrong email? Go back' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(store.deleteNewAccount).toHaveBeenCalledWith('new-uid'); });
  });

  test('the account cannot be removed at all: it SAYS so first, then the person is signed out, the invitation kept', async () => {
    const { user, store } = await onTheScreen(TOKEN);
    store.deleteNewAccount.mockRejectedValueOnce(authError('auth/network-request-failed'));
    await user.click(screen.getByRole('button', { name: 'Wrong email? Go back' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    const notice = await screen.findByRole('alertdialog');
    expect(notice).toHaveTextContent('We couldn’t remove the account with this email. You can still start again.');
    // The sign-out reloads the page, so nothing may have happened before the words were read.
    expect(store.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(store.signOut).toHaveBeenCalledWith({ keepInvitation: true }); });
  });

  test('in Italian the same sentence', async () => {
    const drawn = draw({ lang: 'it' });
    await fillAndJoin(drawn.user, 'it');
    await screen.findByRole('heading', { level: 1, name: 'Controlla la tua email' });
    drawn.store.deleteNewAccount.mockRejectedValueOnce(authError('auth/network-request-failed'));
    await drawn.user.click(screen.getByRole('button', { name: 'L’email è sbagliata? Torna indietro' }));
    await drawn.user.click(await screen.findByRole('button', { name: 'Indietro' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Non siamo riusciti a togliere l’account con questa email. Puoi comunque ricominciare.',
    );
  });

  // ⚠️ ANOTHER ACCOUNT IS SIGNED IN BY NOW (another tab): nothing is deleted, nobody is signed out.
  test('another account signed in meanwhile: «Go back» deletes nothing and signs nobody out', async () => {
    const { user, store } = await onTheScreen();
    store.deleteNewAccount.mockRejectedValueOnce(authError('auth/user-mismatch'));
    await user.click(screen.getByRole('button', { name: 'Wrong email? Go back' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.queryByRole('heading', { level: 1, name: 'Check your email' })).not.toBeInTheDocument(); });
    expect(store.signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });

  test('another account signs in while the screen is up: the screen is left, nothing deleted, nothing redeemed', async () => {
    const { store } = await onTheScreen();
    act(() => { store.set({ status: 'no-access', user: { uid: 'other-uid', email: 'other@club.test', isAnonymous: false } }); });
    await waitFor(() => { expect(screen.queryByRole('heading', { level: 1, name: 'Check your email' })).not.toBeInTheDocument(); });
    expect(store.deleteNewAccount).not.toHaveBeenCalled();
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
  });

  test('neither works: it says so, and the screen stays', async () => {
    const { user, store } = await onTheScreen();
    store.deleteNewAccount.mockRejectedValueOnce(authError('auth/network-request-failed'));
    store.signOut.mockRejectedValueOnce(new Error('no'));
    await user.click(screen.getByRole('button', { name: 'Wrong email? Go back' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    expect(await findSpokenAlert()).toHaveTextContent('We could not go back. Try again shortly.');
    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });
});

describe('«I’ve confirmed» for another account', () => {
  test('the store refuses (another account is signed in): nothing is redeemed, the screen is left', async () => {
    const { user, store } = draw();
    store.checkEmailVerified.mockRejectedValueOnce(authError('auth/user-mismatch'));
    await fillAndJoin(user);
    await user.click(await screen.findByRole('button', { name: 'I’ve confirmed' }));
    await waitFor(() => { expect(screen.queryByRole('heading', { level: 1, name: 'Check your email' })).not.toBeInTheDocument(); });
    expect(store.checkEmailVerified).toHaveBeenCalledWith('new-uid');
    expect(store.redeemJoinCode).not.toHaveBeenCalled();
    expect(store.openJoinedVenue).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
  });
});

describe('the server’s refusal «email-unverified»', () => {
  test('an account already signed in whose code is refused for it: the screen, one email sent by itself, no «Go back»', async () => {
    const { user, store } = draw({ session: NO_ACCESS });
    store.redeemJoinCode.mockRejectedValueOnce(unverified());
    await user.type(screen.getByLabelText('Your first name'), 'Luca');
    await user.type(screen.getByLabelText('Your surname'), 'Rossi');
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(store.sendEmailVerification).toHaveBeenCalledOnce();
    expect(store.signUp).not.toHaveBeenCalled();
    // An account that was already there is never deleted from here.
    expect(screen.queryByRole('button', { name: 'Wrong email? Go back' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a different account' })).toBeInTheDocument();
    expect(screen.getByText('old@club.test')).toBeInTheDocument();
    // Then «I’ve confirmed» redeems with the same arguments.
    store.redeemJoinCode.mockResolvedValueOnce('joined');
    await user.click(screen.getByRole('button', { name: 'I’ve confirmed' }));
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'old-uid'); });
    expect(store.redeemJoinCode).toHaveBeenLastCalledWith('123456', 'digits', 'Luca', 'Rossi');
  });

  test('an existing account whose email IS confirmed goes the old way: no email, no screen', async () => {
    const { user, store } = draw({ session: NO_ACCESS });
    await user.type(screen.getByLabelText('Your first name'), 'Luca');
    await user.type(screen.getByLabelText('Your surname'), 'Rossi');
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'old-uid'); });
    expect(store.sendEmailVerification).not.toHaveBeenCalled();
    expect(store.checkEmailVerified).not.toHaveBeenCalled();
  });
});
