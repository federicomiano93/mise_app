import { vi } from 'vitest';
import { buildAwayDoc } from '@mise/shared/away-model';
import type { DocData } from '../session/backend';
import type { MyAway, SettingsSource } from '../settings/settingsSource';

// A settings source for the specs, in memory. The holiday lands at once (as Firestore's local copy does); a write is refused, as the
// rules or the network would, by setting `refuseWith`. The Cloud Functions are `vi.fn`s a spec can make fail.
export type FakeSettingsSource = SettingsSource & {
  // This person's holiday document, as read once.
  away: MyAway | null;
  // While set, a holiday write's promise rejects with this error (and the document is left as it was).
  refuseWith: unknown;
  // While set, setLanguage and setStaffCard reject with this error.
  functionsFailWith: unknown;
  // The venue document the «server» holds: setStaffCard changes it, readVenueFromServer returns it.
  venue: DocData | null;
  // While true, readVenueFromServer rejects (offline).
  offline: boolean;
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
  };

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

    readMyAway: vi.fn(() => Promise.resolve(state.away)),
    saveAway: vi.fn((uid, until) => {
      const doc = buildAwayDoc({ uid, until, now: now() });
      if (!doc) return { result: 'bad-date' as const };
      if (state.refuseWith !== null) return { result: 'saved' as const, written: Promise.reject(state.refuseWith as Error) };
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
  };
}
