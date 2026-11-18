// «Rest» and «Exit» on the Home (staff slice 6, D8): only on a kiosk device, to every role, above «Da fare»; Rest asks the kiosk to
// cover the screen, Exit closes the page or says how to.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { EXIT_CHECK_MS, KIOSK_STORAGE_KEY } from '@mise/shared/kiosk-model';
import { onRestNow } from '../kiosk/restNow';
import { ACTION_EVENT } from '../telemetry/usage';
import { renderApp } from '../testing/renderApp';

const ON = '{"enabled":true,"restMinutes":5,"nightHours":1}';
const EMPLOYEE = { role: 'staff', canManage: false, canManageVenue: false, isOwner: false } as const;
const band = () => screen.queryByRole('group', { name: /Kiosk mode|Modalità chiosco/ });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the kiosk band on the Home', () => {
  test('not there with kiosk mode off', async () => {
    renderApp('/home');
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(band()).not.toBeInTheDocument();
  });

  test('an employee on a kiosk device sees Rest and Exit, above «Da fare»', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, ON);
    renderApp('/home', { session: EMPLOYEE });
    const found = await screen.findByRole('group', { name: 'Kiosk mode' });
    const rest = within(found).getByRole('button', { name: 'Rest' });
    expect(within(found).getByRole('button', { name: 'Exit' })).toBeInTheDocument();
    // «Da fare»'s title (its words are the venue's own name for the list).
    const todo = document.getElementById('home-todo-title') as HTMLElement;
    expect(todo).not.toBeNull();
    expect(rest.compareDocumentPosition(todo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('follows the setting live (another tab switching it on)', async () => {
    renderApp('/home');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    act(() => {
      localStorage.setItem(KIOSK_STORAGE_KEY, ON);
      window.dispatchEvent(new StorageEvent('storage', { key: KIOSK_STORAGE_KEY }));
    });
    expect(band()).toBeInTheDocument();
  });

  test('Rest asks the kiosk to cover the screen, and counts the action by name', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, ON);
    const asked = vi.fn();
    const stop = onRestNow(asked);
    const actions: unknown[] = [];
    const count = (event: Event) => { actions.push((event as CustomEvent).detail); };
    window.addEventListener(ACTION_EVENT, count);
    try {
      const { user } = renderApp('/home');
      await user.click(await screen.findByRole('button', { name: 'Rest' }));
      expect(asked).toHaveBeenCalledTimes(1);
      expect(actions).toContain('kiosk-rest');
    } finally {
      stop();
      window.removeEventListener(ACTION_EVENT, count);
    }
  });

  test('Exit closes the page; a tablet that refuses is told how to close it by hand', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, ON);
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderApp('/home');
    await user.click(await screen.findByRole('button', { name: 'Exit' }));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(EXIT_CHECK_MS); });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('This tablet doesn’t let the app close itself.');
  });

  test('in Italian', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, ON);
    renderApp('/home', { lang: 'it', session: { language: 'it' } });
    const found = await screen.findByRole('group', { name: 'Modalità chiosco' });
    expect(within(found).getByRole('button', { name: 'Riposo' })).toBeInTheDocument();
    expect(within(found).getByRole('button', { name: 'Esci' })).toBeInTheDocument();
  });
});
