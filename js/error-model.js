// error-model.js — the pure half of the error reports (js/error-report.js).
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
// Zero imports: the tests run this without a browser.

export const MESSAGE_MAX = 300;
export const STACK_MAX = 2000;
export const STACK_LINES = 10;
export const CODE_MAX = 60;
export const SCREEN_MAX = 60;
export const VERSION_MAX = 12;
export const SOURCES = ['error', 'rejection', 'console'];
export const DEVICE_KINDS = ['phone', 'tablet', 'computer'];
// The same error at most once a device a day; at most this many lines a device a day.
export const DAILY_CAP = 20;
const SIGNATURE_MESSAGE = 120;
const DEVICE_ID_SHAPE = /^[A-Za-z0-9]{20}$/;
const SDK_TIMESTAMP = /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\]\s+/;
// Our own Firebase SDK is loaded from here; an error it throws is ours to hear about.
const SDK_ORIGIN = 'https://www.gstatic.com/firebasejs/';

function isErrorLike(value) {
  return !!value && typeof value === 'object'
    && (typeof value.message === 'string' || typeof value.stack === 'string');
}

function flat(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

// One value → the text it contributes to a message.
function textOf(value) {
  if (typeof value === 'string') return value;
  if (isErrorLike(value)) return typeof value.message === 'string' ? value.message : '';
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return '[object]';
  if (typeof value === 'function') return '[function]';
  return String(value);
}

function finishMessage(text) {
  const message = flat(text).slice(0, MESSAGE_MAX).trim();
  return message || '(empty)';
}

// The first lines of a stack, cut to what the rules allow. No stack → null.
export function trimStack(stack) {
  if (typeof stack !== 'string') return null;
  const lines = stack.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim() !== '');
  if (lines.length === 0) return null;
  const cut = lines.slice(0, STACK_LINES).join('\n').slice(0, STACK_MAX);
  return cut || null;
}

// A string of at most CODE_MAX, or null. Firebase's codes look like «permission-denied».
export function cleanCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim();
  return c && c.length <= CODE_MAX ? c : null;
}

// What window 'error' gave (an Error, or only text when the error was cross-origin).
// `filename` is kept on the record for isNoise() and is NOT part of the line.
export function recordFromError(error, { filename = null, message = null } = {}) {
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
export function recordFromRejection(reason) {
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
export function recordFromConsole(args) {
  const list = Array.isArray(args) ? args : [];
  const firstError = list.find(isErrorLike);
  const texts = list.map(textOf);
  // The Firebase SDK's logger starts every line with «[<ISO time>]  @firebase/…»: left in, each
  // line would get its own signature and burn the daily cap on one repeating problem.
  if (typeof list[0] === 'string') texts[0] = texts[0].replace(SDK_TIMESTAMP, '');
  return {
    source: 'console',
    message: finishMessage(texts.join(' ')),
    code: firstError ? cleanCode(firstError.code) : null,
    stack: firstError ? trimStack(firstError.stack) : null,
    filename: null,
  };
}

// The first line of a stack that is a frame (not the «Error: …» heading). '' when none.
function firstFrame(stack) {
  if (typeof stack !== 'string') return '';
  const lines = stack.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const frame = lines.find(l => /^at\s/.test(l) || l.includes('@'));
  return (frame || '').slice(0, 200);
}

// Two errors with the same signature are «the same error»: the throttle lets one through a day
// and the script groups them.
export function signature(record) {
  const message = String(record && record.message ? record.message : '').slice(0, SIGNATURE_MESSAGE);
  return `${record && record.source}|${message}|${firstFrame(record && record.stack)}`;
}

// Things nobody can fix, so nobody should be told about them:
//  - ResizeObserver loop notices (a browser quirk, harmless);
//  - «Script error.» with no stack: a cross-origin script hid the details;
//  - an error thrown by a file from another origin (a browser extension) — only when both the
//    file and our own origin are known.
export function isNoise(record, { origin = null } = {}) {
  const message = String(record && record.message ? record.message : '');
  if (message.includes('ResizeObserver loop')) return true;
  if (/^script error\.?$/i.test(message.trim()) && !(record && record.stack)) return true;
  const file = record && record.filename;
  if (typeof file === 'string' && file && typeof origin === 'string' && origin) {
    if (file.startsWith(SDK_ORIGIN)) return false;
    return !file.startsWith(`${origin}/`) && file !== origin;
  }
  return false;
}

// The throttle's state, as read from storage (anything → a usable state for `today`).
export function normaliseState(state, today) {
  if (!state || typeof state !== 'object' || state.day !== today) return { day: today, count: 0, sigs: [] };
  const sigs = Array.isArray(state.sigs) ? state.sigs.filter(s => typeof s === 'string').slice(0, DAILY_CAP) : [];
  const count = Number.isInteger(state.count) && state.count >= 0 ? state.count : sigs.length;
  return { day: today, count: Math.max(count, sigs.length), sigs };
}

// May this error be sent now? Same signature at most once per device per day; at most DAILY_CAP
// sends per device per day. Returns { send, state } — the caller stores `state`.
export function shouldSend(state, sig, today) {
  const current = normaliseState(state, today);
  if (current.sigs.includes(sig) || current.count >= DAILY_CAP) return { send: false, state: current };
  return {
    send: true,
    state: { day: today, count: current.count + 1, sigs: [...current.sigs, sig] },
  };
}

// 'orders', 'index'; the hash is added only when short and made of [a-z0-9-] (a route, never
// a token or a name). Always at most SCREEN_MAX characters.
export function screenName(pathname, hash) {
  const path = String(pathname || '');
  // A folder address («/mise_app/») is the start page.
  const last = path.endsWith('/') ? '' : (path.split('/').pop() || '');
  const base = last.replace(/\.html$/i, '');
  const page = /^[A-Za-z0-9_-]+$/.test(base) ? base : 'index';
  const route = typeof hash === 'string' && /^#[a-z0-9-]{1,20}$/.test(hash) ? hash : '';
  return `${page}${route}`.slice(0, SCREEN_MAX);
}

// The fields of the line, without bakery, uid and createdAt (the data layer adds those).
// Null when it could not be a line the rules would accept.
export function errorPayload(record, { screen, appVersion, deviceId, kind, online } = {}) {
  if (!record || !SOURCES.includes(record.source)) return null;
  if (typeof record.message !== 'string' || record.message.length === 0) return null;
  return {
    source: record.source,
    screen: typeof screen === 'string' && screen && screen.length <= SCREEN_MAX ? screen : null,
    appVersion: typeof appVersion === 'string' && appVersion && appVersion.length <= VERSION_MAX ? appVersion : null,
    deviceId: typeof deviceId === 'string' && DEVICE_ID_SHAPE.test(deviceId) ? deviceId : null,
    deviceKind: DEVICE_KINDS.includes(kind) ? kind : 'computer',
    online: online === true,
    code: cleanCode(record.code),
    message: record.message.slice(0, MESSAGE_MAX),
    stack: trimStack(record.stack),
  };
}
