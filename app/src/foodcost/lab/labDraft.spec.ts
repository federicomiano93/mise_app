import { beforeEach, describe, expect, it } from 'vitest';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import { LAB_DRAFT_PREFIX, clearDraft, labDraftKey, parseDraft, readDraft, serializeDraft, writeDraft } from './labDraft';
import type { DraftStorage } from './labDraft';
import { addLine, lineField, newDraft, startDraft, toggleTick, typeInto } from './labModel';
import type { LabDraft } from './labModel';

// The draft: a production in progress, kept on the tablet. Saved, restored, and never trusted.

const PRESETS = { raw: '', pieces: '', minutes: '' };

function memory(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

function aDraft(): LabDraft {
  let draft = startDraft(newDraft({
    id: 'bread',
    name: 'Bread',
    components: [
      { recipeId: 'DOUGH', qtyKg: 0.6 },
      { kind: 'ingredient', ingredientId: 'SALT', qty: 10, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'FLOUR', qty: 0.5, unit: 'kg' },
    ],
    packaging: [],
    sellingMode: 'piece',
    piecesPerBatch: 24,
    packSize: null,
    packUnit: null,
    sellingPrice: 3,
    vatRate: 0,
    foodCostTarget: null,
    labourMinutes: 40,
    labourPeople: 2,
    noWeightLoss: false,
    rawGrams: null,
    cookedGrams: null,
    model: 3,
  }), 1_700_000_000_000);
  draft = toggleTick(draft, 'l1');
  draft = typeInto(draft, lineField('l0'), '6', PRESETS);
  draft = addLine(draft, { kind: 'ingredient', ingredientId: 'SUGAR', unit: 'g' }).draft;
  draft = { ...draft, step: 'cooked', raw: '1300', cooked: '1,5', pieces: '22', minutes: '35', minutesFrozen: 21, people: 3 };
  return draft;
}

describe('a draft is saved and restored whole', () => {
  let storage: ReturnType<typeof memory>;
  beforeEach(() => { storage = memory(); });

  it('comes back exactly as it went', () => {
    const draft = aDraft();
    writeDraft('k', draft, storage);
    expect(readDraft('k', storage)).toEqual(draft);
  });

  it('is keyed by venue and product', () => {
    expect(labDraftKey('bakery', 'bread')).toBe(`${LAB_DRAFT_PREFIX}bakery:bread`);
    expect(labDraftKey('bakery', 'bread')).not.toBe(labDraftKey('restaurant', 'bread'));
    expect(labDraftKey('bakery', 'bread')).not.toBe(labDraftKey('bakery', 'cake'));
  });

  it('is not stored before «Inizia»: nothing runs, nothing is open', () => {
    writeDraft('k', { ...aDraft(), startedAt: null }, storage);
    expect(storage.map.size).toBe(0);
  });

  it('is cleared', () => {
    writeDraft('k', aDraft(), storage);
    clearDraft('k', storage);
    expect(readDraft('k', storage)).toBeNull();
  });

  it('lives where a sign-out or a venue switch wipes it (it is not under KEEP_PREFIXES)', () => {
    expect(keysToClear([labDraftKey('bakery', 'bread')], KEEP_PREFIXES)).toEqual([labDraftKey('bakery', 'bread')]);
  });
});

describe('a draft is never trusted', () => {
  const good = (): Record<string, unknown> => JSON.parse(serializeDraft(aDraft())) as Record<string, unknown>;
  const read = (data: unknown) => parseDraft(JSON.stringify(data));

  it('reads an old draft without the oven fields as zero paused time', () => {
    const old = good();
    delete old.ovenSince;
    delete old.ovenPausedMs;
    const draft = read({ ...old, step: 'oven' });
    expect(draft?.ovenPausedMs).toBe(0);
    expect(draft?.ovenSince).toBeNull();
  });

  it('keeps the oven visit, only on the oven step, and clamps nonsense', () => {
    const inOven = read({ ...good(), step: 'oven', ovenSince: 1_700_000_100_000, ovenPausedMs: 5000 });
    expect(inOven?.ovenSince).toBe(1_700_000_100_000);
    expect(inOven?.ovenPausedMs).toBe(5000);
    // A visit "in progress" on another step means nothing.
    expect(read({ ...good(), step: 'raw', ovenSince: 1_700_000_100_000 })?.ovenSince).toBeNull();
    expect(read({ ...good(), ovenPausedMs: -5 })?.ovenPausedMs).toBe(0);
    expect(read({ ...good(), ovenPausedMs: 'x' })?.ovenPausedMs).toBe(0);
  });

  it('reads a sound draft', () => {
    expect(read(good())).not.toBeNull();
  });

  it('gives none for text that is not JSON, not an object, or another version', () => {
    expect(parseDraft('{not json')).toBeNull();
    expect(parseDraft('[]')).toBeNull();
    expect(parseDraft('null')).toBeNull();
    expect(parseDraft('"x"')).toBeNull();
    expect(parseDraft(null)).toBeNull();
    expect(read({ ...good(), v: 2 })).toBeNull();
  });

  it('gives none for a start that is not a real instant', () => {
    for (const startedAt of [null, 0, -5, 'now']) expect(read({ ...good(), startedAt })).toBeNull();
  });

  it('gives none for an unknown step, lines that are not lines, or too many of them', () => {
    expect(read({ ...good(), step: 'party' })).toBeNull();
    expect(read({ ...good(), lines: 'x' })).toBeNull();
    expect(read({ ...good(), lines: [{ key: 'a' }] })).toBeNull();
    const many = Array.from({ length: 201 }, (_, i) => ({ key: `l${i}`, ref: { kind: 'recipe', recipeId: 'R' }, planned: 1, added: false }));
    expect(read({ ...good(), lines: many })).toBeNull();
    const first = (good().lines as unknown[])[0];
    expect(read({ ...good(), lines: [first, first] })).toBeNull();
  });

  it('gives none for a line with an unknown unit or a negative planned weight', () => {
    const line = (ref: unknown, planned: unknown) => ({ key: 'x', ref, planned, added: false });
    expect(read({ ...good(), lines: [line({ kind: 'ingredient', ingredientId: 'A', unit: 'tons' }, 1)] })).toBeNull();
    expect(read({ ...good(), lines: [line({ kind: 'recipe', recipeId: 'A' }, -1)] })).toBeNull();
  });

  it('clamps and defaults what is merely odd: the draft survives, the nonsense does not', () => {
    const draft = read({
      ...good(),
      people: 500,
      minutes: 'abc',
      raw: '12345678',
      cooked: 7,
      pieces: null,
      minutesFrozen: -3,
      weighed: { l0: 'x', l1: '12,5', ghost: '5' },
      ticked: { l1: true, ghost: true, l0: 'yes' },
    });
    expect(draft).not.toBeNull();
    expect(draft?.people).toBe(20);
    expect(draft?.minutes).toBeNull();
    expect(draft?.raw).toBeNull();
    expect(draft?.cooked).toBe('');
    expect(draft?.minutesFrozen).toBeNull();
    // Only typed text of a line that exists; only a real `true` of a line that exists.
    expect(draft?.weighed).toEqual({ l1: '12,5' });
    expect(draft?.ticked).toEqual({ l1: true });
  });

  it('removes a corrupt draft when it meets one, so the card shows no banner for it', () => {
    const storage = memory();
    storage.setItem('k', '{broken');
    expect(readDraft('k', storage)).toBeNull();
    expect(storage.map.has('k')).toBe(false);
  });

  it('works with no storage at all (blocked site data): nothing is remembered, nothing throws', () => {
    expect(readDraft('k', null)).toBeNull();
    expect(() => { writeDraft('k', aDraft(), null); clearDraft('k', null); }).not.toThrow();
  });

  it('survives a storage that refuses to write or to read', () => {
    const refusing: DraftStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(() => { writeDraft('k', aDraft(), refusing); clearDraft('k', refusing); }).not.toThrow();
    expect(readDraft('k', refusing)).toBeNull();
  });
});
