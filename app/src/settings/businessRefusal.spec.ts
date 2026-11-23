import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { businessRefusal } from './businessRefusal';

// What «New business» says when createWorkspace refuses, read from the error's CODE, never the server's own English.

afterEach(() => { vi.restoreAllMocks(); });

const refused = (code: string) => Object.assign(new Error('Server English that must never be shown'), { code });

describe('a business that could not be made', () => {
  it('says only the administrator can, for a permission refusal', () => {
    expect(businessRefusal(refused('functions/permission-denied'))).toBe('newBusiness.err.notAdmin');
    expect(businessRefusal(refused('permission-denied'))).toBe('newBusiness.err.notAdmin');
  });

  it('says the server could not be reached, for no signal or a timeout', () => {
    expect(businessRefusal(refused('functions/unavailable'))).toBe('newBusiness.err.offline');
    expect(businessRefusal(refused('functions/deadline-exceeded'))).toBe('newBusiness.err.offline');
  });

  it('says the same for a phone that knows it is offline, whatever the code', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(businessRefusal(refused('functions/internal'))).toBe('newBusiness.err.offline');
    expect(businessRefusal(new Error('Failed to fetch'))).toBe('newBusiness.err.offline');
  });

  it('says nothing was made for anything else, even an invalid-argument or an error with no code', () => {
    expect(businessRefusal(refused('functions/invalid-argument'))).toBe('newBusiness.err.failed');
    expect(businessRefusal(refused('functions/internal'))).toBe('newBusiness.err.failed');
    expect(businessRefusal(new Error('no code at all'))).toBe('newBusiness.err.failed');
    expect(businessRefusal(null)).toBe('newBusiness.err.failed');
  });

  it('every sentence exists in both languages and is the app\'s own, not the server\'s', () => {
    for (const key of ['newBusiness.err.notAdmin', 'newBusiness.err.offline', 'newBusiness.err.failed'] as const) {
      expect(en[key]).not.toContain('Server English');
      expect(italian[key]).not.toBe(en[key]);
    }
  });
});
