// What the bell keeps on this phone (calendarNotices.ts, parity R11, R12): the notices put away, and the browser notification
// raised once, only for the notices still open, through the service worker when there is one.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISMISSED_KEY } from '@mise/shared/alert-dismissal';
import { forgetRaisedNotices, notifyOnce, useDismissedNotices } from './calendarNotices';
import type { NotifyDeps } from './calendarNotices';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe('useDismissedNotices', () => {
  it('⚠️ keys about a day already past are dropped when the bell opens; the future ones stay', () => {
    const storage = memory({ [DISMISSED_KEY]: JSON.stringify(['bh-2026-10-01', 'bh-2026-12-25', 'conf-mill-2026-11-02']) });
    const { result } = renderHook(() => useDismissedNotices('2026-10-30', storage));
    expect(result.current.dismissed).toStrictEqual(['bh-2026-12-25', 'conf-mill-2026-11-02']);
    expect(JSON.parse(storage.data.get(DISMISSED_KEY) ?? '[]')).toStrictEqual(['bh-2026-12-25', 'conf-mill-2026-11-02']);
  });

  it('closing one keeps the others, and reads the stored list again first (another tab may have closed one)', () => {
    const storage = memory();
    const { result } = renderHook(() => useDismissedNotices('2026-10-30', storage));
    storage.data.set(DISMISSED_KEY, JSON.stringify(['bh-2026-11-01']));
    act(() => { result.current.close('conf-mill-2026-11-02'); });
    expect(result.current.dismissed).toStrictEqual(['bh-2026-11-01', 'conf-mill-2026-11-02']);
    expect(JSON.parse(storage.data.get(DISMISSED_KEY) ?? '[]')).toStrictEqual(['bh-2026-11-01', 'conf-mill-2026-11-02']);
  });

  it('the pill brings every closed notice back', () => {
    const storage = memory({ [DISMISSED_KEY]: JSON.stringify(['bh-2026-12-25']) });
    const { result } = renderHook(() => useDismissedNotices('2026-10-30', storage));
    act(() => { result.current.reopen(); });
    expect(result.current.dismissed).toStrictEqual([]);
    expect(storage.data.get(DISMISSED_KEY)).toBe('[]');
  });

  it('⚠️ unreadable storage shows everything, and closing still works on screen', () => {
    const { result } = renderHook(() => useDismissedNotices('2026-10-30', null));
    expect(result.current.dismissed).toStrictEqual([]);
    act(() => { result.current.close('bh-2026-12-25'); });
    expect(result.current.dismissed).toStrictEqual(['bh-2026-12-25']);
  });
});

describe('notifyOnce', () => {
  afterEach(() => { forgetRaisedNotices(); });

  const holiday = { key: 'bh-2026-12-25', title: 'Public holiday', body: 'Christmas' };
  const clash = { key: 'conf-mill-2026-12-25', title: 'Delivery', body: 'Mill' };

  function deps(over: Partial<NotifyDeps> = {}) {
    const showNotification = vi.fn(async () => undefined);
    const construct = vi.fn();
    const all: NotifyDeps = {
      permission: () => 'granted',
      registration: async () => ({ showNotification }),
      construct,
      ...over,
    };
    return { all, showNotification, construct };
  }

  it('⚠️⚠️ through the service worker when one controls the page (Android refuses the constructor)', async () => {
    const d = deps();
    await notifyOnce([holiday], d.all);
    expect(d.showNotification).toHaveBeenCalledWith('Public holiday', { body: 'Christmas', tag: 'bh-2026-12-25' });
    expect(d.construct).not.toHaveBeenCalled();
  });

  it('with no service worker, the constructor', async () => {
    const d = deps({ registration: async () => undefined });
    await notifyOnce([holiday], d.all);
    expect(d.construct).toHaveBeenCalledWith('Public holiday', { body: 'Christmas', tag: 'bh-2026-12-25' });
  });

  it('each notice is raised once while the app is open, however often the bell is drawn', async () => {
    const d = deps();
    await notifyOnce([holiday], d.all);
    await notifyOnce([holiday, clash], d.all);
    expect(d.showNotification).toHaveBeenCalledTimes(2);
    expect(d.showNotification.mock.calls.map(call => (call as unknown[])[0])).toStrictEqual(['Public holiday', 'Delivery']);
  });

  it('nothing without permission, and nothing is remembered as raised', async () => {
    const d = deps({ permission: () => 'default' });
    await notifyOnce([holiday], d.all);
    expect(d.showNotification).not.toHaveBeenCalled();
    const granted = deps();
    await notifyOnce([holiday], granted.all);
    expect(granted.showNotification).toHaveBeenCalledTimes(1);
  });

  it('a notification that throws is logged and never stops the next one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const d = deps({ registration: async () => undefined, construct: vi.fn(() => { throw new TypeError('Illegal constructor'); }) });
    await expect(notifyOnce([holiday, clash], d.all)).resolves.toBeUndefined();
    expect(d.all.construct).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
