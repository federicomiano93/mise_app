import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { PENDING_INVITE_KEY } from './joinFlow';

// The page's own join flow, as main.tsx starts it: a join link is read ONCE, the moment the module is imported (main.tsx
// imports it first; main.spec.ts pins that), and the token leaves the address bar and the history entry before anything else
// runs. The module listens to the address from then on, so this file imports it exactly once, with the page opened on a link.
//
// ⚠️ AND THE TOKEN IS NEVER LOGGED: every console method is watched from before the import to the end of the file.

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const LATER = 'zZ9dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const spies = METHODS.map(method => vi.spyOn(console, method).mockImplementation(() => {}));

let boot: typeof import('./joinLinkBoot');
let historyLength = 0;

beforeAll(async () => {
  sessionStorage.clear();
  window.history.replaceState(null, '', `/mise_app/index.html#join=${TOKEN}`);
  historyLength = window.history.length;
  boot = await import('./joinLinkBoot');
});

afterAll(() => {
  spies.forEach(spy => { spy.mockRestore(); });
  sessionStorage.clear();
});

describe('joinLinkBoot', () => {
  test('the link opened the page: the token is the window’s invitation', () => {
    expect(boot.joinFlow.getSnapshot().invited).toBe(TOKEN);
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe(TOKEN);
  });

  test('and it is gone from the address bar, in the SAME history entry (no Back to it)', () => {
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/mise_app/index.html');
    expect(window.history.length).toBe(historyLength);
  });

  // ⚠️ The router must never hear of the entry the browser made for the link: an entry with no index of the router's would
  // make it skip every «Leave?» question on a later Back across it (code review, 13 Nov 2026).
  test('a link opened in the tab while the app runs: taken out, the screen put back with the router’s state, the router not told', () => {
    const routerState = { usr: null, key: 'k7', idx: 4 };
    boot.setJoinLinkReturn(() => ({ fragment: '#/orders', state: routerState }));
    const router = vi.fn();
    window.addEventListener('popstate', router);
    window.history.pushState(null, '', `/mise_app/index.html#join=${LATER}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.removeEventListener('popstate', router);
    expect(router).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(routerState);
    expect(window.location.hash).toBe('#/orders');
    expect(window.location.href).not.toContain(LATER);
    expect(boot.joinFlow.getSnapshot().invited).toBe(LATER);
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe(LATER);
  });

  test('only a hashchange (no popstate): the same', () => {
    boot.joinFlow.forget();
    window.history.pushState(null, '', `/mise_app/index.html#join=${TOKEN}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe('#/orders');
    expect(boot.joinFlow.getSnapshot().invited).toBe(TOKEN);
  });

  test('an ordinary move of the app is left alone, and the router hears it', () => {
    const router = vi.fn();
    window.addEventListener('popstate', router);
    window.history.pushState(null, '', '/mise_app/index.html#/recipes');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.removeEventListener('popstate', router);
    expect(window.location.hash).toBe('#/recipes');
    expect(router).toHaveBeenCalledOnce();
  });

  test('a router that cannot say where it is: the app’s start', () => {
    boot.setJoinLinkReturn(() => { throw new Error('no router yet'); });
    window.history.pushState(null, '', `/mise_app/index.html#join=${LATER}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(LATER);
  });

  test('nothing was written to the console, least of all a token', () => {
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
