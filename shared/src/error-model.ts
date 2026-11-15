// error-model.ts — the pure half of the error reports.
//
// TypeScript port of js/error-model.js for Mise 2. Behaviour is identical, input for input:
// error-model.spec.ts runs every test against BOTH files and parity.spec.ts compares their
// exports. The comments below are the ones the original paid for in bugs.
//
// The app tells the owner about its own errors so they can be fixed before anybody notices:
// an uncaught exception, a promise nobody handled, a console.error the app itself logged. This
// file turns what was caught into the line the rules accept (firestore.rules, match
// /errors/{id}), decides what is noise, and throttles a device so one broken screen cannot
// flood the database (P14).
//
// ⚠️ A MESSAGE IS WHAT THE CODE SAID, NEVER A DUMP OF DATA. An Error contributes its message; a
// string is taken as it is; any other object becomes «[object]» — it is never JSON.stringify'd,
// because the objects the app logs are recipes, orders and people.
//
// No imports, on purpose: this file also runs where the app's own modules do not exist.

export type ErrorSource = 'error' | 'rejection' | 'console';
export type DeviceKind = 'phone' | 'tablet' | 'computer';

// What the app keeps of something it caught. `filename` is kept on the record for isNoise() and
// is NOT part of the line.
export interface ErrorRecord {
  source: ErrorSource;
  message: string;
  code: string | null;
  stack: string | null;
  filename: string | null;
}

// The throttle's state for one device and one day.
export interface ThrottleState {
  day: string;
  count: number;
  sigs: string[];
}

// The line (see errorPayload).
export interface ErrorPayload {
  source: ErrorSource;
  screen: string | null;
  appVersion: string | null;
  deviceId: string | null;
  deviceKind: DeviceKind;
  online: boolean;
  code: string | null;
  message: string;
  stack: string | null;
}

export const MESSAGE_MAX = 300;
export const STACK_MAX = 2000;
export const STACK_LINES = 10;
export const CODE_MAX = 60;
export const SCREEN_MAX = 60;
export const VERSION_MAX = 12;
export const SOURCES: ErrorSource[] = ['error', 'rejection', 'console'];
export const DEVICE_KINDS: DeviceKind[] = ['phone', 'tablet', 'computer'];
// The same error at most once a device a day; at most this many lines a device a day.
export const DAILY_CAP = 20;
const SIGNATURE_MESSAGE = 120;
const DEVICE_ID_SHAPE = /^[A-Za-z0-9]{20}$/;
const SDK_TIMESTAMP = /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\]\s+/;
// Our own Firebase SDK is loaded from here; an error it throws is ours to hear about.
const SDK_ORIGIN = 'https://www.gstatic.com/firebasejs/';

// The fields this file reads from whatever was caught, or from a record built from it.
interface Loose {
  message?: unknown;
  stack?: unknown;
  code?: unknown;
  source?: unknown;
  filename?: unknown;
}

function isErrorLike(value: unknown): value is Loose {
  return !!value && typeof value === 'object'
    && (typeof (value as Loose).message === 'string' || typeof (value as Loose).stack === 'string');
}

function flat(text: unknown): string {
  return String(text).replace(/\s+/g, ' ').trim();
}

// One value → the text it contributes to a message.
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isErrorLike(value)) return typeof value.message === 'string' ? value.message : '';
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return '[object]';
  if (typeof value === 'function') return '[function]';
  return String(value);
}

function finishMessage(text: unknown): string {
  const message = flat(text).slice(0, MESSAGE_MAX).trim();
  return message || '(empty)';
}

// The first lines of a stack, cut to what the rules allow. No stack → null.
export function trimStack(stack: unknown): string | null {
  if (typeof stack !== 'string') return null;
  const lines = stack.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim() !== '');
  if (lines.length === 0) return null;
  const cut = lines.slice(0, STACK_LINES).join('\n').slice(0, STACK_MAX);
  return cut || null;
}

// A string of at most CODE_MAX, or null. Firebase's codes look like «permission-denied».
export function cleanCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.trim();
  return c && c.length <= CODE_MAX ? c : null;
}

// What window 'error' gave (an Error, or only text when the error was cross-origin).
// `filename` is kept on the record for isNoise() and is NOT part of the line.
export function recordFromError(
  error: unknown,
  { filename = null, message = null }: { filename?: unknown; message?: unknown } = {},
): ErrorRecord {
  if (isErrorLike(error)) {
    return {
      source: 'error',
      message: finishMessage(textOf(error)),
      code: cleanCode(error.code),
      stack: trimStack(error.stack),
      filename: typeof filename === 'string' && filename ? filename : null,
    };
  }
  return {
    source: 'error',
    message: finishMessage(typeof message === 'string' ? message : textOf(error)),
    code: null,
    stack: null,
    filename: typeof filename === 'string' && filename ? filename : null,
  };
}

// What 'unhandledrejection' gave: a reason of any type.
export function recordFromRejection(reason: unknown): ErrorRecord {
  const isError = isErrorLike(reason);
  return {
    source: 'rejection',
    message: finishMessage(textOf(reason)),
    code: isError ? cleanCode(reason.code) : null,
    stack: isError ? trimStack(reason.stack) : null,
    filename: null,
  };
}

// What console.error was called with.
export function recordFromConsole(args: unknown): ErrorRecord {
  const list: unknown[] = Array.isArray(args) ? args : [];
  const firstError = list.find(isErrorLike);
  const texts = list.map(item => textOf(item));
  // The Firebase SDK's logger starts every line with «[<ISO time>]  @firebase/…»: left in, each
  // line would get its own signature and burn the daily cap on one repeating problem.
  const head = list[0];
  if (typeof head === 'string') texts[0] = head.replace(SDK_TIMESTAMP, '');
  return {
    source: 'console',
    message: finishMessage(texts.join(' ')),
    code: firstError ? cleanCode(firstError.code) : null,
    stack: firstError ? trimStack(firstError.stack) : null,
    filename: null,
  };
}

// The first line of a stack that is a frame (not the «Error: …» heading). '' when none.
function firstFrame(stack: unknown): string {
  if (typeof stack !== 'string') return '';
  const lines = stack.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const frame = lines.find(l => /^at\s/.test(l) || l.includes('@'));
  return (frame || '').slice(0, 200);
}

// Two errors with the same signature are «the same error»: the throttle lets one through a day
// and the script groups them. `record` is typed unknown: whatever it is, it gets a signature.
export function signature(record: unknown): string {
  const r = record as Loose | null | undefined;
  const message = String(r && r.message ? r.message : '').slice(0, SIGNATURE_MESSAGE);
  return `${r && r.source}|${message}|${firstFrame(r && r.stack)}`;
}

// Things nobody can fix, so nobody should be told about them:
//  - ResizeObserver loop notices (a browser quirk, harmless);
//  - «Script error.» with no stack: a cross-origin script hid the details;
//  - an error thrown by a file from another origin (a browser extension) — only when both the
//    file and our own origin are known.
export function isNoise(record: unknown, { origin = null }: { origin?: unknown } = {}): boolean {
  const r = record as Loose | null | undefined;
  const message = String(r && r.message ? r.message : '');
  if (message.includes('ResizeObserver loop')) return true;
  if (/^script error\.?$/i.test(message.trim()) && !(r && r.stack)) return true;
  const file = r && r.filename;
  if (typeof file === 'string' && file && typeof origin === 'string' && origin) {
    if (file.startsWith(SDK_ORIGIN)) return false;
    return !file.startsWith(`${origin}/`) && file !== origin;
  }
  return false;
}

// The throttle's state, as read from storage (anything → a usable state for `today`).
export function normaliseState(state: unknown, today: string): ThrottleState {
  const stored = state as { day?: unknown; count?: unknown; sigs?: unknown } | null | undefined;
  if (!stored || typeof stored !== 'object' || stored.day !== today) return { day: today, count: 0, sigs: [] };
  const sigs = Array.isArray(stored.sigs)
    ? stored.sigs.filter((s): s is string => typeof s === 'string').slice(0, DAILY_CAP)
    : [];
  const kept = stored.count;
  const count = typeof kept === 'number' && Number.isInteger(kept) && kept >= 0 ? kept : sigs.length;
  return { day: today, count: Math.max(count, sigs.length), sigs };
}

// May this error be sent now? Same signature at most once per device per day; at most DAILY_CAP
// sends per device per day. Returns { send, state } — the caller stores `state`.
export function shouldSend(state: unknown, sig: string, today: string): { send: boolean; state: ThrottleState } {
  const current = normaliseState(state, today);
  if (current.sigs.includes(sig) || current.count >= DAILY_CAP) return { send: false, state: current };
  return {
    send: true,
    state: { day: today, count: current.count + 1, sigs: [...current.sigs, sig] },
  };
}

// 'orders', 'index'; the hash is added only when short and made of [a-z0-9-] (a route, never
// a token or a name). Always at most SCREEN_MAX characters.
export function screenName(pathname: unknown, hash: unknown): string {
  const path = String(pathname || '');
  // A folder address («/mise_app/») is the start page.
  const last = path.endsWith('/') ? '' : (path.split('/').pop() || '');
  const base = last.replace(/\.html$/i, '');
  const page = /^[A-Za-z0-9_-]+$/.test(base) ? base : 'index';
  const route = typeof hash === 'string' && /^#[a-z0-9-]{1,20}$/.test(hash) ? hash : '';
  return `${page}${route}`.slice(0, SCREEN_MAX);
}

// Is this one of the kinds of device the rules know?
function isDeviceKind(value: unknown): value is DeviceKind {
  return (DEVICE_KINDS as readonly unknown[]).includes(value);
}

// The fields of the line, without bakery, uid and createdAt (the data layer adds those).
// Null when it could not be a line the rules would accept.
export function errorPayload(
  record: unknown,
  { screen, appVersion, deviceId, kind, online }:
    { screen?: unknown; appVersion?: unknown; deviceId?: unknown; kind?: unknown; online?: unknown } = {},
): ErrorPayload | null {
  const r = record as Loose | null | undefined;
  if (!r || !(SOURCES as readonly unknown[]).includes(r.source)) return null;
  if (typeof r.message !== 'string' || r.message.length === 0) return null;
  return {
    source: r.source as ErrorSource,
    screen: typeof screen === 'string' && screen && screen.length <= SCREEN_MAX ? screen : null,
    appVersion: typeof appVersion === 'string' && appVersion && appVersion.length <= VERSION_MAX ? appVersion : null,
    deviceId: typeof deviceId === 'string' && DEVICE_ID_SHAPE.test(deviceId) ? deviceId : null,
    deviceKind: isDeviceKind(kind) ? kind : 'computer',
    online: online === true,
    code: cleanCode(r.code),
    message: r.message.slice(0, MESSAGE_MAX),
    stack: trimStack(r.stack),
  };
}
