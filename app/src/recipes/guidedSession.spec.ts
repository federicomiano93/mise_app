import { describe, expect, it } from 'vitest';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { RESUME_TTL_MS } from '@mise/shared/guided-model';
import { SESSION_KEY, clearSession, freshSession, readSession, resumableSession, snapshotOf, writeSession } from './guidedSession';
import type { GuidedSession, SessionStorage } from './guidedSession';

function fakeStorage(initial: Record<string, string> = {}): SessionStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: key => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: key => { delete data[key]; },
  };
}

const THROWING: SessionStorage = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('full'); },
  removeItem: () => { throw new Error('blocked'); },
};

const RECIPE: CatalogueRecipe = {
  id: 'r1',
  name: 'Focaccia',
  lossPct: 0,
  ingredients: [{ label: 'Flour', grams: 1000, unit: 'g', rid: 'rf' }],
  steps: [{ text: 'Mix', rows: ['rf'], seconds: 60, speed: '1' }, { text: 'Rest', rows: [], seconds: 0, speed: '' }],
  endNote: '  Check the dough  ',
};
const NOW = 1_800_000_000_000;

const sessionAt = (startedAt: number, overrides: Partial<GuidedSession> = {}): GuidedSession => ({
  recipeId: 'r1', snapshot: snapshotOf(RECIPE, 2000), stepIndex: 0, endsAt: 0, startedAt, ...overrides,
});

describe('the snapshot', () => {
  it('copies the name, the rows, the normalised steps, the closing message and the batch', () => {
    expect(snapshotOf(RECIPE, 2000)).toEqual({
      name: 'Focaccia',
      ingredients: RECIPE.ingredients,
      steps: [{ text: 'Mix', rows: ['rf'], seconds: 60, speed: '1' }, { text: 'Rest', rows: [], seconds: 0, speed: '' }],
      endNote: 'Check the dough',
      targetGrams: 2000,
    });
  });

  it('keeps no batch as 0, never NaN or negative', () => {
    for (const target of [null, undefined, 0, -5, Number.NaN]) {
      expect(snapshotOf(RECIPE, target).targetGrams, String(target)).toBe(0);
    }
  });
});

describe('the saved session', () => {
  it('uses the current app’s key and writes the exact shape', () => {
    const storage = fakeStorage();
    const session = freshSession(RECIPE, 2000, NOW);
    writeSession(session, storage);
    expect(SESSION_KEY).toBe('catalogue-guided-run');
    expect(Object.keys(JSON.parse(storage.data[SESSION_KEY] ?? '{}'))).toEqual(['recipeId', 'snapshot', 'stepIndex', 'endsAt', 'startedAt']);
    expect(Object.keys(session.snapshot)).toEqual(['name', 'ingredients', 'steps', 'endNote', 'targetGrams']);
    expect(readSession(storage)).toEqual({ ...session, stepIndex: 0, endsAt: 0, startedAt: NOW });
  });

  it('reads junk JSON, a non-object and a missing key as nothing', () => {
    expect(readSession(fakeStorage())).toBeNull();
    expect(readSession(fakeStorage({ [SESSION_KEY]: '{not json' }))).toBeNull();
    expect(readSession(fakeStorage({ [SESSION_KEY]: '42' }))).toBeNull();
    expect(readSession(fakeStorage({ [SESSION_KEY]: 'null' }))).toBeNull();
  });

  it('⚠️ never throws when the storage does', () => {
    expect(readSession(THROWING)).toBeNull();
    expect(() => { writeSession(sessionAt(NOW), THROWING); }).not.toThrow();
    expect(() => { clearSession(THROWING); }).not.toThrow();
    expect(resumableSession([RECIPE], NOW, THROWING)).toBeNull();
  });

  it('does nothing with no storage at all', () => {
    expect(readSession(null)).toBeNull();
    expect(() => { writeSession(sessionAt(NOW), null); clearSession(null); }).not.toThrow();
  });

  it('says whether the session was written (the card then carries a fresh mix with the move)', () => {
    expect(writeSession(sessionAt(NOW), fakeStorage())).toBe(true);
    expect(writeSession(sessionAt(NOW), THROWING)).toBe(false);
    expect(writeSession(sessionAt(NOW), null)).toBe(false);
  });

  it('clears', () => {
    const storage = fakeStorage();
    writeSession(sessionAt(NOW), storage);
    clearSession(storage);
    expect(storage.data[SESSION_KEY]).toBeUndefined();
  });
});

describe('a session worth offering back', () => {
  const held = [{ id: 'r1' }];
  const keep = (session: GuidedSession) => fakeStorage({ [SESSION_KEY]: JSON.stringify(session) });

  it('is a recent, whole session of a recipe still held', () => {
    const session = sessionAt(NOW - 60_000, { stepIndex: 1, endsAt: NOW + 5000 });
    expect(resumableSession(held, NOW, keep(session))).toEqual(session);
  });

  it('is refused when it is older than 24 hours', () => {
    expect(resumableSession(held, NOW, keep(sessionAt(NOW - RESUME_TTL_MS - 1)))).toBeNull();
    expect(resumableSession(held, NOW, keep(sessionAt(NOW - RESUME_TTL_MS + 1000)))).not.toBeNull();
  });

  it('⚠️ is refused when the clock has gone backwards (stale, not fresh)', () => {
    expect(resumableSession(held, NOW, keep(sessionAt(NOW + 1000)))).toBeNull();
  });

  it('is refused when the recipe has been deleted since', () => {
    expect(resumableSession([{ id: 'other' }], NOW, keep(sessionAt(NOW - 1000)))).toBeNull();
    expect(resumableSession([], NOW, keep(sessionAt(NOW - 1000)))).toBeNull();
  });

  it('is refused when the step index is outside the steps (refused, not clamped)', () => {
    expect(resumableSession(held, NOW, keep(sessionAt(NOW - 1000, { stepIndex: 2 })))).toBeNull();
    expect(resumableSession(held, NOW, keep(sessionAt(NOW - 1000, { stepIndex: -1 })))).toBeNull();
    expect(resumableSession(held, NOW, keep(sessionAt(NOW - 1000, { stepIndex: 0.5 })))).toBeNull();
  });

  it('is refused with no steps in the snapshot, no snapshot, or no recipe id', () => {
    const noSteps = sessionAt(NOW - 1000);
    noSteps.snapshot = { ...noSteps.snapshot, steps: [] };
    expect(resumableSession(held, NOW, keep(noSteps))).toBeNull();
    expect(resumableSession(held, NOW, fakeStorage({ [SESSION_KEY]: JSON.stringify({ recipeId: 'r1', stepIndex: 0, startedAt: NOW - 1000 }) }))).toBeNull();
    expect(resumableSession(held, NOW, keep({ ...sessionAt(NOW - 1000), recipeId: '' }))).toBeNull();
  });

  it('is refused when nothing is saved', () => {
    expect(resumableSession(held, NOW, fakeStorage())).toBeNull();
  });
});
