import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { fakeSettingsSource } from '../../testing/fakeSettingsSource';
import { AwayStoreProvider } from './AwayContext';
import { createAwayStore } from './awayStore';
import { useFocusOnBack } from './useFocusOnBack';

// Saturday 7 November 2026, noon.
const NOW = new Date(2026, 10, 7, 12).getTime();

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function setUp() {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const clock = { now: NOW };
  const source = fakeSettingsSource({ away: { until: '2026-11-16' }, now: () => clock.now });
  const store = createAwayStore(source, 'u1', () => clock.now);
  await act(async () => { store.start(); });
  const target = document.createElement('button');
  document.body.append(target);
  const wrapper = ({ children }: { children: ReactNode }) => <AwayStoreProvider store={store}>{children}</AwayStoreProvider>;
  const { result } = renderHook(() => useFocusOnBack(() => target), { wrapper });
  return { source, store, clock, target, arm: result.current };
}

describe('useFocusOnBack', () => {
  it('moves the focus to the target after this screen’s own «I am back», when the focus is homeless', async () => {
    const { store, target, arm } = await setUp();
    act(() => { arm(); store.comeBack(); });
    expect(target).toHaveFocus();
  });

  it('leaves the focus alone when the holiday ends with nobody having pressed anything', async () => {
    const { store, source, clock, target } = await setUp();
    source.away = { until: '' };
    clock.now += 11 * 60_000;
    await act(async () => { store.refresh(); });
    expect(store.getSnapshot().away).toBe(false);
    expect(target).not.toHaveFocus();
  });

  // Review, 8 Nov 2026: an «I am back» answered over a holiday already ended must not leave the arm on for a later end.
  it('is not armed when the holiday has already ended', async () => {
    const { store, source, clock, target, arm } = await setUp();
    source.away = { until: '' };
    clock.now += 11 * 60_000;
    await act(async () => { store.refresh(); });
    act(() => { arm(); });
    source.away = { until: '2026-11-20' };
    clock.now += 11 * 60_000;
    await act(async () => { store.refresh(); });
    source.away = { until: '' };
    clock.now += 11 * 60_000;
    await act(async () => { store.refresh(); });
    expect(target).not.toHaveFocus();
  });
});
