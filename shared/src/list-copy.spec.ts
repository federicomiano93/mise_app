// Tests for the local copy of the supplier and ingredient lists (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/list-copy.js, which the current app uses (PR #433, «instant list»). Both apps share one origin and one
// localStorage, so what one writes the other must read back — the cross-read test below is the one that matters most.
//
// ⚠️ js/orders/list-copy.js IS NOT ON EVERY BRANCH. Until #433 is merged this file runs on the port only; once the original is
// there the comparison is on by itself. That is why it is loaded with a variable path and a catch, not imported: a static import
// of a file that does not exist would fail the whole spec on a branch that has not got it yet. A file that is there but BROKEN
// fails the spec on purpose (see the catch below).
//
// PORTED: every behaviour of writeListCopy and readListCopy. LEFT OUT with the functions themselves (see list-copy.ts):
// bothLanded, shouldShowCopy, supplierToOpen, mayWriteCopy.

import { describe, expect, test, vi } from 'vitest';
import * as ported from './list-copy';
import * as portedLocalData from './local-data';
import * as legacyLocalData from '../../js/local-data.js';

// shared/ compiles without DOM types; the few globals the spec uses are declared.
declare const console: { warn(...args: unknown[]): void };
declare const URL: new (path: string, base: string) => { href: string };

type Impl = Pick<typeof ported, 'LIST_COPY_KEY' | 'LIST_COPY_VERSION' | 'LIST_COPY_WRITE_DELAY_MS' | 'writeListCopy' | 'readListCopy'>;

const legacyPath = new URL('../../js/orders/list-copy.js', (import.meta as unknown as { url: string }).url).href;
// ⚠️ ONLY «THE FILE IS NOT THERE» MEANS PORT-ONLY. A catch-all would also hide an original that is BROKEN (a syntax error, a
// failing import of its own), and the comparison would silently switch itself off: anything else is rethrown and fails the spec.
const legacy = (await import(/* @vite-ignore */ legacyPath).catch((err: unknown) => {
  if (String((err as { message?: unknown } | null)?.message ?? '').startsWith(`Cannot find module '${legacyPath}'`)) return null;
  throw err;
})) as Impl | null;

const implementations: Array<[string, Impl]> = [['shared/ (TypeScript)', ported]];
if (legacy) implementations.push(['js/ (current app)', legacy]);

function memory(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (): string | null => value,
    setItem: (_key: string, next: string): void => { value = next; },
    removeItem: (): void => { value = null; },
    read: (): string | null => value,
  };
}

const SUPPLIERS = [
  { id: 's1', name: 'Alpine Mills', shortName: 'Alpine', category: 'Flour', deliveryDays: ['Monday'], orderDays: ['Friday'], active: true },
  { id: 's2', name: 'Zed Dairy', active: false },
];
const INGREDIENTS = [
  { id: 'i1', name: 'Flour 00', supplierId: 's1', active: true, kind: 'ingredient' },
  { id: 'i2', name: 'Milk', supplierId: 's2' },
];

describe.each(implementations)('%s', (_name, m) => {
  const { LIST_COPY_KEY, LIST_COPY_VERSION, writeListCopy, readListCopy } = m;

  test('the key, the version and the delay are the ones the current app uses', () => {
    expect(LIST_COPY_KEY).toBe('orders-list-copy');
    expect(LIST_COPY_VERSION).toBe(1);
    expect(m.LIST_COPY_WRITE_DELAY_MS).toBe(3000);
  });

  test('what is written is read back, for the same venue', () => {
    const s = memory();
    expect(writeListCopy('bakery', SUPPLIERS, INGREDIENTS, s)).toBe(true);
    expect(readListCopy('bakery', s)).toStrictEqual({ suppliers: SUPPLIERS, ingredients: INGREDIENTS });
    expect(JSON.parse(s.read() as string)).toStrictEqual({ v: 1, lid: 'bakery', suppliers: SUPPLIERS, ingredients: INGREDIENTS });
  });

  test('⚠️ nothing but the whitelisted fields is stored: no price, contact, allergen or pack list', () => {
    const s = memory();
    writeListCopy('bakery', [
      { id: 's1', name: 'A', phone: '0123', email: 'a@b.test', price: 9, notes: 'secret' },
    ], [
      { id: 'i1', name: 'Flour', supplierId: 's1', price: 1.2, allergens: ['gluten'], packs: [{ size: 25 }], weight: '25kg', unit: 'kg' },
    ], s);
    const stored = JSON.parse(s.read() as string);
    expect(stored.suppliers).toStrictEqual([{ id: 's1', name: 'A' }]);
    expect(stored.ingredients).toStrictEqual([{ id: 'i1', name: 'Flour', supplierId: 's1' }]);
    expect(s.read()).not.toMatch(/price|phone|email|allergens|packs|secret/);
  });

  test('items that are not objects are not stored', () => {
    const s = memory();
    writeListCopy('bakery', [null, 'x', 4, { id: 's1' }], [undefined, { id: 'i1' }], s);
    expect(JSON.parse(s.read() as string)).toMatchObject({ suppliers: [{ id: 's1' }], ingredients: [{ id: 'i1' }] });
  });

  test('no storage: nothing is written and nothing is read', () => {
    expect(writeListCopy('bakery', SUPPLIERS, INGREDIENTS, null)).toBe(false);
    expect(readListCopy('bakery', null)).toBeNull();
  });

  test('a failed write says so without the data, removes the older copy and answers false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const removed = vi.fn();
    const full = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: removed,
    };
    expect(writeListCopy('bakery', SUPPLIERS, INGREDIENTS, full)).toBe(false);
    expect(removed).toHaveBeenCalledWith(LIST_COPY_KEY);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Alpine|Flour/);
    warn.mockRestore();
  });

  test('a failed write whose removal fails too still answers false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = {
      getItem: () => null,
      setItem: () => { throw new Error('boom'); },
      removeItem: () => { throw new Error('boom'); },
    };
    expect(writeListCopy('bakery', SUPPLIERS, INGREDIENTS, broken)).toBe(false);
    warn.mockRestore();
  });

  test('a value that is not a list makes the write fail the same way', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = memory('old');
    expect(writeListCopy('bakery', 'nope' as unknown as never[], INGREDIENTS, s)).toBe(false);
    expect(s.read()).toBeNull();
    warn.mockRestore();
  });

  test('⚠️ another venue’s copy is refused', () => {
    const s = memory();
    writeListCopy('bakery', SUPPLIERS, INGREDIENTS, s);
    expect(readListCopy('cafe', s)).toBeNull();
    expect(readListCopy('', s)).toBeNull();
    expect(readListCopy(null, s)).toBeNull();
  });

  test('another version is refused', () => {
    const s = memory(JSON.stringify({ v: 2, lid: 'bakery', suppliers: SUPPLIERS, ingredients: INGREDIENTS }));
    expect(readListCopy('bakery', s)).toBeNull();
    const none = memory(JSON.stringify({ lid: 'bakery', suppliers: SUPPLIERS, ingredients: INGREDIENTS }));
    expect(readListCopy('bakery', none)).toBeNull();
  });

  test.each([
    ['nothing stored', null],
    ['not JSON', '{oops'],
    ['null', 'null'],
    ['a number', '4'],
    ['a list', '[]'],
    ['a string', '"x"'],
  ])('an unreadable value (%s) is refused', (_what, raw) => {
    expect(readListCopy('bakery', memory(raw))).toBeNull();
  });

  test('lists that are not lists are refused', () => {
    expect(readListCopy('bakery', memory(JSON.stringify({ v: 1, lid: 'bakery', suppliers: {}, ingredients: [] })))).toBeNull();
    expect(readListCopy('bakery', memory(JSON.stringify({ v: 1, lid: 'bakery', suppliers: SUPPLIERS })))).toBeNull();
    expect(readListCopy('bakery', memory(JSON.stringify({ v: 1, lid: 'bakery', suppliers: SUPPLIERS, ingredients: 'x' })))).toBeNull();
  });

  test('⚠️ a copy with no suppliers is refused: an empty venue must never flash «no suppliers»', () => {
    const s = memory();
    writeListCopy('bakery', [], INGREDIENTS, s);
    expect(readListCopy('bakery', s)).toBeNull();
    const onlyJunk = memory(JSON.stringify({ v: 1, lid: 'bakery', suppliers: [{ name: 'no id' }, { id: '' }, { id: 4 }], ingredients: [] }));
    expect(readListCopy('bakery', onlyJunk)).toBeNull();
  });

  test('items without a string, non-empty id are dropped; the rest stay', () => {
    const raw = JSON.stringify({
      v: 1,
      lid: 'bakery',
      suppliers: [{ id: 's1', name: 'A' }, { name: 'no id' }, { id: '' }, { id: 7 }, null, 'x', ['s9']],
      ingredients: [{ id: 'i1' }, { id: null }, 3],
    });
    expect(readListCopy('bakery', memory(raw))).toStrictEqual({ suppliers: [{ id: 's1', name: 'A' }], ingredients: [{ id: 'i1' }] });
  });

  test('a storage that throws on read is refused, not raised', () => {
    const angry = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined, removeItem: () => undefined };
    expect(readListCopy('bakery', angry)).toBeNull();
  });
});

// ── Both apps, one localStorage ──────────────────────────────────────────────

describe.each(implementations.length > 1 ? [['the two files together', null]] as const : [])('%s', () => {
  test('⚠️ what one implementation wrote is read back by the other, both ways', () => {
    const [, a] = implementations[0] as [string, Impl];
    const [, b] = implementations[1] as [string, Impl];
    const first = memory();
    a.writeListCopy('bakery', SUPPLIERS, INGREDIENTS, first);
    expect(b.readListCopy('bakery', first)).toStrictEqual(a.readListCopy('bakery', first));
    const second = memory();
    b.writeListCopy('bakery', SUPPLIERS, INGREDIENTS, second);
    expect(a.readListCopy('bakery', second)).toStrictEqual(b.readListCopy('bakery', second));
    expect(second.read()).toBe(first.read());
  });

  test('both store exactly the same bytes for the same input, odd fields included', () => {
    const [, a] = implementations[0] as [string, Impl];
    const [, b] = implementations[1] as [string, Impl];
    const suppliers = [{ id: 's1', name: 'A', price: 1, active: false, deliveryDays: ['Mon'] }, null];
    const ingredients = [{ id: 'i1', allergens: ['x'], kind: 'sub' }];
    const first = memory();
    const second = memory();
    a.writeListCopy('bakery', suppliers, ingredients, first);
    b.writeListCopy('bakery', suppliers, ingredients, second);
    expect(first.read()).toBe(second.read());
  });
});

// ── The wipe ─────────────────────────────────────────────────────────────────

// ⚠️⚠️ THE KEY MUST NOT SURVIVE A SIGN-OUT OR A VENUE SWITCH, BY EITHER APP. It is one venue's data: local-data clears every key
// whose prefix is not on its keep-list, and this key must stay off that list.
describe.each([
  ['shared/ local-data', portedLocalData],
  ['js/ local-data (current app)', legacyLocalData as unknown as typeof portedLocalData],
] as const)('the wipe, %s', (_name, localData) => {
  test('the list copy is cleared on a switch, and a key that must survive is not', () => {
    expect(localData.keysToClear([ported.LIST_COPY_KEY, 'uk-bank-holidays']),
      `${ported.LIST_COPY_KEY} must NOT be kept — it belongs to one venue`).toStrictEqual([ported.LIST_COPY_KEY]);
  });
});
