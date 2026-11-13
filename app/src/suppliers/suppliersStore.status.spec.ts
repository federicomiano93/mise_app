import { describe, expect, test } from 'vitest';
import { LIST_STATUS } from '@mise/shared/list-status';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { STALL_MS, createSuppliersStore } from './suppliersStore';

// What the empty lists may say (the current app's listStatus, js/orders/registry.js): «Loading…», then «has not arrived» after
// STALL_MS without an answer or with the phone offline and only an empty copy — and back to the rows the moment the list answers.

const tick = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

// A clock the spec winds by hand, and a navigator.onLine it sets.
function harness(source = fakeSuppliersSource(), online: boolean | undefined = true) {
  const timers = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 1;
  let onLine: boolean | undefined = online;
  const store = createSuppliersStore(source, {
    markBusy: () => () => undefined,
    setTimer: (run, ms) => { timers.set(next, { at: now + ms, run }); return next++; },
    clearTimer: handle => { timers.delete(handle as number); },
    online: () => onLine,
  });
  store.start();
  return {
    store,
    status: () => ({ suppliers: store.getSnapshot().suppliersStatus, ingredients: store.getSnapshot().ingredientsStatus }),
    wind(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(handle); timer.run(); }
      }
    },
    setOnline(value: boolean | undefined) { onLine = value; },
    pending: () => timers.size,
  };
}

describe('the suppliers store: what an empty list may say', () => {
  test('⚠️ nothing answered: waiting, then not arrived after STALL_MS (10 s), and the rows end it', async () => {
    const source = fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour' }] });
    source.hold();
    const h = harness(source);
    await tick();
    expect(STALL_MS).toBe(10_000);
    expect(h.status()).toEqual({ suppliers: LIST_STATUS.waiting, ingredients: LIST_STATUS.waiting });
    h.wind(STALL_MS - 1);
    expect(h.status().ingredients).toBe(LIST_STATUS.waiting);
    h.wind(1);
    expect(h.status()).toEqual({ suppliers: LIST_STATUS.unreachable, ingredients: LIST_STATUS.unreachable });
    source.release();
    expect(h.status()).toEqual({ suppliers: LIST_STATUS.answered, ingredients: LIST_STATUS.answered });
  });

  test('a list that answers before the clock runs out is never «not arrived»', async () => {
    const h = harness(fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour' }] }));
    await tick();
    h.wind(STALL_MS);
    expect(h.status().ingredients).toBe(LIST_STATUS.answered);
  });

  test('⚠️ an empty copy from the browser is not an answer: waiting online, not arrived at once offline, answered when the server says none', async () => {
    const source = fakeSuppliersSource();
    source.fromCache = true;
    const online = harness(source, true);
    await tick();
    expect(online.status().suppliers).toBe(LIST_STATUS.waiting);
    const offline = harness(source, false);
    await tick();
    expect(offline.status().suppliers).toBe(LIST_STATUS.unreachable);
    // The server speaks: «none» is now true.
    source.fromCache = false;
    source.push();
    expect(offline.status()).toEqual({ suppliers: LIST_STATUS.answered, ingredients: LIST_STATUS.answered });
  });

  test('a copy that holds rows is an answer (the server follows in a moment)', async () => {
    const source = fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Zed' }] });
    source.fromCache = true;
    const h = harness(source, false);
    await tick();
    expect(h.status().suppliers).toBe(LIST_STATUS.answered);
    expect(h.status().ingredients).toBe(LIST_STATUS.unreachable);
  });

  test('stop() ends the clock, and start() again begins a new wait', async () => {
    const source = fakeSuppliersSource();
    source.hold();
    const h = harness(source);
    expect(h.pending()).toBe(1);
    h.store.stop();
    expect(h.pending()).toBe(0);
    h.store.start();
    h.wind(STALL_MS);
    expect(h.status().suppliers).toBe(LIST_STATUS.unreachable);
  });
});
