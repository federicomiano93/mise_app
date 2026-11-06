import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { render, screen } from '@testing-library/react';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { routes } from '../routes';
import { SessionProvider } from '../session/SessionContext';
import type { ConsoleLike, ListenerTarget } from '../telemetry/errorReport';
import type { TelemetrySinks } from '../telemetry/sinks';
import { startTelemetry } from '../telemetry/startTelemetry';
import { fakeStore } from '../testing/fakeSession';
import { renderApp } from '../testing/renderApp';

// The shell's own frame (the top bar, the rail, the tab bar) is not guarded by the section
// boundary: when a part of it fails to draw, the ROUTER's boundary catches it. That boundary
// writes a line of its own to console.error unless the router is given an onError, so one failing
// part would be reported twice. These specs pin that it is reported once.
vi.mock('./useToday', () => ({
  useToday: () => { throw new Error('the top bar is broken'); },
}));

const ROUTER_LINE = 'React Router caught the following error during render';

let stop: (() => void) | null = null;
const sinks = {
  reportError: vi.fn<TelemetrySinks['reportError']>(async () => undefined),
  pingDevice: vi.fn<TelemetrySinks['pingDevice']>(async () => undefined),
  saveUsage: vi.fn<TelemetrySinks['saveUsage']>(async () => undefined),
};

const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const messages = () => sinks.reportError.mock.calls.map(([record]) => String(record.message));

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('screen', { width: 390, height: 844 });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  sinks.reportError.mockClear();

  // React and React Router log what they catch to the real console; hand those lines to the
  // wrapped console of this spec, as the real one would be.
  const target: ListenerTarget = { addEventListener: () => undefined };
  const consoleObj: ConsoleLike = { error: vi.fn() };
  stop = startTelemetry({ store: fakeStore(), sinks, target, console: consoleObj });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleObj.error(...args); });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('a part of the shell\'s own frame that fails to draw', () => {
  it('shows the whole-app error screen and sends ONE report', async () => {
    renderApp('/orders');

    expect(screen.getByRole('heading', { level: 1, name: 'Mise stopped working.' })).toBeInTheDocument();
    await settle();

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('the top bar is broken');
    expect(messages().some(message => message.includes(ROUTER_LINE))).toBe(false);
    expect(sinks.reportError.mock.calls[0]?.[0]).toMatchObject({ source: 'console' });
  });

  // The control: the same failure with a router that has no onError. If React Router ever stops
  // logging by itself this fails, and the handler (errors/routeErrors.ts) is no longer needed.
  it('would be reported twice by a router with no onError', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/orders'] });
    render(
      <I18nProvider initialLanguage="en" initialMessages={en}>
        <SessionProvider store={fakeStore()}>
          <RouterProvider router={router} />
        </SessionProvider>
      </I18nProvider>,
    );
    await settle();

    expect(messages()).toHaveLength(2);
    expect(messages().filter(message => message.includes(ROUTER_LINE))).toHaveLength(1);
  });
});
