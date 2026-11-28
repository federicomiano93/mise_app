// «Standby» is in the top bar of EVERY section (24 Nov 2026), so it can be pressed over an editor with unsaved typing (P20): the rest cover must
// only LAY OVER the app — never unmount a screen, reload the page, or let go of the busy marker. Pinned for both ways in: the pill's «rest now»
// and the kiosk's own rest after the idle minutes.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useEffect, useRef, useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { KIOSK_STORAGE_KEY, REST_NOW_GUARD_MS } from '@mise/shared/kiosk-model';
import { isBusy, isBusyApartFrom, markBusy } from '../session/busy';
import { memoryStorage, renderWithSession } from '../testing/renderWithSession';
import { Kiosk } from './Kiosk';
import { requestRestNow } from './restNow';
import type { KioskEnv } from './kioskController';

const MIN = 60_000;
const reload = vi.fn();

function env(): KioskEnv {
  return {
    now: () => Date.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: id => { clearInterval(id as ReturnType<typeof setInterval>); },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: id => { clearTimeout(id as ReturnType<typeof setTimeout>); },
    local: () => memoryStorage(),
    session: () => memoryStorage(),
    document,
    reload,
    updateWaiting: async () => false,
    acquireWakeLock: () => undefined,
    releaseWakeLock: () => undefined,
    refreshWakeLock: () => undefined,
    markBusy,
    isBusyApartFrom,
  };
}

// An editor like every real one: typed text held in state, the busy marker held while there is any. `mounts` counts how often it was drawn
// from nothing: a cover that unmounted the screen would make it 2.
const mounts = vi.fn();
function Editor() {
  const [text, setText] = useState('');
  const counted = useRef(false);
  useEffect(() => {
    if (!counted.current) { counted.current = true; mounts(); }
  }, []);
  useEffect(() => (text === '' ? undefined : markBusy()), [text]);
  return <input aria-label="Recipe name" value={text} onChange={event => { setText(event.target.value); }} />;
}

const idle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const cover = () => screen.queryByRole('button', { name: /Tap to continue/ });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 24, 14, 3, 0));
  localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":true,"restMinutes":5,"nightHours":1}');
  reload.mockClear();
  mounts.mockClear();
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

async function typeThenRest(rest: () => Promise<void>) {
  renderWithSession(<><Editor /><Kiosk env={env()} /></>);
  const field = screen.getByRole('textbox', { name: 'Recipe name' });
  fireEvent.change(field, { target: { value: 'Pane di Miano' } });
  expect(isBusy()).toBe(true);

  await rest();
  expect(cover()).toBeInTheDocument();
  // Under the cover: the same field, the same typing, still held as unsaved.
  expect(screen.getByRole('textbox', { name: 'Recipe name', hidden: true })).toBe(field);
  expect(field).toHaveValue('Pane di Miano');

  fireEvent.keyDown(cover() as HTMLElement, { key: 'Enter' });
  await idle(REST_NOW_GUARD_MS + 1);
  fireEvent.keyDown(cover() as HTMLElement, { key: 'Enter' });
  await idle(500);
  expect(cover()).not.toBeInTheDocument();

  expect(screen.getByRole('textbox', { name: 'Recipe name' })).toBe(field);
  expect(field).toHaveValue('Pane di Miano');
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  expect(isBusy(), 'the typing is still held as unsaved').toBe(true);
}

describe('rest over an editor with unsaved typing', () => {
  test('«Standby» covers the app, and waking it gives the same editor back, typing and busy marker intact', async () => {
    await typeThenRest(async () => { act(() => { requestRestNow(); }); await idle(0); });
  });

  // The kiosk's own rest never even starts over an editor with typing: nextKioskState holds the tablet active while anything is busy.
  test('the automatic rest waits while the editor holds unsaved typing, and comes once it is saved', async () => {
    renderWithSession(<><Editor /><Kiosk env={env()} /></>);
    const field = screen.getByRole('textbox', { name: 'Recipe name' });
    fireEvent.change(field, { target: { value: 'Pane di Miano' } });
    await idle(30 * MIN);
    expect(cover()).not.toBeInTheDocument();
    expect(field).toHaveValue('Pane di Miano');
    expect(reload).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '' } });
    await idle(5 * MIN + 15_000);
    expect(cover()).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Recipe name', hidden: true })).toBe(field);
  });
});
