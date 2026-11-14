import { vi } from 'vitest';
import { buildAwayDoc } from '@mise/shared/away-model';
import type { DocData } from '../session/backend';
import type { Invitation, MyAway, SettingsSource } from '../settings/settingsSource';

// What the fake «server» mints: six digits for an employee, a link token for anybody, both living a day (functions/onboarding.js).
export const FAKE_DIGITS = '482913';
export const FAKE_LINK_TOKEN = 'Q7xk2mP9vR4tY8wZ1nB6cD3fG5hJ0sLa';
const DAY_MS = 24 * 60 * 60 * 1000;

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
};

// `now` is the clock the holiday is judged against (a date in the past is refused, as in the real source).
export function fakeSettingsSource(
  seed: { away?: MyAway | null; venue?: DocData | null; now?: () => number } = {},
): FakeSettingsSource {
  const now = seed.now ?? Date.now;
  const state = {
    away: seed.away ?? null,
    refuseWith: null as unknown,
    functionsFailWith: null as unknown,
    venue: seed.venue === undefined ? {} : seed.venue,
    offline: false,
    holdWrites: false,
  };
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
  };
}
