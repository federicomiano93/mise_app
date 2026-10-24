import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartBoundary } from '../errors/PartBoundary';
import { ScreenLoadError } from '../errors/ScreenLoadError';
import { lazyScreen } from './sectionScreens';

// ⚠️ A SECTION'S CODE IS DOWNLOADED WHEN IT IS FIRST OPENED, and a download can fail (a phone that
// loses its signal in the lift). React.lazy remembers the failure for the life of the page, so the
// boundary's «Reload» must reload the PAGE for it — here with a real lazy screen whose import
// rejects.

let logged: MockInstance;

beforeEach(() => {
  // React logs every error a boundary catches; these are expected.
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
  vi.unstubAllGlobals();
});

describe('lazyScreen', () => {
  it('draws the screen once its code has arrived', async () => {
    const Screen = lazyScreen(() => Promise.resolve({ default: () => <p>the section</p> }));
    render(
      <PartBoundary>
        <Suspense fallback={<p>fetching</p>}><Screen /></Suspense>
      </PartBoundary>,
    );
    expect(await screen.findByText('the section')).toBeInTheDocument();
  });

  it('marks a download that fails, keeping the reason', async () => {
    const reason = new Error('Failed to fetch dynamically imported module');
    const Screen = lazyScreen(() => Promise.reject(reason));
    const caught: unknown[] = [];
    render(
      <PartBoundary onError={error => { caught.push(error); }}>
        <Suspense fallback={<p>fetching</p>}><Screen /></Suspense>
      </PartBoundary>,
    );
    await screen.findByRole('status');

    expect(caught[0]).toBeInstanceOf(ScreenLoadError);
    expect((caught[0] as ScreenLoadError).cause).toBe(reason);
  });

  it('is reloaded as a PAGE by the Reload button, because drawing it again would only rethrow', async () => {
    const load = vi.fn(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const Screen = lazyScreen(load);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    render(
      <PartBoundary>
        <Suspense fallback={<p>fetching</p>}><Screen /></Suspense>
      </PartBoundary>,
    );

    await user.click(await screen.findByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledTimes(1);
    // Nothing went back to the network: lazy had remembered the failure.
    expect(load).toHaveBeenCalledTimes(1);
  });

  // The proof that a soft reset would not have worked: pressing Reload without the page reload
  // (which is what the boundary did for every failure before) brings the same failure straight back.
  it('would fail again at once if it were only drawn again', async () => {
    const load = vi.fn(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const Screen = lazyScreen(load);
    const caught: unknown[] = [];
    const { rerender } = render(
      <PartBoundary resetKey="a" onError={error => { caught.push(error); }}>
        <Suspense fallback={<p>fetching</p>}><Screen /></Suspense>
      </PartBoundary>,
    );
    await screen.findByRole('status');

    rerender(
      <PartBoundary resetKey="b" onError={error => { caught.push(error); }}>
        <Suspense fallback={<p>fetching</p>}><Screen /></Suspense>
      </PartBoundary>,
    );
    await screen.findByRole('status');

    expect(caught).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
