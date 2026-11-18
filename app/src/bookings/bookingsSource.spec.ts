import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import type { BookingData } from './bookingModel';
import { DEFAULT_SETTINGS } from './bookingSettings';
import { createFirestoreBookingsSource } from './bookingsSource';

// The writes of the bookings source that the rules judge field by field (bookings settings, 18 Nov 2026), against a recording fake
// of the Firestore SDK. ⚠️ A merge never removes a key by itself: a booking moved from a slot to an exact time keeping its old
// `slotEnd` would be refused by the rules at every later save (an end before the start). Fake customers only.

type Ref = { kind: string; path: string };
const SERVER_TIME = { sentinel: 'serverTimestamp' };
const DELETE = { sentinel: 'deleteField' };

function make() {
  const fs = {
    collection: (_db: unknown, path: string): Ref => ({ kind: 'collection', path }),
    doc: (_db: unknown, path: string, id: string): Ref => ({ kind: 'doc', path: `${path}/${id}` }),
    serverTimestamp: () => SERVER_TIME,
    deleteField: () => DELETE,
    setDoc: vi.fn(async (..._args: unknown[]) => undefined),
    updateDoc: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return { fs, source: createFirestoreBookingsSource(() => Promise.resolve(kit), 'panificio-miano') };
}

const data = (over: Partial<BookingData> = {}): BookingData => ({
  customerName: 'Mario Prova', phone: '', mode: 'pickup', address: '', date: '2026-12-24', time: '09:00', slotEnd: '10:00',
  lines: [{ recipeId: null, productId: null, unitPrice: null, name: 'Pane', qty: 2, unit: 'pcs' }],
  deposit: null, total: null, notes: '', status: 'todo', number: 4, ...over,
});

describe('bookings with time slots', () => {
  test('a new booking in a slot carries slotEnd; one at an exact time carries no slotEnd key at all (never null)', async () => {
    const { fs, source } = make();
    await source.create(data()).written;
    await source.create(data({ time: '09:40', slotEnd: null })).written;
    const [first, second] = fs.setDoc.mock.calls.map(call => call[1] as Record<string, unknown>);
    expect(first).toMatchObject({ bakery: 'panificio-miano', time: '09:00', slotEnd: '10:00', phone: '' });
    expect(second).not.toHaveProperty('slotEnd');
  });

  test('⚠️ an edit to an exact time DELETES slotEnd in the same merge', async () => {
    const { fs, source } = make();
    await source.update('B1', data({ time: '11:00', slotEnd: null }));
    const [ref, payload, options] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>, unknown];
    expect(ref.path).toBe('locations/panificio-miano/bookings/B1');
    expect(options).toEqual({ merge: true });
    expect(payload).toMatchObject({ time: '11:00', slotEnd: DELETE, updatedAt: SERVER_TIME });
  });

  test('an edit to another slot writes its end', async () => {
    const { fs, source } = make();
    await source.update('B1', data({ time: '10:00', slotEnd: '11:00' }));
    expect(fs.setDoc.mock.calls[0]?.[1]).toMatchObject({ time: '10:00', slotEnd: '11:00' });
  });
});

describe('the settings', () => {
  test('written to config/bookings with merge, stamped, only what changed; cleared slots and limit deleted', async () => {
    const { fs, source } = make();
    const slots = { ...DEFAULT_SETTINGS, slotFirst: '08:00', slotLast: '12:00', slotLimit: 3 };
    await source.saveSettings({ ...DEFAULT_SETTINGS, modes: 'pickup' }, slots);
    const [ref, payload, options] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>, unknown];
    expect(ref.path).toBe('locations/panificio-miano/config/bookings');
    expect(options).toEqual({ merge: true });
    expect(payload).toEqual({ bakery: 'panificio-miano', modes: 'pickup', slotFirst: DELETE, slotLast: DELETE, slotLimit: DELETE });
  });
});
