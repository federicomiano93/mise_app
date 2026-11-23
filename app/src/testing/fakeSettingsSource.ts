import { vi } from 'vitest';
import { buildAwayDoc } from '@mise/shared/away-model';
import type { DocData } from '../session/backend';
import type { CreatedBusiness, Invitation, Member, MyAway, NewBusiness, SettingsSource } from '../settings/settingsSource';

// What the fake «server» mints: six digits for an employee, a link token for anybody, both living a day (functions/onboarding.js).
export const FAKE_DIGITS = '482913';
export const FAKE_LINK_TOKEN = 'Q7xk2mP9vR4tY8wZ1nB6cD3fG5hJ0sLa';
const DAY_MS = 24 * 60 * 60 * 1000;
// The business the fake «server» makes, and how long a customer's link lives (functions/onboarding.js createWorkspace: a week).
export const FAKE_BUSINESS_ID = 'loc-fake-new';
const LINK_DAYS = 7;

// A settings source for the specs, in memory. The holiday lands at once (as Firestore's local copy does); a write is refused, as the
// rules or the network would, by setting `refuseWith`. The Cloud Functions are `vi.fn`s a spec can make fail.
export type FakeSettingsSource = SettingsSource & {
  // This person's holiday document, as read once.
  away: MyAway | null;
  // While set, a holiday write's promise rejects with this error (and the document is left as it was).
  refuseWith: unknown;
  // While set, setLanguage, setStaffCard and createInvitation reject with this error.
  functionsFailWith: unknown;
  // The venue document the «server» holds: setStaffCard changes it, readVenueFromServer returns it.
  venue: DocData | null;
  // While true, readVenueFromServer rejects (offline).
  offline: boolean;
  // While true, a holiday write stays in the air until `confirmHeld()` or `refuseHeld()` answers it, and a read made meanwhile answers
  // as Firestore's getDoc does: the server's document with this phone's newest unanswered write on top, marked `pending`.
  holdWrites: boolean;
  // Answers the OLDEST held write: confirmed (the «server» now holds it) or refused (the «server» keeps what it had).
  confirmHeld(): void;
  refuseHeld(err: Error): void;
  // The roster the «server» holds. Setting it tells every live listener, as a snapshot would.
  members: readonly Member[];
  // How many roster listeners are live right now.
  readonly liveMembers: number;
  // Fails every live roster listener with this error (the stream breaking), as Firestore does.
  breakMembers(error: unknown): void;
  // While set, setMemberRole and setMemberName reject with this error (and the roster is left as it was).
  memberFailWith: unknown;
  // While set, createBusiness rejects with this error. While `holdBusiness` is true it stays in the air until `answerBusiness()`.
  businessFailWith: unknown;
  holdBusiness: boolean;
  answerBusiness(): void;
};

// A roster row for the specs.
export function member(uid: string, fields: Partial<Omit<Member, 'uid'>> = {}): Member {
  return { uid, email: `${uid}@club.test`, firstName: '', lastName: '', role: 'staff', title: null, ...fields };
}

// `now` is the clock the holiday is judged against (a date in the past is refused, as in the real source).
export function fakeSettingsSource(
  seed: { away?: MyAway | null; venue?: DocData | null; now?: () => number; members?: readonly Member[] } = {},
): FakeSettingsSource {
  const now = seed.now ?? Date.now;
  const state = {
    away: seed.away ?? null,
    refuseWith: null as unknown,
    functionsFailWith: null as unknown,
    venue: seed.venue === undefined ? {} : seed.venue,
    offline: false,
    holdWrites: false,
    members: seed.members ?? [] as readonly Member[],
    memberFailWith: null as unknown,
    businessFailWith: null as unknown,
    holdBusiness: false,
  };
  const heldBusiness: (() => void)[] = [];
  const rosterListeners = new Set<{ onChange: (members: readonly Member[]) => void; onError: (error: unknown) => void }>();
  const tellRoster = () => { for (const listener of [...rosterListeners]) listener.onChange(state.members); };
  const held: { until: string; confirm: () => void; refuse: (err: Error) => void }[] = [];

  return {
    get away() { return state.away; },
    set away(value) { state.away = value; },
    get refuseWith() { return state.refuseWith; },
    set refuseWith(value) { state.refuseWith = value; },
    get functionsFailWith() { return state.functionsFailWith; },
    set functionsFailWith(value) { state.functionsFailWith = value; },
    get venue() { return state.venue; },
    set venue(value) { state.venue = value; },
    get offline() { return state.offline; },
    set offline(value) { state.offline = value; },
    get holdWrites() { return state.holdWrites; },
    set holdWrites(value) { state.holdWrites = value; },
    get members() { return state.members; },
    set members(value) { state.members = value; tellRoster(); },
    get liveMembers() { return rosterListeners.size; },
    breakMembers(error) {
      const live = [...rosterListeners];
      rosterListeners.clear();
      for (const listener of live) listener.onError(error);
    },
    get memberFailWith() { return state.memberFailWith; },
    set memberFailWith(value) { state.memberFailWith = value; },
    get businessFailWith() { return state.businessFailWith; },
    set businessFailWith(value) { state.businessFailWith = value; },
    get holdBusiness() { return state.holdBusiness; },
    set holdBusiness(value) { state.holdBusiness = value; },
    answerBusiness() { heldBusiness.shift()?.(); },
    confirmHeld() { held.shift()?.confirm(); },
    refuseHeld(err) { held.shift()?.refuse(err); },

    readMyAway: vi.fn(() => {
      const newest = held[held.length - 1];
      return Promise.resolve(newest ? { until: newest.until, pending: true } : state.away);
    }),
    saveAway: vi.fn((uid, until) => {
      const doc = buildAwayDoc({ uid, until, now: now() });
      if (!doc) return { result: 'bad-date' as const };
      if (state.refuseWith !== null) return { result: 'saved' as const, written: Promise.reject(state.refuseWith as Error) };
      if (state.holdWrites) {
        const written = new Promise<void>((done, fail) => {
          held.push({
            until: doc.until,
            confirm: () => { state.away = { until: doc.until }; done(); },
            refuse: fail,
          });
        });
        return { result: 'saved' as const, written };
      }
      state.away = { until: doc.until };
      return { result: 'saved' as const, written: Promise.resolve() };
    }),
    setLanguage: vi.fn(async language => {
      if (state.functionsFailWith !== null) throw state.functionsFailWith as Error;
      state.venue = { ...state.venue, language };
    }),
    setStaffCard: vi.fn(async (card, hidden) => {
      if (state.functionsFailWith !== null) throw state.functionsFailWith as Error;
      // Money cards are stored the other way round (functions/onboarding.js): shown, not hidden.
      const optIn = card === 'foodcost' || card === 'inventory';
      const field = optIn ? 'staffShownCards' : 'staffHiddenCards';
      const current = (state.venue?.[field] ?? {}) as Record<string, unknown>;
      state.venue = { ...state.venue, [field]: { ...current, [card]: optIn ? !hidden : hidden } };
      return state.venue;
    }),
    readVenueFromServer: vi.fn(() => (state.offline ? Promise.reject(new Error('offline')) : Promise.resolve(state.venue))),
    // Answers as the function does: the role it was asked for, a title only on the manager level, six digits refused for anybody but an
    // employee (failed-precondition, the server's own refusal).
    createInvitation: vi.fn(async (role, title, kind): Promise<Invitation> => {
      if (state.functionsFailWith !== null) throw state.functionsFailWith as Error;
      if (kind === 'digits' && role !== 'staff') {
        throw Object.assign(new Error('A manager or an owner is invited with a link. Six digits are for employees.'), { code: 'functions/failed-precondition' });
      }
      return {
        code: kind === 'link' ? FAKE_LINK_TOKEN : FAKE_DIGITS,
        kind,
        role,
        title: role === 'manager' ? (title ?? 'manager') : null,
        expiresAt: now() + DAY_MS,
      };
    }),
    // Answers as the function does: a link (and no membership) for a customer's business, the caller as owner and no link for one of
    // their own.
    createBusiness: vi.fn(async (business: NewBusiness): Promise<CreatedBusiness> => {
      if (state.holdBusiness) await new Promise<void>(done => { heldBusiness.push(done); });
      if (state.businessFailWith !== null) throw state.businessFailWith as Error;
      if (business.forSelf) return { kind: 'mine', locationId: FAKE_BUSINESS_ID };
      return { kind: 'link', locationId: FAKE_BUSINESS_ID, token: FAKE_LINK_TOKEN, expiresAt: now() + LINK_DAYS * DAY_MS };
    }),
    // Answers at once from what it holds, as a listener does from the phone's copy.
    watchMembers: vi.fn((onChange, onError) => {
      const listener = { onChange, onError };
      rosterListeners.add(listener);
      onChange(state.members);
      return () => { rosterListeners.delete(listener); };
    }),
    // Answers as the function does: the last owner is never demoted or removed (failed-precondition), somebody not on the roster is
    // not-found, and a change is written to the roster, which every listener then hears.
    setMemberRole: vi.fn(async (uid, role, title) => {
      if (state.memberFailWith !== null) throw state.memberFailWith as Error;
      const target = state.members.find(m => m.uid === uid);
      if (!target) throw Object.assign(new Error('That person is not in this location.'), { code: 'functions/not-found' });
      if (role !== 'owner' && !state.members.some(m => m.uid !== uid && m.role === 'owner')) {
        throw Object.assign(new Error('This is the only owner. Make somebody else an owner first.'), { code: 'functions/failed-precondition' });
      }
      state.members = role === null
        ? state.members.filter(m => m.uid !== uid)
        : state.members.map(m => (m.uid === uid ? { ...m, role, title: role === 'manager' ? (title ?? 'manager') : null } : m));
      tellRoster();
    }),
    setMemberName: vi.fn(async (uid, firstName, lastName) => {
      if (state.memberFailWith !== null) throw state.memberFailWith as Error;
      if (!state.members.some(m => m.uid === uid)) {
        throw Object.assign(new Error('That person is not in this location.'), { code: 'functions/not-found' });
      }
      state.members = state.members.map(m => (m.uid === uid ? { ...m, firstName: firstName.trim(), lastName: lastName.trim() } : m));
      tellRoster();
    }),
  };
}
