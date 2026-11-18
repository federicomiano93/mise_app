// The kiosk setting of this device (staff slice 5): the current app's key and JSON shape, defaults for anything unknown, a refused
// write reported, a change in another tab heard.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import { KIOSK_LAST_RELOAD_KEY, KIOSK_STORAGE_KEY } from '@mise/shared/kiosk-model';
import { kioskSettings, saveKioskSettings, subscribeKioskSettings } from './kioskSettings';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the kiosk setting of this device', () => {
  test('a tablet already in kiosk mode in the current app stays in kiosk mode', () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":true,"restMinutes":20,"nightHours":0}');
    expect(kioskSettings()).toStrictEqual({ enabled: true, restMinutes: 20, nightHours: 0 });
  });

  test('nothing stored, or anything unknown, reads as the defaults (off, 5 minutes, 1 hour)', () => {
    expect(kioskSettings()).toStrictEqual({ enabled: false, restMinutes: 5, nightHours: 1 });
    localStorage.setItem(KIOSK_STORAGE_KEY, '{"enabled":"yes","restMinutes":3,"nightHours":9}');
    expect(kioskSettings()).toStrictEqual({ enabled: false, restMinutes: 5, nightHours: 1 });
    localStorage.setItem(KIOSK_STORAGE_KEY, 'garbage');
    expect(kioskSettings()).toStrictEqual({ enabled: false, restMinutes: 5, nightHours: 1 });
  });

  test('the same object while the stored text is the same', () => {
    expect(kioskSettings()).toBe(kioskSettings());
  });

  test('saves the current app’s JSON shape, keeping the other two values', () => {
    expect(saveKioskSettings({ enabled: true })).toBe(true);
    expect(localStorage.getItem(KIOSK_STORAGE_KEY)).toBe('{"enabled":true,"restMinutes":5,"nightHours":1}');
    expect(saveKioskSettings({ nightHours: 4 })).toBe(true);
    expect(localStorage.getItem(KIOSK_STORAGE_KEY)).toBe('{"enabled":true,"restMinutes":5,"nightHours":4}');
    expect(saveKioskSettings({ enabled: false })).toBe(true);
    expect(localStorage.getItem(KIOSK_STORAGE_KEY)).toBe('{"enabled":false,"restMinutes":5,"nightHours":4}');
  });

  test('a write the device refuses says false and changes nothing', () => {
    const listener = vi.fn();
    const stop = subscribeKioskSettings(listener);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(saveKioskSettings({ enabled: true })).toBe(false);
    expect(kioskSettings().enabled).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  test('tells its listeners of a save here and of a change in another tab', () => {
    const listener = vi.fn();
    const stop = subscribeKioskSettings(listener);
    saveKioskSettings({ enabled: true });
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: KIOSK_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: KIOSK_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('a sign-out or a venue switch keeps both kiosk keys (`kiosk-` is kept)', () => {
    expect(KEEP_PREFIXES).toContain('kiosk-');
    const keys = [KIOSK_STORAGE_KEY, KIOSK_LAST_RELOAD_KEY, 'orders-list-copy'];
    expect(keysToClear(keys)).toStrictEqual(['orders-list-copy']);
  });
});
