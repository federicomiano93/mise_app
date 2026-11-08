// serviceWorker.spec.ts — the page side: a waiting release is let in only when nobody is editing, the reload
// comes only after the new worker has taken control, and never in a loop.

import { describe, expect, test, vi } from 'vitest';
import { markBusy } from '../session/busy';
import {
  BUSY_RETRY_MS, MIN_RELOAD_GAP_MS, RELOAD_GRACE_MS, TAKEOVER_TIMEOUT_MS, watchServiceWorker,
  browserServiceWorkerEnv, type ServiceWorkerEnv,
} from './serviceWorker';

class FakeTarget {
  private listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  emit(type: string) { const fns = this.listeners.get(type) ?? []; this.listeners.delete(type); fns.forEach(fn => fn()); }
}

function world({ controlled = true, waiting = true } = {}) {
  const posted: unknown[] = [];
  const waitingWorker = waiting ? { postMessage: (m: unknown) => posted.push(m) } : null;
  const reg = Object.assign(new FakeTarget(), {
    waiting: waitingWorker as unknown,
    installing: null as unknown,
    update: vi.fn(() => Promise.resolve()),
  });
  const container = Object.assign(new FakeTarget(), {
    controller: controlled ? {} : null,
    register: vi.fn(() => Promise.resolve(reg)),
  });
  const timers: Array<{ at: number; fn: () => void }> = [];
  let clock = 1_000_000;
  let stamp: number | null = null;
  let visible: (() => void) | null = null;
  const env: ServiceWorkerEnv = {
    container: container as unknown as ServiceWorkerContainer,
    scriptUrl: '/mise_app/sw.js',
    scope: '/mise_app/',
    isBusy: () => browserServiceWorkerEnv('/mise_app/').isBusy(),
    reload: vi.fn(),
    now: () => clock,
    setTimeout: (fn, ms) => { timers.push({ at: clock + ms, fn }); return 0; },
    setInterval: () => 0,
    onVisible: fn => { visible = fn; },
    readStamp: () => stamp,
    writeStamp: v => { stamp = v; },
  };
  const advance = (ms: number) => {
    clock += ms;
    for (;;) {
      const due = timers.filter(t => t.at <= clock).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  return { env, reg, container, posted, advance, setStamp: (v: number) => { stamp = v; }, visible: () => visible?.() };
}

describe('watchServiceWorker', () => {
  test('registers sw.js at the app\'s own address, with the app\'s scope', async () => {
    const w = world();
    await watchServiceWorker(w.env);
    expect(w.container.register).toHaveBeenCalledWith('/mise_app/sw.js', { scope: '/mise_app/' });
  });

  test('a release waiting while nobody edits is let in, and the page reloads once the new worker has control', async () => {
    const w = world();
    await watchServiceWorker(w.env);
    expect(w.posted).toEqual([{ action: 'skipWaiting' }]);
    expect(w.env.reload).not.toHaveBeenCalled();
    w.container.emit('controllerchange');
    w.advance(RELOAD_GRACE_MS);
    expect(w.env.reload).toHaveBeenCalledTimes(1);
  });

  test('⚠️ while somebody is editing (markBusy) it waits, and goes in once they are done', async () => {
    const release = markBusy();
    try {
      const w = world();
      await watchServiceWorker(w.env);
      w.advance(BUSY_RETRY_MS * 5);
      expect(w.posted).toEqual([]);
      release();
      w.advance(BUSY_RETRY_MS);
      expect(w.posted).toEqual([{ action: 'skipWaiting' }]);
    } finally { release(); }
  });

  test('a release found later (updatefound → installed) is let in the same way', async () => {
    const w = world({ waiting: false });
    await watchServiceWorker(w.env);
    expect(w.posted).toEqual([]);
    const incoming = Object.assign(new FakeTarget(), { state: 'installing' });
    w.reg.installing = incoming;
    w.reg.waiting = { postMessage: (m: unknown) => w.posted.push(m) };
    w.reg.emit('updatefound');
    incoming.state = 'installed';
    incoming.emit('statechange');
    expect(w.posted).toEqual([{ action: 'skipWaiting' }]);
  });

  test('the very first install (no worker in control yet) asks nothing and reloads nothing', async () => {
    const w = world({ controlled: false });
    await watchServiceWorker(w.env);
    w.container.emit('controllerchange');
    w.advance(TAKEOVER_TIMEOUT_MS * 2);
    expect(w.posted).toEqual([]);
    expect(w.env.reload).not.toHaveBeenCalled();
  });

  test('if the waiting worker never takes control, the page reloads anyway after a few seconds', async () => {
    const w = world();
    await watchServiceWorker(w.env);
    w.advance(TAKEOVER_TIMEOUT_MS);
    expect(w.env.reload).toHaveBeenCalledTimes(1);
  });

  test('no loop: reloaded for an update less than a minute ago, it does not ask again', async () => {
    const w = world();
    w.setStamp(1_000_000 - MIN_RELOAD_GAP_MS / 2);
    await watchServiceWorker(w.env);
    expect(w.posted).toEqual([]);
  });

  test('coming back to the app checks for a release', async () => {
    const w = world({ waiting: false });
    await watchServiceWorker(w.env);
    w.visible();
    expect(w.reg.update).toHaveBeenCalled();
  });

  test('a browser without service workers: nothing happens', async () => {
    const w = world();
    await watchServiceWorker({ ...w.env, container: undefined });
    expect(w.container.register).not.toHaveBeenCalled();
  });
});
