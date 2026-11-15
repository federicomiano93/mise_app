// This phone's order-list mute, on the current app's keys (phoneMute.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUTE_KEY, PUSH_TOKEN_KEY, phoneMuted, phoneToken, rememberPhoneMute } from './phoneMute';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('phoneMute', () => {
  it('reads the keys js/push.js writes', () => {
    expect(PUSH_TOKEN_KEY).toBe('push-token');
    expect(MUTE_KEY).toBe('push-mute-order-requests');
    expect(phoneToken()).toBe('');
    localStorage.setItem(PUSH_TOKEN_KEY, 'tok');
    expect(phoneToken()).toBe('tok');
  });

  it('remembers the switch as «1» and «0», as the current app does', () => {
    expect(phoneMuted()).toBe(false);
    rememberPhoneMute(true);
    expect(localStorage.getItem(MUTE_KEY)).toBe('1');
    expect(phoneMuted()).toBe(true);
    rememberPhoneMute(false);
    expect(localStorage.getItem(MUTE_KEY)).toBe('0');
    expect(phoneMuted()).toBe(false);
  });

  it('⚠️ storage that throws answers «no token, not muted»: the safe direction is a phone that rings', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(phoneToken()).toBe('');
    expect(phoneMuted()).toBe(false);
    expect(() => rememberPhoneMute(true)).not.toThrow();
  });
});
