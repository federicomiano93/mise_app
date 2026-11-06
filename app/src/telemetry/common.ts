// common.ts — what the three telemetry modules (errorReport, devicePing, usage) share.
//
// In the current app each of the three files carries its own copy of these few lines. They are
// here once, with the same behaviour, so the three cannot drift apart.

import { deviceKind, type DeviceKind } from '@mise/shared/device-model';
import type { KeyValueStorage } from '../session/backend';

// What the telemetry reads from a session. Every field is optional on purpose: the telemetry
// must tolerate a session of any state (`{ status: 'signed-out' }`) and a damaged one. The app's
// own `Session` (src/session/session.ts) is assignable to it.
export interface TelemetrySession {
  readonly status?: string;
  readonly locationId?: string | null;
  readonly user?: { readonly uid?: string } | null;
}

// A session that can be written under: signed in, with a venue open.
export interface ReadySession extends TelemetrySession {
  readonly status: 'ready';
  readonly locationId: string;
  readonly user: { readonly uid: string };
}

export function isReadySession(session: TelemetrySession | null | undefined): session is ReadySession {
  return !!session && session.status === 'ready' && !!session.locationId && !!(session.user && session.user.uid);
}

// Where the sessions come from. The app's SessionStore (getSnapshot + subscribe) is one.
//
// ⚠️ `subscribe` does NOT call back at once, unlike the current app's onSession(): whoever
// starts a module hands the current snapshot to it too (see the start functions).
export interface SessionSource {
  getSnapshot(): TelemetrySession;
  subscribe(listener: () => void): () => void;
}

// This device's storage, or null when the browser will not give it (blocked site data): such a
// device simply remembers nothing, which every module treats as a reason to say less, never more.
export function browserStorage(): KeyValueStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readJson(storage: Pick<KeyValueStorage, 'getItem'>, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The kind of device, from its screen and its pointer (js/device-model's rule, in the browser).
export function browserDeviceKind(): DeviceKind {
  return deviceKind({
    width: screen.width,
    height: screen.height,
    coarse: window.matchMedia('(pointer: coarse)').matches,
  });
}

// The code of an error, and nothing else of it: a message can carry a person's data, a code
// («permission-denied») never does. This is all the telemetry ever prints about its own failures.
export function errorCode(err: unknown): string {
  const code = err ? (err as { code?: unknown }).code : undefined;
  return code ? String(code) : 'unknown';
}

// Only these codes mean «asking again won't help»: a refusal by the rules does not heal by
// retrying on every page of the day.
export function isFinalRefusal(err: unknown): boolean {
  const code = err ? (err as { code?: unknown }).code : undefined;
  const text = code ? String(code) : '';
  return text === 'permission-denied' || text === 'invalid-argument';
}
