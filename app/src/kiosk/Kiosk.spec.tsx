// Kiosk mode mounted (staff slice 5): the rest screen after the idle minutes, what it shows (D9: time, date, venue, work day,
// offline), in English and Italian, the waking tap and key reaching nothing underneath, the focus coming back, the busy marker held
// while it is up, and a sign-out taking it away.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { KIOSK_STORAGE_KEY } from '@mise/shared/kiosk-model';
import { isBusy, isBusyApartFrom, markBusy } from '../session/busy';
import { memoryStorage, renderWithSession } from '../testing/renderWithSession';
import { fakeKioskOrdersSource } from '../testing/fakeKioskOrdersSource';
import { REST_NOW_GUARD_MS } from '@mise/shared/kiosk-model';
import { Kiosk } from './Kiosk';
import { TICK_MS } from './kioskController';
import { provideKioskLines } from './liveOrdersLines';
import { requestRestNow } from './restNow';
import type { KioskEnv } from './kioskController';
import { LIFT_WAIT_MS } from './wakeTap';

const MIN = 60_000;

function env(): KioskEnv & { lockHeld(): boolean } {
  let held = false;
  return {
    now: () => Date.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: id => { clearInterval(id as ReturnType<typeof setInterval>); },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: id => { clearTimeout(id as ReturnType<typeof setTimeout>); },
    local: () => memoryStorage(),
    session: () => memoryStorage(),
    document,
    reload: vi.fn(),
    updateWaiting: async () => false,
    acquireWakeLock: () => { held = true; },
    releaseWakeLock: () => { held = false; },
    refreshWakeLock: () => {},
    markBusy,
    isBusyApartFrom,
    lockHeld: () => held,
  };
}

async function idle(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const cover = () => screen.queryByRole('button', { name: /Tap to continue|Tocca per continuare/ });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 5, 14, 3, 0));
  localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":true,"restMinutes":5,"nightHours":1}');
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the rest screen', () => {
  test('appears after the chosen minutes and shows the time, the venue and the date', async () => {
    renderWithSession(<Kiosk env={env()} />, { session: { name: 'Panificio Miano' } });
    await idle(5 * MIN - TICK_MS);
    expect(cover()).not.toBeInTheDocument();
    await idle(TICK_MS);
    const rest = cover();
    expect(rest).toBeInTheDocument();
    expect(rest).toHaveTextContent('14:08');
    expect(rest).toHaveTextContent('Panificio Miano');
    expect(rest).toHaveTextContent('Monday 5 October');
    expect(rest).not.toHaveTextContent('Work day');
    expect(rest).not.toHaveTextContent('No connection');
    expect(rest, 'focused as it appears').toHaveFocus();
  });

  test('before 04:00 it says whose work day it still is', async () => {
    vi.setSystemTime(new Date(2026, 9, 6, 3, 0, 0));
    renderWithSession(<Kiosk env={env()} />);
    await idle(5 * MIN);
    expect(cover()).toHaveTextContent('Tuesday 6 October');
    expect(cover()).toHaveTextContent('Work day: Monday 5 October');
  });

  test('says when there is no connection', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    renderWithSession(<Kiosk env={env()} />);
    await idle(5 * MIN);
    expect(cover()).toHaveTextContent('No connection');
  });

  test('speaks Italian', async () => {
    vi.setSystemTime(new Date(2026, 9, 6, 3, 0, 0));
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    renderWithSession(<Kiosk env={env()} />, { lang: 'it', session: { language: 'it' } });
    await idle(5 * MIN);
    const rest = screen.getByRole('button', { name: 'Tocca per continuare' });
    expect(rest).toHaveTextContent('martedì 6 ottobre');
    expect(rest).toHaveTextContent('Giorno di lavoro: lunedì 5 ottobre');
    expect(rest).toHaveTextContent('Senza rete');
  });

  test('the clock moves on with the ticks, and the block shifts a few pixels each minute', async () => {
    renderWithSession(<Kiosk env={env()} />);
    await idle(5 * MIN);
    const block = cover()?.firstElementChild as HTMLElement;
    const before = block.dataset.shift;
    await idle(MIN);
    expect(cover()).toHaveTextContent('14:09');
    expect(block.dataset.shift).not.toBe(before);
  });

  test('holds the busy marker while it is up, so neither the shell’s update nor the copy check reloads under it', async () => {
    renderWithSession(<Kiosk env={env()} />);
    await idle(5 * MIN);
    expect(isBusy()).toBe(true);
    fireEvent.keyDown(cover() as HTMLElement, { key: 'a' });
    expect(cover()).not.toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });

  test('nothing at all with the setting off', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":false,"restMinutes":2,"nightHours":1}');
    const world = env();
    renderWithSession(<Kiosk env={world} />);
    await idle(30 * MIN);
    expect(cover()).not.toBeInTheDocument();
    expect(world.lockHeld()).toBe(false);
  });

  test('a sign-out takes it away and lets the screen lock go', async () => {
    const world = env();
    const { store } = renderWithSession(<Kiosk env={world} />);
    await idle(5 * MIN);
    expect(world.lockHeld()).toBe(true);
    act(() => { store.set({ status: 'signed-out', user: null }); });
    expect(cover()).not.toBeInTheDocument();
    expect(world.lockHeld()).toBe(false);
  });

  test('a venue switch keeps kiosk mode: the cover comes back over the new venue', async () => {
    const { store } = renderWithSession(<Kiosk env={env()} />, { session: { name: 'Bakery' } });
    await idle(5 * MIN);
    act(() => { store.set({ status: 'loading' }); });
    act(() => { store.set({ status: 'ready', name: 'Second shop', locationId: 'shop2' }); });
    fireEvent.keyDown(document.body, { key: 'a' });
    await idle(5 * MIN);
    expect(cover()).toHaveTextContent('Second shop');
  });
});

describe('the waking tap presses nothing', () => {
  test('a touch on the cover reaches no React handler and no document listener, and wakes it after the lift', async () => {
    const pressed = vi.fn();
    const heard = vi.fn();
    document.addEventListener('pointerdown', heard, true);
    document.addEventListener('click', heard, true);
    try {
      // The handlers wrap the kiosk in the React tree: an event on its portal would bubble to them through React.
      renderWithSession(
        <div onClick={pressed} onPointerDown={pressed} onTouchStart={pressed} onKeyDown={pressed}>
          <button type="button" onClick={pressed}>Confirm</button>
          <Kiosk env={env()} />
        </div>,
      );
      await idle(5 * MIN);
      const rest = cover() as HTMLElement;
      fireEvent.pointerDown(rest);
      fireEvent.touchStart(rest);
      fireEvent.pointerUp(rest);
      fireEvent.touchEnd(rest);
      expect(cover(), 'still up until the finger has lifted a moment').toBeInTheDocument();
      await idle(LIFT_WAIT_MS);
      expect(cover()).not.toBeInTheDocument();
      expect(pressed).not.toHaveBeenCalled();
      expect(heard).not.toHaveBeenCalled();
      // Awake: the next tap is the page's.
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(pressed).toHaveBeenCalled();
    } finally {
      document.removeEventListener('pointerdown', heard, true);
      document.removeEventListener('click', heard, true);
    }
  });

  test('a key wakes it, is swallowed, and the focus goes back where it was', async () => {
    const pressed = vi.fn();
    renderWithSession(
      <div onKeyDown={pressed}>
        <button type="button" onClick={pressed}>Confirm</button>
        <Kiosk env={env()} />
      </div>,
    );
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    confirm.focus();
    await idle(5 * MIN);
    expect(cover()).toHaveFocus();
    const went = fireEvent.keyDown(cover() as HTMLElement, { key: 'Enter' });
    expect(went).toBe(false);
    expect(cover()).not.toBeInTheDocument();
    expect(confirm).toHaveFocus();
    expect(pressed).not.toHaveBeenCalled();
  });
});

// 2026-10-05 is a Monday.
const SUPPLIERS = [
  { id: 'm', name: 'Molino', orderDays: ['Monday'], deliveryDays: ['Monday'], active: true },
  { id: 'b', name: 'Brava Foods', shortName: 'Brava', orderDays: ['Monday'], active: true },
];
const HISTORY = [{ id: '2026-10-04_m', date: '2026-10-04', supplierId: 'm' }];

describe('the Orders lines (staff slice 6)', () => {
  test('somebody the venue shows Orders to sees what to order and what arrives today, large in the centre', async () => {
    const source = fakeKioskOrdersSource({ suppliers: SUPPLIERS, history: HISTORY });
    const orders = () => source;
    renderWithSession(<Kiosk env={env()} orders={orders} />);
    await idle(5 * MIN);
    const rest = cover() as HTMLElement;
    expect(rest).toHaveTextContent('To order today');
    expect(rest).toHaveTextContent('Brava');
    expect(rest).toHaveTextContent('Arriving today');
    expect(rest).toHaveTextContent('Molino');
    expect(source.readSuppliers).toHaveBeenCalledTimes(1);
  });

  test('read only while resting: nothing before, and nothing again on waking', async () => {
    const source = fakeKioskOrdersSource({ suppliers: SUPPLIERS, history: HISTORY });
    const orders = () => source;
    renderWithSession(<Kiosk env={env()} orders={orders} />);
    await idle(5 * MIN - TICK_MS);
    expect(source.readSuppliers).not.toHaveBeenCalled();
    await idle(TICK_MS);
    fireEvent.keyDown(cover() as HTMLElement, { key: 'a' });
    await idle(4 * MIN);
    expect(cover()).not.toBeInTheDocument();
    expect(source.readSuppliers, 'nothing while in use').toHaveBeenCalledTimes(1);
  });

  test('in Italian', async () => {
    const source = fakeKioskOrdersSource({ suppliers: SUPPLIERS, history: HISTORY });
    const orders = () => source;
    renderWithSession(<Kiosk env={env()} orders={orders} />, { lang: 'it', session: { language: 'it' } });
    await idle(5 * MIN);
    expect(cover()).toHaveTextContent('Da ordinare oggi');
    expect(cover()).toHaveTextContent('In arrivo oggi');
  });

  test('nobody else: no line and no read (the venue without Orders, or an employee it hides Orders from)', async () => {
    for (const session of [
      { location: { sections: { orders: false } } },
      { role: 'staff', canManage: false, canManageVenue: false, isOwner: false, location: { staffHiddenCards: { orders: true } } },
    ] as const) {
      const source = fakeKioskOrdersSource({ suppliers: SUPPLIERS, history: HISTORY });
      const orders = () => source;
      const { unmount } = renderWithSession(<Kiosk env={env()} orders={orders} />, { session });
      await idle(5 * MIN);
      expect(cover()).not.toHaveTextContent('To order today');
      expect(source.readSuppliers).not.toHaveBeenCalled();
      unmount();
    }
  });

  test('while the Orders section is open its live answer is drawn and nothing is read', async () => {
    const source = fakeKioskOrdersSource({ suppliers: SUPPLIERS, history: HISTORY });
    const orders = () => source;
    const stop = provideKioskLines(() => [{ titleKey: 'kiosk.rest.toOrderTitle', names: ['Live supplier'], more: 2 }]);
    try {
      renderWithSession(<Kiosk env={env()} orders={orders} />);
      await idle(5 * MIN);
      expect(cover()).toHaveTextContent('Live supplier');
      expect(cover()).toHaveTextContent('+2');
      expect(source.readSuppliers).not.toHaveBeenCalled();
    } finally { stop(); }
  });
});

describe('«Rest» on the Home (staff slice 6)', () => {
  test('covers the screen at once, and the tap that pressed it cannot wake it', async () => {
    renderWithSession(<Kiosk env={env()} />);
    act(() => { requestRestNow(); });
    const rest = cover() as HTMLElement;
    expect(rest).toBeInTheDocument();
    // The same gesture's late events land on the new cover: not armed yet, nothing wakes it.
    fireEvent.click(rest);
    fireEvent.keyDown(rest, { key: 'Enter' });
    expect(cover()).toBeInTheDocument();
    await idle(REST_NOW_GUARD_MS);
    fireEvent.keyDown(cover() as HTMLElement, { key: 'Enter' });
    expect(cover()).not.toBeInTheDocument();
  });

  test('does nothing with kiosk mode off', () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":false,"restMinutes":5,"nightHours":1}');
    renderWithSession(<Kiosk env={env()} />);
    act(() => { requestRestNow(); });
    expect(cover()).not.toBeInTheDocument();
  });
});
