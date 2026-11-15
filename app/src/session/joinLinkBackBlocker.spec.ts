import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createHashRouter } from 'react-router';

// ⚠️ A join link opened in a tab that already runs the app, then Back with unsaved typing (code review, 13 Nov 2026).
// The browser makes a history entry for the link; joinLinkBoot rewrites it as the screen the app was on. If that copy kept the
// router's own index N, the next Back would be «delta 0» for the router, and a blocker (the «Leave?» question) answers a delta
// of 0 with history.go(0): a PAGE RELOAD that silently loses what was typed. This runs the real router over the real history.

const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 60); });

let router: ReturnType<typeof createHashRouter>;
let go: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  window.history.replaceState(null, '', '/mise_app/index.html#/start');
  const boot = await import('./joinLinkBoot');
  // Created AFTER the boot module, as in main.tsx: its listener must run before the router's.
  router = createHashRouter([
    { path: '/start', element: null },
    { path: '/orders', element: null },
    { path: '/recipes', element: null },
  ]);
  let routerState: unknown = window.history.state;
  router.subscribe(() => { routerState = window.history.state; });
  boot.setJoinLinkReturn(() => ({
    fragment: `#${router.state.location.pathname}${router.state.location.search}`,
    state: routerState,
  }));
  await router.navigate('/orders');
  await router.navigate('/recipes');
  await settle();
  go = vi.spyOn(window.history, 'go');
});

afterAll(() => { go.mockRestore(); router.dispose(); });

describe('Back after a join link opened in a running tab', () => {
  test('a dirty screen still gets its «Leave?» question, and the page is not reloaded', async () => {
    router.getBlocker('leave', () => true);
    // What the browser does for a link that changes only the fragment: a new entry with no state.
    window.history.pushState(null, '', `/mise_app/index.html#join=${TOKEN}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle();
    expect(window.location.href).not.toContain(TOKEN);
    expect(router.state.location.pathname).toBe('/recipes');

    window.history.back();
    await settle();

    expect(router.state.blockers.get('leave')?.state).toBe('blocked');
    // The router asks for go(delta * -1), which is -0 for a delta of 0, and Object.is tells -0 from 0: compare with ==.
    const reloads = go.mock.calls.filter(([steps]: [number?]) => steps === undefined || Number(steps) === 0);
    expect(reloads).toEqual([]);
    expect(router.state.location.pathname).toBe('/recipes');
  });
});
