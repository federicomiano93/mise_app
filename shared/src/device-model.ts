// device-model.ts — the pure half of the device count.
//
// TypeScript port of js/device-model.js for Mise 2. Behaviour is identical, input for input:
// device-model.spec.ts runs every test against BOTH files and parity.spec.ts compares their
// exports. The comments below are the ones the original paid for in bugs.
//
// The owner wants to know how many devices use the app in each venue, what kind they are
// (phone, tablet, computer; installed or in a browser; which release) and whose they are. So
// the line a device writes (locations/{lid}/devices/{id}) carries a random id made on the
// device, the signed-in account's uid and four facts about the device: never a name or email. The
// rules (firestore.rules, match /devices/{id}) pin that exact shape, and uid == request.auth.uid.
//
// No imports, on purpose: this file also runs where the app's own modules do not exist.

export type DeviceKind = 'phone' | 'tablet' | 'computer';

// The line a device writes, without lastSeen (see devicePayload).
export interface DevicePayload {
  bakery: string;
  uid: string;
  kind: DeviceKind;
  appVersion: string | null;
  installed: boolean;
}

const ID_LENGTH = 20;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_SHAPE = /^[A-Za-z0-9]{20}$/;
// The rules accept an appVersion of at most 12 characters.
const VERSION_MAX = 12;
export const DEVICE_KINDS: DeviceKind[] = ['phone', 'tablet', 'computer'];

// What kind of device is this?
//
// The SHORTER side of the SCREEN (not the window): a keyboard that pops up, a split view or
// a resized browser window must not turn a phone into something else. In CSS pixels.
//   - under 600           → phone
//   - 600 or more, coarse → tablet   (the primary pointer is a finger)
//   - 600 or more, fine   → computer (the primary pointer is a mouse)
// Anything unreadable falls to 'computer', the least specific answer.
export function deviceKind(
  { width, height, coarse }: { width?: unknown; height?: unknown; coarse?: unknown } = {},
): DeviceKind {
  const sides = [width, height].map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (sides.length === 0) return 'computer';
  const shorter = Math.min(...sides);
  if (shorter < 600) return 'phone';
  return coarse ? 'tablet' : 'computer';
}

// 20 characters from [A-Za-z0-9], made from bytes the caller drew from a secure source
// (crypto.getRandomValues). A byte is used only when it is below 248 (= 4 × 62), so every
// character is equally likely (no modulo bias). Hand it more than 20 bytes — 64 is plenty;
// the chance of running out is below one in a billion. Not enough usable bytes → null.
export function newDeviceId(randomBytes: unknown): string | null {
  const bytes: ArrayLike<unknown> = randomBytes && typeof (randomBytes as { length?: unknown }).length === 'number'
    ? (randomBytes as ArrayLike<unknown>)
    : [];
  let id = '';
  for (let i = 0; i < bytes.length && id.length < ID_LENGTH; i += 1) {
    const b = bytes[i];
    // b % 62 is 0–61 for every byte that gets here, so the character always exists.
    if (typeof b === 'number' && Number.isInteger(b) && b >= 0 && b < 248) id += ID_ALPHABET.charAt(b % 62);
  }
  return id.length === ID_LENGTH ? id : null;
}

export function isValidDeviceId(value: unknown): boolean {
  return typeof value === 'string' && ID_SHAPE.test(value);
}

// 'YYYY-MM-DD' in the device's own local time.
export function localDayKey(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// What this file reads from a session (the app's own session object, whatever else it holds).
interface SessionLike {
  status?: unknown;
  locationId?: unknown;
  user?: { uid?: unknown } | null;
}

interface ReadySession extends SessionLike {
  user: { uid?: unknown };
}

// Is `b` still the session `a` was taken from? The ping waits a moment after the session is
// ready; by then the person may have signed out, switched venue or been replaced by someone else
// on a shared tablet, and the line must never be written under the wrong venue or account.
export function sameSession(a: unknown, b: unknown): boolean {
  const ready = (s: unknown): s is ReadySession => {
    const session = s as SessionLike | null | undefined;
    return !!session && session.status === 'ready' && !!session.locationId && !!(session.user && session.user.uid);
  };
  return ready(a) && ready(b) && a.locationId === b.locationId && a.user.uid === b.user.uid;
}

// Has this device NOT yet told THIS venue about today? `lastStamp` is the day key stored for
// this venue and account (or anything else, or nothing). At most one write per device per venue
// per person per day (P14).
export function dueToday(lastStamp: unknown, todayKey: unknown): boolean {
  if (typeof todayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) return false;
  return lastStamp !== todayKey;
}

// Is this one of the kinds of device the rules know?
function isDeviceKind(value: unknown): value is DeviceKind {
  return (DEVICE_KINDS as readonly unknown[]).includes(value);
}

// The fields of the line, without lastSeen (the data layer adds the server's clock).
// Null when it could not be a line the rules would accept.
export function devicePayload(
  { locationId, uid, kind, appVersion, installed }:
    { locationId?: unknown; uid?: unknown; kind?: unknown; appVersion?: unknown; installed?: unknown } = {},
): DevicePayload | null {
  if (typeof locationId !== 'string' || !locationId) return null;
  if (typeof uid !== 'string' || !uid) return null;
  if (!isDeviceKind(kind)) return null;
  const version = typeof appVersion === 'string' && appVersion.length > 0 && appVersion.length <= VERSION_MAX
    ? appVersion
    : null;
  return { bakery: locationId, uid, kind, appVersion: version, installed: installed === true };
}
