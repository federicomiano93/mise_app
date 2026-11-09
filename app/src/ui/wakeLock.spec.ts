import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake navigator.wakeLock whose sentinels can be released "by the browser" (the page was hidden).
function installWakeLock() {
  const sentinels: { released: boolean; listeners: (() => void)[]; release: () => Promise<void>; addEventListener: (type: string, fn: () => void) => void }[] = [];
  const request = vi.fn(async () => {
    const sentinel = {
      released: false,
      listeners: [] as (() => void)[],
      release: async () => { sentinel.released = true; sentinel.listeners.forEach(fn => { fn(); }); },
      addEventListener: (_type: string, fn: () => void) => { sentinel.listeners.push(fn); },
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
  return { request, sentinels };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

let wake: typeof import('./wakeLock');

beforeEach(async () => {
  vi.resetModules();
  wake = await import('./wakeLock');
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('the screen wake lock', () => {
  it('asks for the lock for the first owner only, and counts owners', async () => {
    const { request, sentinels } = installWakeLock();
    wake.acquireWakeLock('guided-mix');
    wake.acquireWakeLock('guided-mix');
    wake.acquireWakeLock('kiosk');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    wake.releaseWakeLock('guided-mix');
    expect(sentinels[0]?.released).toBe(false);
    wake.releaseWakeLock('kiosk');
    expect(sentinels[0]?.released).toBe(true);
  });

  it('⚠️ asks again when the page becomes visible after the browser let the lock go', async () => {
    const { request, sentinels } = installWakeLock();
    wake.acquireWakeLock('guided-mix');
    await settle();
    setVisibility('hidden');
    await sentinels[0]?.release();
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    wake.releaseWakeLock('guided-mix');
  });

  it('does not ask again while a lock is held', async () => {
    const { request } = installWakeLock();
    wake.acquireWakeLock('guided-mix');
    await settle();
    setVisibility('visible');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    wake.releaseWakeLock('guided-mix');
  });

  it('stops listening for the page coming back once the last owner has gone', async () => {
    const { request } = installWakeLock();
    wake.acquireWakeLock('guided-mix');
    await settle();
    wake.releaseWakeLock('guided-mix');
    setVisibility('visible');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('lets go at once of a lock that arrives after everybody has left', async () => {
    const { sentinels } = installWakeLock();
    wake.acquireWakeLock('guided-mix');
    wake.releaseWakeLock('guided-mix');
    await settle();
    expect(sentinels[0]?.released).toBe(true);
  });

  it('releasing an owner that never held it changes nothing', async () => {
    const { sentinels } = installWakeLock();
    wake.acquireWakeLock('guided-mix');
    await settle();
    wake.releaseWakeLock('somebody-else');
    expect(sentinels[0]?.released).toBe(false);
    wake.releaseWakeLock('guided-mix');
  });

  it('survives a refused request', async () => {
    const request = vi.fn(async () => { throw new Error('battery saver'); });
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
    expect(() => { wake.acquireWakeLock('guided-mix'); }).not.toThrow();
    await settle();
    wake.releaseWakeLock('guided-mix');
  });

  it('says whether the device can keep the screen on, and does nothing where it cannot', () => {
    expect(wake.canKeepScreenAwake()).toBe(false);
    expect(() => { wake.acquireWakeLock('guided-mix'); wake.releaseWakeLock('guided-mix'); }).not.toThrow();
    installWakeLock();
    expect(wake.canKeepScreenAwake()).toBe(true);
  });
});
