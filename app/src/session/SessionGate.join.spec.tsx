import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { SCREEN_EVENT } from '../telemetry/usage';
import { fakeStore } from '../testing/fakeSession';
import { memoryStorage } from '../testing/renderWithSession';
import { markBusy } from './busy';
import { ASK_RETRY_MS } from './InviteQuestion';
import { JoinFlowProvider } from './JoinFlowContext';
import { createJoinFlow, PENDING_INVITE_KEY } from './joinFlow';
import { SessionGate, joinShown } from './SessionGate';
import { SessionProvider } from './SessionContext';
import type { Session } from './session';

// The join flow at the door (staff slice 1, docs/parity/staff-plan.md): «No venue yet» gains «I have a join code»; an
// invitation opened with no venue fills the form in; somebody already in a venue is ASKED first, with the account named;
// a form that has been sent stays through every status the session passes while the code is checked (fix 9e0a2dac); and
// a pending invitation is forgotten on sign-out.

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const NO_ACCESS: Partial<Session> = { status: 'no-access', locationId: null, location: null, options: [] };

function draw(session: Partial<Session>, { invited = '' } = {}) {
  const storage = memoryStorage(invited ? { [PENDING_INVITE_KEY]: invited } : {});
  const flow = createJoinFlow(storage);
  const store = fakeStore(session);
  const screens: string[] = [];
  const onScreen = (event: Event) => { screens.push(String((event as CustomEvent).detail)); };
  window.addEventListener(SCREEN_EVENT, onScreen);
  const user = userEvent.setup();
  render(
    <I18nProvider initialLanguage="en" initialMessages={en}>
      <SessionProvider store={store}>
        <JoinFlowProvider flow={flow}>
          <SessionGate><main><h1 tabIndex={-1}>the app</h1></main></SessionGate>
        </JoinFlowProvider>
      </SessionProvider>
    </I18nProvider>,
  );
  return { store, flow, storage, user, screens, stop: () => { window.removeEventListener(SCREEN_EVENT, onScreen); } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('«No venue yet» gains «I have a join code»', () => {
  test('the button opens the empty join form; Back comes back to it, with the focus on it', async () => {
    const { user, screens, stop } = draw(NO_ACCESS);
    await user.click(screen.getByRole('button', { name: 'I have a join code' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your code' })).toBeInTheDocument();
    expect(screens).toContain('join');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'No location yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I have a join code' })).toHaveFocus();
    stop();
  });

  test('the usage line names the screen `join` and nothing else', async () => {
    const { user, screens, stop } = draw(NO_ACCESS);
    await user.click(screen.getByRole('button', { name: 'I have a join code' }));
    expect(screens).toEqual(['no-access', 'join']);
    stop();
  });

  test('success: the session is asked to open the venue the server named', async () => {
    const { user, store, flow } = draw(NO_ACCESS);
    await user.click(screen.getByRole('button', { name: 'I have a join code' }));
    await user.type(screen.getByLabelText('Your first name'), 'Luca');
    await user.type(screen.getByLabelText('Your surname'), 'Rossi');
    await user.type(screen.getByLabelText('Code'), '123456');
    store.openJoinedVenue.mockImplementation(async () => { store.set({ status: 'ready', locationId: 'joined' }); });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => { expect(screen.getByRole('heading', { name: 'the app' })).toBeInTheDocument(); });
    expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'u1');
    expect(flow.getSnapshot().open).toBe(false);
    // The venue's screen gets the focus, not the page.
    await waitFor(() => { expect(screen.getByRole('heading', { name: 'the app' })).toHaveFocus(); });
  });
});

describe('an invitation opened with no venue', () => {
  test('goes straight to the form, the code filled in', () => {
    draw(NO_ACCESS, { invited: TOKEN });
    expect(screen.getByRole('heading', { level: 1, name: 'You have been invited' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue(TOKEN);
  });

  test('Back forgets it: «No venue yet» comes back and stays', async () => {
    const { user, flow, storage } = draw(NO_ACCESS, { invited: TOKEN });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'No location yet' })).toBeInTheDocument();
    expect(flow.getSnapshot().invited).toBe('');
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
  });

  test('a refusal that forgets it («already in») still stays on screen, with its words', async () => {
    const { user, store } = draw(NO_ACCESS, { invited: TOKEN });
    store.redeemJoinCode.mockRejectedValue(Object.assign(new Error('x'), { code: 'functions/failed-precondition', details: { reason: 'already-member' } }));
    await user.type(screen.getByLabelText('Your first name'), 'Luca');
    await user.type(screen.getByLabelText('Your surname'), 'Rossi');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are already in this business.');
    expect(screen.getByLabelText('Your first name')).toHaveValue('Luca');
  });
});

describe('⚠️ the form stays on screen until the server answers (fix 9e0a2dac)', () => {
  test('the session moving to loading, an error and back while the code is checked: the same form, typing and all', async () => {
    const { user, store } = draw(NO_ACCESS);
    let refuse: (error: unknown) => void = () => {};
    store.redeemJoinCode.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    await user.click(screen.getByRole('button', { name: 'I have a join code' }));
    await user.type(screen.getByLabelText('Your first name'), 'Luca');
    await user.type(screen.getByLabelText('Your surname'), 'Rossi');
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    for (const status of ['loading', 'error', 'no-access'] as const) {
      act(() => { store.set({ status }); });
      expect(screen.getByLabelText('Your first name'), status).toHaveValue('Luca');
      expect(screen.getByLabelText('Code'), status).toHaveValue('123456');
    }
    act(() => { store.set({ status: 'loading' }); });
    await act(async () => { refuse(Object.assign(new Error('x'), { code: 'functions/permission-denied' })); });
    // The refusal lands on the form that asked, still on screen through the session's own move.
    expect(await screen.findByRole('alert')).toHaveTextContent('That code does not work. Ask for a new one.');
    expect(screen.getByLabelText('Code')).toHaveValue('123456');
  });

  test('a form never sent is not held: a session that starts loading draws the wait', async () => {
    const { user, store } = draw(NO_ACCESS);
    await user.click(screen.getByRole('button', { name: 'I have a join code' }));
    act(() => { store.set({ status: 'loading' }); });
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
  });

  test('signed out mid-check is somewhere real: the sign-in form, not the held one', async () => {
    const { user, store } = draw(NO_ACCESS);
    let refuse: (error: unknown) => void = () => {};
    store.redeemJoinCode.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    await user.click(screen.getByRole('button', { name: 'I have a join code' }));
    await user.type(screen.getByLabelText('Your first name'), 'Luca');
    await user.type(screen.getByLabelText('Your surname'), 'Rossi');
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    act(() => { store.set({ status: 'signed-out', user: null }); });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    // The answer still arrives (and the hold on reloads ends with it), on a form nobody sees any more.
    await act(async () => { refuse(new Error('late')); });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('somebody already in a venue who opens a link is asked first, with the account named', () => {
  test('the question names the account; «Not now» keeps the app and forgets the link', async () => {
    const { user, flow, storage } = draw({}, { invited: TOKEN });
    const dialog = await screen.findByRole('alertdialog', { name: 'You opened an invitation' });
    expect(dialog).toHaveTextContent('Add this business to owner@club.test?');
    // The app is there behind the question (hidden from assistive technology while the dialog is modal).
    expect(screen.getByRole('heading', { name: 'the app', hidden: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'the app' })).toBeInTheDocument();
    expect(flow.getSnapshot().invited).toBe('');
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
    await waitFor(() => { expect(screen.getByRole('heading', { name: 'the app' })).toHaveFocus(); });
  });

  test('Escape is «Not now»', async () => {
    const { user, flow } = draw({}, { invited: TOKEN });
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(flow.getSnapshot().invited).toBe('');
  });

  test('«Add it» opens the form for that account, the code filled in; Back returns to the app', async () => {
    const { user, flow } = draw({}, { invited: TOKEN });
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Add it' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'You have been invited' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue(TOKEN);
    expect(screen.getByText('owner@club.test')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'the app' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'the app' })).toBeInTheDocument();
    expect(flow.getSnapshot().invited).toBe('');
    await waitFor(() => { expect(screen.getByRole('heading', { name: 'the app' })).toHaveFocus(); });
  });

  // Joining ends in a switch of venue, which clears this phone's copy: the same check as switching venue.
  test('«Add it» with something not sent yet: «Not sent yet» first; «Stay» forgets the link and keeps the app', async () => {
    const { user, store, flow } = draw({}, { invited: TOKEN });
    store.changesStillWaiting.mockResolvedValue(true);
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Add it' }));
    expect(await screen.findByRole('alertdialog', { name: 'Not sent yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('heading', { name: 'the app' })).toBeInTheDocument();
    expect(flow.getSnapshot()).toMatchObject({ invited: '', open: false });
  });

  test('on a joined venue, the session opens it (a switch: session.spec.ts)', async () => {
    const { user, store } = draw({}, { invited: TOKEN });
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Add it' }));
    await user.type(await screen.findByLabelText('Your first name'), 'Luca');
    await user.type(screen.getByLabelText('Your surname'), 'Rossi');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => { expect(store.openJoinedVenue).toHaveBeenCalledWith('joined', 'u1'); });
    expect(store.redeemJoinCode).toHaveBeenCalledWith(TOKEN, 'link', 'Luca', 'Rossi');
  });

  test('the account with no email is «this account»', async () => {
    draw({ user: { uid: 'u9', email: null, isAnonymous: false } }, { invited: TOKEN });
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Add this business to this account?');
  });

  test('on the venue picker too; Back from the form returns to the picker with the focus on it', async () => {
    const { user } = draw({ status: 'choose-location', locationId: null, options: ['a', 'b'], optionNames: { a: 'A', b: 'B' } }, { invited: TOKEN });
    expect(await screen.findByRole('alertdialog', { name: 'You opened an invitation' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add it' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(document.activeElement).not.toBe(document.body); });
    expect(screen.getByRole('main')).toContainElement(document.activeElement as HTMLElement);
  });

  // ⚠️ The form replaces the app: an editor's unsaved typing would go with it.
  test('while somebody is typing, the question waits until they are not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = markBusy();
    draw({}, { invited: TOKEN });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(ASK_RETRY_MS); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    release();
    await act(async () => { vi.advanceTimersByTime(ASK_RETRY_MS); });
    expect(screen.getByRole('alertdialog', { name: 'You opened an invitation' })).toBeInTheDocument();
  });

  test('no invitation: no question', () => {
    draw({});
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('a pending invitation is forgotten on sign-out', () => {
  test('signed in, then signed out (this tab or another): forgotten', async () => {
    const { store, flow, storage } = draw(NO_ACCESS, { invited: TOKEN });
    act(() => { store.set({ status: 'signed-out', user: null }); });
    expect(flow.getSnapshot().invited).toBe('');
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
  });

  // Another person taking the place of the signed-in one with no sign-out step (an expired session, the form, a different account).
  test('another person signed in with no sign-out between: forgotten too', async () => {
    const { store, flow, storage } = draw(NO_ACCESS, { invited: TOKEN });
    act(() => { store.set({ status: 'loading', user: { uid: 'somebody-else', email: 'else@club.test', isAnonymous: false } }); });
    expect(flow.getSnapshot().invited).toBe('');
    expect(storage.map.has(PENDING_INVITE_KEY)).toBe(false);
  });

  // The person a link is for may open it signed out: it must wait for the sign-in.
  test('a window that OPENS signed out keeps it, and offers it once signed in', async () => {
    const { store, flow } = draw({ status: 'loading', user: null }, { invited: TOKEN });
    act(() => { store.set({ status: 'signed-out', user: null }); });
    expect(flow.getSnapshot().invited).toBe(TOKEN);
    act(() => { store.set({ status: 'loading', user: { uid: 'u1', email: 'new@club.test', isAnonymous: false } }); });
    act(() => { store.set({ ...NO_ACCESS }); });
    expect(screen.getByLabelText('Code')).toHaveValue(TOKEN);
  });
});

describe('joinShown', () => {
  const flow = { invited: '', open: false, sent: null, formKey: 0, returned: false };
  test('signed out: never', () => {
    expect(joinShown('signed-out', { ...flow, open: true, invited: TOKEN, sent: { busy: true } })).toBe(false);
  });
  test('in a venue or on the picker: only once opened', () => {
    expect(joinShown('ready', { ...flow, invited: TOKEN })).toBe(false);
    expect(joinShown('ready', { ...flow, open: true })).toBe(true);
    expect(joinShown('choose-location', { ...flow, open: true })).toBe(true);
  });
  test('no venue: opened, an invitation, or an answer still on screen', () => {
    expect(joinShown('no-access', flow)).toBe(false);
    expect(joinShown('no-access', { ...flow, invited: TOKEN })).toBe(true);
    expect(joinShown('no-access', { ...flow, sent: { busy: false, invited: '' } })).toBe(true);
  });
  test('loading or error: only a form that has been sent', () => {
    expect(joinShown('loading', { ...flow, open: true })).toBe(false);
    expect(joinShown('error', { ...flow, sent: { busy: true, invited: '' } })).toBe(true);
  });
});
