// swHarness.ts — a service-worker world, complete enough to EXECUTE a worker file in node:vm.
//
// ⚠️ EXECUTED, NEVER READ AS TEXT (as tests/precache-install.test.mjs does for the current app): a promise
// that is never created never rejects, and a grep cannot tell `allSettled` from a throw. Every helper that
// fires an event first asserts the worker took it (waitUntil / respondWith called), so a harness that failed
// to run a handler cannot report a pass.
//
// ONE world can run SEVERAL workers in turn, on the same caches — which is what the rollback spec needs: Mise
// 2's worker installed, then the current app's sw.js replacing it.
//
// The caches, the server and the storages are fakes; Request, Response, Headers, URL, TextDecoder and
// crypto.subtle are Node's own (the real SHA-256 and SHA-1).

import vm from 'node:vm';

export const ORIGIN = 'https://federicomiano93.github.io';
export const BASE = '/mise_app/';
export const SCOPE = `${ORIGIN}${BASE}`;

export interface ServedFile { body: Uint8Array<ArrayBuffer> | string; type?: string }

export interface World {
  // url (absolute) → what the server answers; a function lets a test change the answer per attempt.
  server: Map<string, ServedFile | ((attempt: number) => ServedFile | 'fail' | 404)>;
  caches: Map<string, Map<string, Response>>;
  fetched: string[];
  deleted: string[];
  skipWaiting: number;
  notifications: { title: string; options: Record<string, unknown> }[];
  opened: string[];
  // Any touch of these fails the test: a worker must never reach the person's data.
  storageTouched: string[];
}

export function createWorld(): World {
  return { server: new Map(), caches: new Map(), fetched: [], deleted: [], skipWaiting: 0, notifications: [], opened: [], storageTouched: [] };
}

const bytesOf = (body: Uint8Array<ArrayBuffer> | string): Uint8Array<ArrayBuffer> => (typeof body === 'string' ? new TextEncoder().encode(body) : body);

export interface LoadedWorker {
  context: vm.Context;
  install(): Promise<void>;
  activate(): Promise<void>;
  // undefined = the worker did not answer (the browser goes to the network by itself)
  fetch(url: string, init?: { mode?: string; method?: string }): Promise<Response | undefined>;
  message(data: unknown): unknown[];
  push(data: unknown, visible?: boolean): Promise<void>;
  click(url: string, windows?: { url: string }[]): Promise<{ focused: string[]; navigated: string[] }>;
  constant(name: string): unknown;
}

export function loadWorker(world: World, source: string, swPath = `${BASE}sw.js`): LoadedWorker {
  const listeners = new Map<string, (event: unknown) => void>();
  const attempts = new Map<string, number>();
  const cacheNamed = (name: string) => {
    if (!world.caches.has(name)) world.caches.set(name, new Map());
    const store = world.caches.get(name)!;
    const key = (r: string | Request | { url: string }) => (typeof r === 'string' ? new URL(r, `${ORIGIN}${swPath}`).href : r.url);
    return {
      put: async (r: string | Request, res: Response) => { store.set(key(r), res); },
      match: async (r: string | Request) => { const hit = store.get(key(r)); return hit ? hit.clone() : undefined; },
      add: () => { throw new Error('downloads go through fetch, where the fingerprint is checked'); },
    };
  };
  const trap = (name: string) => new Proxy({}, { get: () => { world.storageTouched.push(name); throw new Error(`${name} touched`); } });
  let windows: { url: string; visibilityState?: string; focus(): Promise<void>; navigate?(u: string): Promise<void> }[] = [];

  // A worker resolves a relative address against its own (the current app's sw.js builds `new Request('./x')`).
  const here = `${ORIGIN}${swPath}`;
  class WorkerRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, here).href : input, init);
    }
  }
  const context = vm.createContext({
    console: { warn: () => {}, log: () => {}, error: () => {}, info: () => {} },
    URL, Request: WorkerRequest, Response, Headers, TextEncoder, TextDecoder, AbortController, Uint8Array, Array, Promise, Map, Set, JSON, Object, Error, TypeError, Number, String,
    crypto: globalThis.crypto,
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
    clearTimeout,
    indexedDB: trap('indexedDB'),
    localStorage: trap('localStorage'),
    sessionStorage: trap('sessionStorage'),
    caches: {
      open: async (name: string) => cacheNamed(name),
      keys: async () => [...world.caches.keys()],
      delete: async (name: string) => { world.deleted.push(name); return world.caches.delete(name); },
      match: async (r: string | Request) => {
        for (const name of world.caches.keys()) { const hit = await cacheNamed(name).match(r); if (hit) return hit; }
        return undefined;
      },
    },
    fetch: async (r: string | Request) => {
      const url = typeof r === 'string' ? new URL(r, `${ORIGIN}${swPath}`).href : r.url;
      world.fetched.push(url);
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      const plain = url.split('?')[0]!;
      const served = world.server.get(url) ?? world.server.get(plain);
      const answer = typeof served === 'function' ? served(n) : served;
      if (answer === 'fail') throw new TypeError(`Failed to fetch ${url}`);
      if (answer === undefined || answer === 404) return new Response('not found', { status: 404 });
      return new Response(bytesOf(answer.body), { status: 200, headers: { 'content-type': answer.type ?? 'application/octet-stream' } });
    },
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); },
      location: new URL(`${ORIGIN}${swPath}`),
      skipWaiting: () => { world.skipWaiting += 1; return Promise.resolve(); },
      clients: {
        claim: async () => {},
        matchAll: async () => windows,
        openWindow: async (u: string) => { world.opened.push(u); return null; },
      },
      registration: {
        scope: new URL('./', `${ORIGIN}${swPath}`).href,
        showNotification: async (title: string, options: Record<string, unknown>) => { world.notifications.push({ title, options }); },
      },
    },
  });
  vm.runInContext(source, context, { filename: swPath });

  const fire = (type: string, event: object) => {
    const fn = listeners.get(type);
    if (!fn) throw new Error(`the worker has no ${type} handler`);
    fn(event);
  };
  const extended = async (type: string, extra: object = {}) => {
    let waited: Promise<unknown> | undefined;
    fire(type, { ...extra, waitUntil: (p: Promise<unknown>) => { waited = p; } });
    if (!waited || typeof (waited as Promise<unknown>).then !== 'function') throw new Error(`${type}: waitUntil was not called with a promise`);
    await waited;
  };

  return {
    context,
    install: () => extended('install'),
    activate: () => extended('activate'),
    async fetch(url, init = {}) {
      let answered: Promise<Response> | Response | undefined;
      const request = new Request(new URL(url, SCOPE).href, { method: init.method ?? 'GET' });
      Object.defineProperty(request, 'mode', { value: init.mode ?? 'cors' });
      fire('fetch', { request, respondWith: (r: Promise<Response> | Response) => { answered = r; } });
      return answered ? await answered : undefined;
    },
    message(data) {
      const replies: unknown[] = [];
      fire('message', { data, source: {}, ports: [{ postMessage: (m: unknown) => replies.push(m) }] });
      return replies;
    },
    async push(data, visible = false) {
      windows = visible ? [{ url: SCOPE, visibilityState: 'visible', focus: async () => {} }] : [];
      await extended('push', { data: { json: () => data } });
    },
    async click(url, open = []) {
      const focused: string[] = [];
      const navigated: string[] = [];
      windows = open.map(w => ({ url: w.url, focus: async () => { focused.push(w.url); }, navigate: async (u: string) => { navigated.push(u); } }));
      await extended('notificationclick', { notification: { close: () => {}, data: { url } } });
      return { focused, navigated };
    },
    constant: name => vm.runInContext(name, context),
  };
}
