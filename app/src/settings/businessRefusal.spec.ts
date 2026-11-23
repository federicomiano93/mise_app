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

  it('says nothing was created only when the server refused the request itself', () => {
    expect(businessRefusal(refused('functions/invalid-argument'))).toBe('newBusiness.err.failed');
    expect(businessRefusal(refused('functions/unauthenticated'))).toBe('newBusiness.err.failed');
  });

  it('says the business may exist, and to look before retrying, for every failure that could have come after it was made', () => {
    for (const code of ['unavailable', 'deadline-exceeded', 'internal', 'unknown']) {
      expect(businessRefusal(refused(`functions/${code}`))).toBe('newBusiness.err.maybe');
    }
    expect(businessRefusal(new Error('Failed to fetch'))).toBe('newBusiness.err.maybe');
    expect(businessRefusal(new Error('no code at all'))).toBe('newBusiness.err.maybe');
    expect(businessRefusal(null)).toBe('newBusiness.err.maybe');
  });

  it('says the same on a phone that knows it is offline, never that nothing was created', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(businessRefusal(refused('functions/internal'))).toBe('newBusiness.err.maybe');
  });

  it('every sentence exists in both languages and is the app\'s own, not the server\'s', () => {
    for (const key of ['newBusiness.err.notAdmin', 'newBusiness.err.maybe', 'newBusiness.err.failed'] as const) {
      expect(en[key]).not.toContain('Server English');
      expect(italian[key]).not.toBe(en[key]);
    }
  });
});
