import { describe, expect, test } from 'vitest';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import type { KeyValueStorage } from '../session/backend';
import type { TelemetrySession } from './common';
import { createReporter, THROTTLE_KEY } from './errorReport';
import { pingIfDue, DEVICE_ID_KEY, PING_DAY_KEY_PREFIX } from './devicePing';
import { createTracker, storeKey, LAST_KEY, SEND_EVERY_MS } from './usage';

// ⚠️ MISE 2 SHARES THE CURRENT APP'S localStorage, AND THE CURRENT APP'S SIGN-OUT WIPES EVERY KEY
// THAT DOES NOT START WITH A KEPT PREFIX (local-data's KEEP_PREFIXES). A telemetry key outside the
// list would be erased at every sign-out and venue switch: the error throttle would reset (a way
// round the daily cap), a phone would count as a new device, and the usage day would restart with
// smaller totals that replace the bigger line already on the server.
//
// So this spec RUNS the three modules and looks at every key they actually write, instead of
// trusting a list of constants.

const READY: TelemetrySession = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };

function recordingStorage() {
  const data: Record<string, string> = {};
  const written = new Set<string>();
  const storage: KeyValueStorage = {
    getItem: k => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => { data[k] = String(v); written.add(k); },
    removeItem: k => { delete data[k]; },
  };
  return { storage, written, data };
}

const kept = (key: string): boolean => KEEP_PREFIXES.some(prefix => key.startsWith(prefix));

describe('every key the telemetry writes survives a sign-out and a venue switch', () => {
  test('the error reporter\'s throttle', async () => {
    const { storage, written } = recordingStorage();
    const reporter = createReporter({
      storage, now: () => new Date(2026, 9, 9, 10, 0), origin: () => 'https://app.test', screen: () => 'm2:orders',
      deviceId: () => null, kind: () => 'phone', online: () => true, version: () => 'm2-abc1234', send: async () => {},
    });
    reporter.setSession(READY);
    reporter.report({ source: 'error', message: 'boom', code: null, stack: null, filename: null });
    await new Promise(r => setTimeout(r, 10));
    expect([...written]).toEqual([THROTTLE_KEY]);
    expect(written.size > 0 && [...written].every(kept)).toBe(true);
  });

  test('the device count\'s id and daily stamp', async () => {
    const { storage, written } = recordingStorage();
    const result = await pingIfDue(READY, {
      storage, randomBytes: () => Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 200),
      now: () => new Date(2026, 9, 9, 10, 0), kind: () => 'phone', installed: () => false,
      version: () => 'm2-abc1234', send: async () => {},
    });
    expect(result).toBe('sent');
    expect([...written].sort()).toEqual([DEVICE_ID_KEY, `${PING_DAY_KEY_PREFIX}bakery-u1`].sort());
    expect([...written].every(kept)).toBe(true);
  });

  test('the usage tracker\'s last screen and day record, before and after a send', async () => {
    const { storage, written, data } = recordingStorage();
    let now = new Date(2026, 9, 9, 10, 0).getTime();
    const tracker = createTracker({
      storage, now: () => new Date(now), keys: () => Object.keys(data).filter(k => k.startsWith('usage-')),
      visible: () => true, online: () => true, navigationMs: () => 900,
      deviceId: () => 'AbCdEfGhIjKlMnOpQrSt', kind: () => 'phone', version: () => 'm2-abc1234',
      currentSession: () => READY, send: async () => {},
    });
    tracker.begin('m2');
    tracker.view('m2', 'orders');
    tracker.action('order-sent');
    tracker.setSession(READY);
    now += SEND_EVERY_MS + 1000;
    expect(await tracker.flush('timer')).toBe('sent');
    await new Promise(r => setTimeout(r, 0));
    expect([...written].sort()).toEqual([LAST_KEY, storeKey('bakery', 'u1', '20261009')].sort());
    expect([...written].every(kept)).toBe(true);
  });

  test('a sign-out wipes none of them, and still wipes what is not on the list', () => {
    const keys = [
      THROTTLE_KEY, DEVICE_ID_KEY, `${PING_DAY_KEY_PREFIX}bakery-u1`, LAST_KEY, storeKey('bakery', 'u1', '20261009'),
    ];
    expect(keysToClear(keys)).toEqual([]);
    expect(keysToClear([...keys, 'recipes-cache'])).toEqual(['recipes-cache']);
  });
});
