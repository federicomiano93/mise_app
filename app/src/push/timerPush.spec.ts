import { afterEach, describe, expect, test, vi } from 'vitest';
import type { KeyValueStorage } from '../session/backend';
import { createTimerPush } from './timerPush';
import type { TimerPushDeps } from './timerPush';

// Booking a server push for a guided-mix timer: js/push.js scheduleAlarm / cancelAlarm, with the browser and Firebase replaced.

const NOW = 1_800_000_000_000;
const READY = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } } as const;

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

type Write = (...args: unknown[]) => Promise<unknown>;

function build(over: Partial<TimerPushDeps> = {}, fsOver: { setDoc?: Write; updateDoc?: Write } = {}) {
  const setDoc = vi.fn<(ref: unknown, data: unknown) => Promise<unknown>>(fsOver.setDoc ?? (async () => undefined));
  const updateDoc = vi.fn(fsOver.updateDoc ?? (async () => undefined));
  const doc = vi.fn((_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` }));
  const kit = { fs: { setDoc, updateDoc, doc }, db: 'db' } as unknown as Awaited<ReturnType<TimerPushDeps['firestore']>>;
  const timerPush = createTimerPush({
    phonePush: { support: () => 'granted', onForMe: uid => uid === 'u1' },
    storage: memoryStorage({ 'push-token': 'tok-1', 'push-token-uid': 'u1' }),
    session: () => READY,
    online: () => true,
    now: () => NOW,
    firestore: async () => kit,
    ...over,
  });
  return { timerPush, setDoc, updateDoc };
}

const BOOKING = { id: 'r1-1-0-1', fireAt: NOW + 90_000, title: 'Focaccia', body: 'Mix the flour' };

afterEach(() => { vi.restoreAllMocks(); });

describe('schedule', () => {
  test('⚠️ books a create on locations/{lid}/push-timers/{id} with the bakery stamped and active true', async () => {
    const { timerPush, setDoc } = build();
    expect(await timerPush.schedule(BOOKING)).toBe('r1-1-0-1');
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledWith({ path: 'locations/bakery/push-timers/r1-1-0-1' }, {
      bakery: 'bakery', uid: 'u1', token: 'tok-1', fireAt: NOW + 90_000, title: 'Focaccia', body: 'Mix the flour', active: true, createdAt: NOW,
    });
  });

  const REFUSED: [string, Partial<TimerPushDeps>][] = [
    ['notifications are not granted', { phonePush: { support: () => 'ask', onForMe: () => true } }],
    ['the phone is registered for somebody else', { phonePush: { support: () => 'granted', onForMe: () => false } }],
    ['the phone is offline', { online: () => false }],
    ['no venue is open', { session: () => ({ status: 'choose-location', locationId: null, user: { uid: 'u1' } }) }],
    ['nobody is signed in', { session: () => ({ status: 'ready', locationId: 'bakery', user: null }) }],
    ['the phone holds no token', { storage: memoryStorage() }],
  ];
  test.each(REFUSED)('books nothing and writes nothing when %s', async (_name, over) => {
    const { timerPush, setDoc } = build(over);
    expect(await timerPush.schedule(BOOKING)).toBe('');
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('books nothing for a timer under 30 seconds or over 12 hours ahead', async () => {
    const { timerPush, setDoc } = build();
    expect(await timerPush.schedule({ ...BOOKING, fireAt: NOW + 29_000 })).toBe('');
    expect(await timerPush.schedule({ ...BOOKING, fireAt: NOW + 13 * 3_600_000 })).toBe('');
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('books nothing for an empty title or an id that could be a path', async () => {
    const { timerPush, setDoc } = build();
    expect(await timerPush.schedule({ ...BOOKING, title: '   ' })).toBe('');
    expect(await timerPush.schedule({ ...BOOKING, id: '' })).toBe('');
    expect(await timerPush.schedule({ ...BOOKING, id: 'a/b' })).toBe('');
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('trims a long title and body to the limits instead of refusing', async () => {
    const { timerPush, setDoc } = build();
    expect(await timerPush.schedule({ ...BOOKING, title: 'T'.repeat(200), body: 'B'.repeat(500) })).toBe('r1-1-0-1');
    const payload = setDoc.mock.calls[0]?.[1] as { title: string; body: string };
    expect(payload.title.length).toBeLessThanOrEqual(80);
    expect(payload.body.length).toBeLessThanOrEqual(160);
  });

  test('⚠️ never throws when the write is refused, and logs the error code alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { timerPush } = build({}, { setDoc: async () => { throw Object.assign(new Error('locations/bakery/push-timers/secret-id'), { code: 'permission-denied' }); } });
    expect(await timerPush.schedule(BOOKING)).toBe('');
    expect(warn).toHaveBeenCalledWith('Could not schedule a notification:', 'permission-denied');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-id');
  });

  test('never throws when the write never answers: the time limit gives up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { timerPush } = build({ writeTimeoutMs: 20 }, { setDoc: () => new Promise(() => undefined) });
    expect(await timerPush.schedule(BOOKING)).toBe('');
  });

  test('never throws when the session itself throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { timerPush } = build({ session: () => { throw new Error('boom'); } });
    expect(await timerPush.schedule(BOOKING)).toBe('');
  });
});

describe('cancel', () => {
  test('⚠️ marks {active: false} and nothing else, never deleting', async () => {
    const { timerPush, updateDoc } = build();
    timerPush.cancel('r1-1-0-1');
    await vi.waitFor(() => { expect(updateDoc).toHaveBeenCalledTimes(1); });
    expect(updateDoc).toHaveBeenCalledWith({ path: 'locations/bakery/push-timers/r1-1-0-1' }, { active: false });
  });

  test('does nothing for an empty id', () => {
    const { timerPush, updateDoc } = build();
    timerPush.cancel('');
    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('never throws when the update fails, and logs the error code alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { timerPush } = build({}, { updateDoc: async () => { throw Object.assign(new Error('path'), { code: 'not-found' }); } });
    expect(() => { timerPush.cancel('r1-1-0-1'); }).not.toThrow();
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('Could not cancel a scheduled notification:', 'not-found'); });
  });

  test('never throws when no venue is open', () => {
    const { timerPush, updateDoc } = build({ session: () => null });
    expect(() => { timerPush.cancel('x'); }).not.toThrow();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
