import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { FUNCTION_TIMEOUT_MS, createFirestoreSettingsSource, invitationOf } from './settingsSource';

// The ONLY code in Mise 2 that writes the holiday and calls the language and sections functions, against a recording fake of the
// Firestore SDK. firestore.rules (`match /away/{uid}`) accept exactly { bakery, uid, until, updatedAt }, so a slip here — a stray key,
// a missing venue stamp, a delete for «I am back» — would first show as a refused write on a phone.

type Ref = { kind: string; path: string };

function fakeKit(options: { holiday?: unknown; venue?: unknown; serverFails?: boolean } = {}) {
  const exists = (data: unknown) => ({ exists: () => data !== null && data !== undefined, data: () => data });
  const fs = {
    doc: (_db: unknown, path: string, id?: string): Ref => ({ kind: 'doc', path: id === undefined ? path : `${path}/${id}` }),
    getDoc: vi.fn(async (_ref: Ref) => exists(options.holiday)),
    getDocFromServer: vi.fn(async (_ref: Ref) => {
      if (options.serverFails) throw new Error('offline');
      return exists(options.venue);
    }),
    setDoc: vi.fn(async (..._args: unknown[]) => undefined),
    deleteDoc: vi.fn(async (..._args: unknown[]) => undefined),
  };
  return { kit: { fs, db: {} } as unknown as FirestoreKit, fs };
}

function make(options: Parameters<typeof fakeKit>[0] = {}, now = () => new Date(2026, 10, 7, 12).getTime()) {
  const k = fakeKit(options);
  const callFunction = vi.fn(async (..._args: unknown[]) => ({}));
  const source = createFirestoreSettingsSource(() => Promise.resolve(k.kit), callFunction, 'panificio-miano', now);
  return { ...k, callFunction, source };
}

describe('the settings source, as firestore.rules and the Cloud Functions expect it', () => {
  test('a holiday is written as exactly the four keys the rules accept, on the person’s own document', async () => {
    const { source, fs } = make();
    const write = source.saveAway('u1', '2026-11-16');
    expect(write.result).toBe('saved');
    if (write.result === 'saved') await write.written;

    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>, unknown];
    expect(ref.path).toBe('locations/panificio-miano/away/u1');
    expect(options).toBeUndefined();
    expect(payload).toEqual({
      bakery: 'panificio-miano',
      uid: 'u1',
      until: '2026-11-16',
      updatedAt: new Date(2026, 10, 7, 12).getTime(),
    });
    expect(Object.keys(payload).sort()).toEqual(['bakery', 'uid', 'until', 'updatedAt']);
  });

  test('«I am back» writes an empty until and never deletes the document', async () => {
    const { source, fs } = make();
    const write = source.saveAway('u1', '');
    if (write.result === 'saved') await write.written;
    const [, payload] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>];
    expect(payload).toMatchObject({ until: '', uid: 'u1', bakery: 'panificio-miano' });
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  test('a date that cannot be used is decided at once and nothing is written', async () => {
    const { source, fs } = make();
    expect(source.saveAway('u1', '2026-11-06').result).toBe('bad-date');
    expect(source.saveAway('u1', '2027-11-08').result).toBe('bad-date');
    expect(source.saveAway('u1', 'friday').result).toBe('bad-date');
    expect(source.saveAway('', '2026-11-16').result).toBe('bad-date');
    await Promise.resolve();
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  test('the write’s promise rejects with the refusal, for the store to hear', async () => {
    const { source, fs } = make();
    fs.setDoc.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'permission-denied' }));
    const write = source.saveAway('u1', '2026-11-16');
    if (write.result !== 'saved') throw new Error('should have been accepted');
    await expect(write.written).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('the holiday is read once, from the person’s own document, with a plain read', async () => {
    const { source, fs } = make({ holiday: { bakery: 'panificio-miano', uid: 'u1', until: '2026-11-16', updatedAt: 1 } });
    expect(await source.readMyAway('u1')).toEqual({ until: '2026-11-16' });
    expect((fs.getDoc.mock.calls[0] as [Ref])[0].path).toBe('locations/panificio-miano/away/u1');
    expect(fs.getDocFromServer).not.toHaveBeenCalled();
  });

  test('no document, an odd document or a failed read all read as nothing', async () => {
    expect(await make({ holiday: null }).source.readMyAway('u1')).toBeNull();
    expect(await make({ holiday: { until: 5 } }).source.readMyAway('u1')).toBeNull();
    const failing = make();
    failing.fs.getDoc.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await failing.source.readMyAway('u1')).toBeNull();
    warn.mockRestore();
  });

  test('marks a holiday read back with this phone’s own unconfirmed write on top as pending, not as the server’s word', async () => {
    const { source, fs } = make({ holiday: { until: '' } });
    fs.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ until: '' }), metadata: { hasPendingWrites: true } } as never);
    expect(await source.readMyAway('u1')).toEqual({ until: '', pending: true });
  });

  test('«I am back» is still read as a holiday document with an empty until', async () => {
    expect(await make({ holiday: { until: '' } }).source.readMyAway('u1')).toEqual({ until: '' });
  });

  test('the language is a Cloud Function call with the venue and the language, then a read from the SERVER', async () => {
    const { source, callFunction, fs } = make({ venue: { language: 'it' } });
    await source.setLanguage('it');
    expect(callFunction).toHaveBeenCalledWith('setLocationLanguage', { locationId: 'panificio-miano', language: 'it' }, FUNCTION_TIMEOUT_MS);
    expect(FUNCTION_TIMEOUT_MS).toBe(60_000);
    expect((fs.getDocFromServer.mock.calls[0] as [Ref])[0].path).toBe('locations/panificio-miano');
    // The call comes first: the phone hears of the change only after the server made it.
    expect(callFunction.mock.invocationCallOrder[0]).toBeLessThan(fs.getDocFromServer.mock.invocationCallOrder[0] ?? 0);
  });

  test('the language still resolves when the read straight after fails (offline right after the call)', async () => {
    const { source } = make({ serverFails: true });
    await expect(source.setLanguage('en')).resolves.toBeUndefined();
  });

  test('a refused or timed-out language call rejects and reads nothing', async () => {
    const { source, callFunction, fs } = make();
    callFunction.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'functions/permission-denied' }));
    await expect(source.setLanguage('it')).rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect(fs.getDocFromServer).not.toHaveBeenCalled();
  });

  test('a staff section is a Cloud Function call with the venue, the card and hidden, then the venue from the server', async () => {
    const venue = { staffHiddenCards: { pastries: true } };
    const { source, callFunction, fs } = make({ venue });
    expect(await source.setStaffCard('pastries', true)).toEqual(venue);
    expect(callFunction).toHaveBeenCalledWith('setStaffCard', { locationId: 'panificio-miano', card: 'pastries', hidden: true }, 60_000);
    expect(fs.getDocFromServer).toHaveBeenCalledTimes(1);
  });

  test('a money card is sent as the same card id and hidden flag — the server stores it the other way round', async () => {
    const { source, callFunction } = make({ venue: {} });
    await source.setStaffCard('foodcost', false);
    expect(callFunction).toHaveBeenCalledWith('setStaffCard', { locationId: 'panificio-miano', card: 'foodcost', hidden: false }, 60_000);
  });

  test('a staff section saved on the server but not readable back says null, not an error', async () => {
    const { source } = make({ serverFails: true });
    expect(await source.setStaffCard('pastries', true)).toBeNull();
  });

  test('a refused staff-section call rejects', async () => {
    const { source, callFunction } = make();
    callFunction.mockRejectedValueOnce(new Error('denied'));
    await expect(source.setStaffCard('pastries', true)).rejects.toThrow('denied');
  });

  test('the venue is read from the server, and rejects offline', async () => {
    const { source, fs } = make({ venue: { name: 'Miano' } });
    expect(await source.readVenueFromServer()).toEqual({ name: 'Miano' });
    expect(fs.getDoc).not.toHaveBeenCalled();
    await expect(make({ serverFails: true }).source.readVenueFromServer()).rejects.toThrow('offline');
  });

  test('a venue with no document reads as null', async () => {
    expect(await make({ venue: null }).source.readVenueFromServer()).toBeNull();
  });

  test('a venue id that could point somewhere else is refused when the source is made', () => {
    const k = fakeKit();
    expect(() => createFirestoreSettingsSource(() => Promise.resolve(k.kit), vi.fn(), '../x')).toThrow();
  });
});

describe('an invitation, as functions/onboarding.js createJoinCode makes it', () => {
  const DIGITS = { code: '482913', kind: 'digits', role: 'staff', title: '', expiresAt: 1_800_000_000_000 };
  const LINK = { code: 'Q7xk2mP9vR4tY8wZ1nB6cD3fG5hJ0sLa', kind: 'link', role: 'manager', title: 'head-chef', expiresAt: 1_800_000_000_000 };

  test('asks the function for this venue, the role, the title and the shape, with the long timeout', async () => {
    const { source, callFunction } = make();
    callFunction.mockResolvedValueOnce(LINK);
    await source.createInvitation('manager', 'head-chef', 'link');
    expect(callFunction).toHaveBeenCalledExactlyOnceWith('createJoinCode',
      { locationId: 'panificio-miano', role: 'manager', title: 'head-chef', kind: 'link' }, FUNCTION_TIMEOUT_MS);
  });

  test('answers with the invitation the server made', async () => {
    const { source, callFunction } = make();
    callFunction.mockResolvedValueOnce(LINK);
    await expect(source.createInvitation('manager', 'head-chef', 'link')).resolves.toEqual(LINK);
    callFunction.mockResolvedValueOnce(DIGITS);
    // The server answers '' for a title on any level but the manager's: no title is kept for an employee.
    await expect(source.createInvitation('staff', null, 'digits')).resolves.toEqual({ ...DIGITS, title: null });
  });

  test('rejects with the refusal, untouched, for the screen to say in its own words', async () => {
    const { source, callFunction } = make();
    callFunction.mockRejectedValueOnce(Object.assign(new Error('Only the owner can do that.'), { code: 'functions/permission-denied' }));
    await expect(source.createInvitation('staff', null, 'link')).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  test('rejects an answer that is not a whole invitation', async () => {
    const { source, callFunction } = make();
    callFunction.mockResolvedValueOnce({ ...LINK, code: '' });
    await expect(source.createInvitation('staff', null, 'link')).rejects.toThrow();
  });

  test.each([
    ['nothing', null],
    ['a string', 'ok'],
    ['no code', { ...DIGITS, code: undefined }],
    ['digits of the wrong length', { ...DIGITS, code: '48291' }],
    ['digits that are not digits', { ...DIGITS, code: '48291a' }],
    ['a link too short', { ...LINK, code: 'abc' }],
    ['a link with a character no link has', { ...LINK, code: `${LINK.code.slice(0, 31)}/` }],
    ['an unknown shape', { ...DIGITS, kind: 'qr' }],
    ['an unknown role', { ...LINK, role: 'admin' }],
    ['no expiry', { ...LINK, expiresAt: undefined }],
    ['an expiry that is not a number', { ...LINK, expiresAt: '2026-11-15' }],
    // ⚠️ Six digits only ever make an employee: an answer that says otherwise is not believed.
    ['six digits for a manager', { ...DIGITS, role: 'manager' }],
    ['six digits for an owner', { ...DIGITS, role: 'owner' }],
  ])('%s is not an invitation', (_what, answer) => {
    expect(invitationOf(answer)).toBeNull();
  });

  test('a title is kept on the manager level only, and an unknown one reads as manager', () => {
    expect(invitationOf({ ...LINK, role: 'manager', title: 'head-chef' })?.title).toBe('head-chef');
    expect(invitationOf({ ...LINK, role: 'manager', title: 'boss' })?.title).toBe('manager');
    expect(invitationOf({ ...LINK, role: 'owner', title: 'head-chef' })?.title).toBeNull();
  });
});
