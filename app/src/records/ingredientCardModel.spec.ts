import { describe, expect, test } from 'vitest';
import {
  NEW_CHOICE, NO_SUPPLIER_ID, activePatch, buildSave, firstRefusal, formState, isDirty, kindFor, orderNow, packTypeChoiceOf, packTypeVisible, readChoice, typeGuardOf, weightText, withFormat, withInner, withPackType,
  workingFrom,
} from './ingredientCardModel';
import type { ItemLike, Working } from './ingredientCardModel';

// The ingredient card's working copy and its payload (parity C36–C57, C80–C81, C84–C87), with no screen in the way.

const SUPPLIERS = ['s-alp', 's-bru'];
const open = (item: ItemLike | null, preset: string | null = null) => workingFrom(item, { supplierIds: SUPPLIERS, preset });
const save = (working: Working, item: ItemLike | null, kind: 'ingredient' | 'packaging' = 'ingredient', lang = 'en') =>
  buildSave({ working, item, kind, lang, startSupplierId: workingFrom(item, { supplierIds: SUPPLIERS, preset: null }).supplierId });
// A NEW item whose format the person has already picked (Save refuses one that has not chosen).
const chosen = (item: ItemLike | null, preset: string | null = null) => withFormat(open(item, preset), 'single', 'en');
const typed = (working: Working, change: Partial<Working>): Working => ({ ...working, ...change });

const FLOUR: ItemLike = { id: 'i-1', name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', unit: 'kg' };

describe('opening: the copy a card is made from', () => {
  test('a stored item shows every stored value', () => {
    expect(open(FLOUR)).toEqual({
      name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo',
      category: { choice: 'Bakery', typed: '' }, weight: { amount: '25', unit: 'kg', legacy: '' },
      format: 'single', formatChosen: true, count: '', inner: { choice: '', typed: '' }, innerAutoSet: false,
      packType: { choice: '', typed: '' }, packTypeTouched: false, notInUse: false,
    });
  });

  test('a new item starts empty, on «No supplier», in kilos', () => {
    expect(open(null)).toEqual({
      name: '', shortName: '', supplierId: NO_SUPPLIER_ID, brand: '', category: { choice: '', typed: '' },
      weight: { amount: '', unit: 'kg', legacy: '' }, format: 'single', formatChosen: false, count: '', inner: { choice: '', typed: '' }, innerAutoSet: false,
      packType: { choice: '', typed: '' }, packTypeTouched: false, notInUse: false,
    });
  });

  test('⚠️ a supplier that is gone falls to «No supplier»; so does the stored word itself', () => {
    expect(open({ id: 'x', name: 'x', supplierId: 's-deleted' }).supplierId).toBe(NO_SUPPLIER_ID);
    expect(open({ id: 'x', name: 'x', supplierId: NO_SUPPLIER_ID }).supplierId).toBe(NO_SUPPLIER_ID);
    expect(open({ id: 'x', name: 'x' }).supplierId).toBe(NO_SUPPLIER_ID);
  });

  test('⚠️ the preset supplier is for a NEW item only, never an existing one', () => {
    expect(open(null, 's-bru').supplierId).toBe('s-bru');
    expect(open(FLOUR, 's-bru').supplierId).toBe('s-alp');
    // A preset that names no supplier is no preset.
    expect(open(null, 's-gone').supplierId).toBe(NO_SUPPLIER_ID);
  });

  test('a stored case opens as a Case with its count and its inner word', () => {
    const working = open({ id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: 'case', weight: '2.5 kg' });
    expect(working).toMatchObject({ format: 'carton', count: '4', inner: { choice: 'bag' }, weight: { amount: '2.5', unit: 'kg' } });
  });

  test('a carton word as the order unit, with a package word, opens as a Case with no count (nothing to read it from)', () => {
    const working = open({ id: 'x', name: 'x', unit: 'cartone', packUnit: 'busta' });
    expect(working).toMatchObject({ format: 'carton', count: '', inner: { choice: 'busta' } });
  });

  test('a package word as the unit with no packCount is a Single, and the word is kept for the menu', () => {
    const working = open({ id: 'x', name: 'x', unit: 'busta', packUnit: 'busta' });
    expect(working).toMatchObject({ format: 'single', inner: { choice: 'busta' } });
  });

  test('⚠️ a weight the boxes cannot show is kept as «Current», not lost', () => {
    expect(open({ id: 'x', name: 'x', weight: '6x1kg' }).weight).toEqual({ amount: '', unit: 'kg', legacy: '6x1kg' });
    expect(open({ id: 'x', name: 'x', weight: '50 cl' }).weight.legacy).toBe('50 cl');
    expect(open({ id: 'x', name: 'x', weight: '2,27 kg' }).weight).toEqual({ amount: '2.27', unit: 'kg', legacy: '' });
    expect(open({ id: 'x', name: 'x', weight: '1 lt' }).weight).toEqual({ amount: '1', unit: 'l', legacy: '' });
  });

  test('the category is matched exactly, and the stored «no category» word reads back as none', () => {
    expect(open({ id: 'x', name: 'x', category: 'Other' }).category.choice).toBe('');
    expect(open({ id: 'x', name: 'x', category: '  farine ' }).category.choice).toBe('farine');
    expect(open({ id: 'x', name: 'x', category: 'Farine' }).category.choice).toBe('Farine');
  });
});

describe('the format buttons', () => {
  test('Case with no inner word picks the venue\'s default, in the venue\'s language', () => {
    const single = open(null);
    expect(withFormat(single, 'carton', 'en')).toMatchObject({ format: 'carton', inner: { choice: 'bag' }, innerAutoSet: true });
    expect(withFormat(single, 'carton', 'it')).toMatchObject({ inner: { choice: 'busta' } });
  });

  test('Case keeps an inner word that is already there', () => {
    const single = open({ id: 'x', name: 'x', packUnit: 'tub' });
    expect(withFormat(single, 'carton', 'en')).toMatchObject({ inner: { choice: 'tub' }, innerAutoSet: false });
  });

  test('back to Single un-picks the word it picked itself, and only that one', () => {
    const picked = withFormat(open(null), 'carton', 'en');
    expect(withFormat(picked, 'single', 'en')).toMatchObject({ format: 'single', inner: { choice: '' }, innerAutoSet: false });
    const chosen = withInner(picked, { choice: 'sack', typed: '' });
    expect(withFormat(chosen, 'single', 'en')).toMatchObject({ inner: { choice: 'sack' } });
  });

  test('the same format again changes nothing', () => {
    const working = open(FLOUR);
    expect(withFormat(working, 'single', 'en')).toBe(working);
  });

  test('⚠️ from the empty state any choice counts, picking «Single» included', () => {
    const empty = open(null);
    expect(empty.formatChosen).toBe(false);
    expect(withFormat(empty, 'single', 'en')).toMatchObject({ format: 'single', formatChosen: true });
    expect(withFormat(empty, 'carton', 'en')).toMatchObject({ format: 'carton', formatChosen: true });
  });
});

describe('what counts as a change', () => {
  const base = open(FLOUR);

  test('nothing typed is not dirty, and a Case picked then un-picked is not either', () => {
    expect(isDirty(base, open(FLOUR))).toBe(false);
    expect(isDirty(withFormat(withFormat(base, 'carton', 'en'), 'single', 'en'), base)).toBe(false);
  });

  test.each([
    ['the name', typed(base, { name: 'Flour 0' })],
    ['the short name', typed(base, { shortName: '' })],
    ['the supplier', typed(base, { supplierId: 's-bru' })],
    ['the brand', typed(base, { brand: 'X' })],
    ['the category', typed(base, { category: { choice: '', typed: '' } })],
    ['the weight number', typed(base, { weight: { ...base.weight, amount: '20' } })],
    ['the weight unit', typed(base, { weight: { ...base.weight, unit: 'g' } })],
    ['removing the kept weight text', typed(open({ id: 'x', name: 'x', weight: 'sacco' }), { weight: { amount: '', unit: 'kg', legacy: '' } })],
    ['the format', withFormat(base, 'carton', 'en')],
    ['the count', typed(base, { count: '3' })],
    ['a new category being typed', typed(base, { category: { choice: NEW_CHOICE, typed: 'Dairy' } })],
  ])('%s', (_name, changed) => {
    const baseline = _name === 'removing the kept weight text' ? open({ id: 'x', name: 'x', weight: 'sacco' }) : base;
    expect(isDirty(changed, baseline)).toBe(true);
  });

  test('text typed in a «+ New …» box that is not the option chosen does not count', () => {
    expect(isDirty(typed(base, { category: { choice: 'Bakery', typed: 'ghost' } }), base)).toBe(false);
  });
});

describe('the refusals, in the card\'s order (parity C84)', () => {
  const ok = open(FLOUR);

  test('a blank name first, whatever else is wrong', () => {
    const bad = typed(ok, { name: '  ', weight: { amount: 'abc', unit: 'kg', legacy: '' } });
    expect(firstRefusal(bad, FLOUR)).toBe('name');
  });

  test('then the weight, then the category, then the inner word\'s new box (only while Case shows)', () => {
    const weight = { amount: '2.27kg', unit: 'kg' as const, legacy: '' };
    const category = { choice: NEW_CHOICE, typed: '  ' };
    const inner = { choice: NEW_CHOICE, typed: '' };
    expect(firstRefusal(typed(ok, { weight, category, inner, format: 'carton', count: '2' }), FLOUR)).toBe('weight');
    expect(firstRefusal(typed(ok, { category, inner, format: 'carton', count: '2' }), FLOUR)).toBe('category');
    expect(firstRefusal(typed(ok, { inner, format: 'carton', count: '2' }), FLOUR)).toBe('inner');
    expect(firstRefusal(typed(ok, { inner, format: 'single' }), FLOUR)).toBeNull();
  });

  test('a new item with no format chosen is refused right after the category, before the case checks', () => {
    const fresh = typed(open(null), { name: 'Salt' });
    expect(firstRefusal(fresh, null)).toBe('format');
    expect(firstRefusal(typed(fresh, { category: { choice: NEW_CHOICE, typed: '' } }), null)).toBe('category');
    expect(firstRefusal(withFormat(fresh, 'single', 'en'), null)).toBeNull();
    expect(() => save(fresh, null)).toThrow('the format was never chosen');
  });

  test('an existing item is never refused for the format', () => {
    expect(open(FLOUR).formatChosen).toBe(true);
    expect(firstRefusal(open(FLOUR), FLOUR)).toBeNull();
  });

  test('an unusable weight is refused: abc, 0, a unit typed in the box; an empty box is «no weight»', () => {
    for (const amount of ['abc', '0', '-2', '2.27kg']) {
      expect(firstRefusal(typed(ok, { weight: { amount, unit: 'kg', legacy: '' } }), FLOUR)).toBe('weight');
    }
    expect(firstRefusal(typed(ok, { weight: { amount: '', unit: 'kg', legacy: '' } }), FLOUR)).toBeNull();
    expect(firstRefusal(typed(ok, { weight: { amount: '2,5', unit: 'g', legacy: '' } }), FLOUR)).toBeNull();
  });

  test('a Case being written needs a whole count 1..10000, checked before the inner word', () => {
    const toCase = withFormat(ok, 'carton', 'en');
    expect(firstRefusal(toCase, FLOUR)).toBe('count');
    for (const count of ['0', '2.5', 'x', '10001', ' ']) {
      expect(firstRefusal(typed(toCase, { count }), FLOUR)).toBe('count');
    }
    for (const count of ['1', '4', '10000']) expect(firstRefusal(typed(toCase, { count }), FLOUR)).toBeNull();
    // No count AND no word: the count is said first.
    expect(firstRefusal(typed(toCase, { count: '', inner: { choice: '', typed: '' } }), FLOUR)).toBe('count');
    expect(firstRefusal(typed(toCase, { count: '3', inner: { choice: '', typed: '' } }), FLOUR)).toBe('innerEmpty');
  });

  test('⚠️ a Case nobody touched is not refused: an old product with no count saves as it was', () => {
    const legacy = { id: 'x', name: 'x', unit: 'cartone', packUnit: 'busta' };
    const working = open(legacy);
    expect(working).toMatchObject({ format: 'carton', count: '', inner: { choice: 'busta' } });
    expect(firstRefusal(working, legacy)).toBeNull();
    // Touch it (the count moves) and the missing count is refused.
    expect(firstRefusal(typed(working, { count: 'x' }), legacy)).toBe('count');
    expect(firstRefusal(working, legacy)).toBeNull();
  });
});

describe('the payload, key for key (parity C87)', () => {
  test('a rename writes the product data and NO format key, no price key, no allergen or nutrition key', () => {
    const built = save(typed(open(FLOUR), { name: ' Flour 000 ', brand: ' Caputo  ' }), FLOUR);
    expect(built.payload).toEqual({
      name: 'Flour 000', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', kind: 'ingredient',
    });
    expect(built.unitChangedFrom).toBe('');
    for (const key of ['unit', 'packCount', 'packUnit', 'pricePerUnit', 'priceUnit', 'vatRate', 'allergens', 'mayContain', 'allergensCheckedAt',
      'nutrition', 'packIngredients', 'invoiceName', 'supplierCode', 'supplierCodes']) {
      expect(key in built.payload, key).toBe(false);
    }
  });

  test('an untouched existing card writes no format key', () => {
    const built = save(open(FLOUR), FLOUR);
    for (const key of ['unit', 'packUnit', 'packCount']) expect(key in built.payload, key).toBe(false);
  });

  test('a blank short name is sent as an empty string (a merge can then clear it), a blank category as «Other»', () => {
    const built = save(typed(open(FLOUR), { shortName: '  ', category: { choice: '', typed: '' } }), FLOUR);
    expect(built.payload.shortName).toBe('');
    expect(built.payload.category).toBe('Other');
  });

  test('a new category is the typed word, trimmed', () => {
    const built = save(typed(open(FLOUR), { category: { choice: NEW_CHOICE, typed: '  Dairy ' } }), FLOUR);
    expect(built.payload.category).toBe('Dairy');
  });

  test('⚠️ an unreadable weight is kept untouched unless a usable number is typed', () => {
    const odd: ItemLike = { id: 'x', name: 'x', weight: '6x1kg' };
    expect(save(open(odd), odd).payload.weight).toBe('6x1kg');
    const fixed = typed(open(odd), { weight: { amount: '6', unit: 'kg', legacy: '6x1kg' } });
    expect(save(fixed, odd).payload.weight).toBe('6 kg');
    expect(save(typed(open(odd), { weight: { amount: '', unit: 'kg', legacy: '' } }), odd).payload.weight).toBe('');
    expect(weightText(typed(open(odd), { weight: { amount: '2,5', unit: 'l', legacy: '' } }))).toBe('2.5 l');
  });

  test('«Not in use at the moment»: `active` is sent only when the switch moved; a new item is active', () => {
    const off: ItemLike = { id: 'x', name: 'x', active: false };
    const on: ItemLike = { id: 'x', name: 'x' };
    expect(open(off).notInUse).toBe(true);
    expect(open(on).notInUse).toBe(false);
    expect('active' in save(open(off), off).payload, 'not moved: absent, never an old copy of the flag').toBe(false);
    expect('active' in save(open(on), on).payload).toBe(false);
    expect(save(typed(open(on), { notInUse: true }), on).payload.active, 'switched off').toBe(false);
    expect(save(typed(open(off), { notInUse: false }), off).payload.active, 'switched back on').toBe(true);
    expect(save(typed(chosen(null), { name: 'Salt' }), null).payload.active).toBe(true);
    expect(activePatch(typed(open(null), { notInUse: true }), null)).toEqual({ active: false });
  });

  test('the switch is part of what counts as a change', () => {
    const base = open(FLOUR);
    expect(isDirty(typed(base, { notInUse: true }), base)).toBe(true);
    expect(isDirty(typed(base, { notInUse: false }), base)).toBe(false);
  });

  test('the kind is sent, and fixed: an existing packaging item stays packaging whatever the address said', () => {
    const box: ItemLike = { id: 'b', name: 'Box', kind: 'packaging' };
    expect(kindFor(box, false)).toBe('packaging');
    expect(kindFor(FLOUR, true)).toBe('ingredient');
    expect(kindFor(null, true)).toBe('packaging');
    expect(kindFor(null, false)).toBe('ingredient');
    expect(save(open(box), box, 'packaging').payload.kind).toBe('packaging');
  });

  test('a NEW ingredient: an empty unit, active, no format keys while it is a Single', () => {
    const built = save(typed(chosen(null), { name: 'Salt' }), null);
    expect(built.payload).toEqual({
      name: 'Salt', shortName: '', supplierId: NO_SUPPLIER_ID, brand: '', weight: '', category: 'Other', unit: '', active: true, kind: 'ingredient',
    });
    expect(built.unitChangedFrom).toBe('');
  });

  test('a NEW packaging item is filed as packaging', () => {
    const built = save(typed(chosen(null, 's-bru'), { name: 'Box 30x40' }), null, 'packaging');
    expect(built.payload).toMatchObject({ name: 'Box 30x40', supplierId: 's-bru', unit: '', active: true, kind: 'packaging' });
  });

  test('a NEW Case writes its count, its inner word and the venue\'s carton word as the order unit', () => {
    const working = typed(withFormat(typed(open(null), { name: 'Passata' }), 'carton', 'it'), { count: '6' });
    expect(save(working, null, 'ingredient', 'it').payload).toMatchObject({ packCount: 6, packUnit: 'busta', unit: 'cartone' });
    const english = typed(withFormat(typed(open(null), { name: 'Passata' }), 'carton', 'en'), { count: '6' });
    expect(save(english, null, 'ingredient', 'en').payload).toMatchObject({ packCount: 6, packUnit: 'bag', unit: 'case' });
  });

  test('⚠️ the package word is cut at 40 characters, the rules\' limit', () => {
    const long = 'x'.repeat(60);
    const working = typed(withFormat(open(null), 'carton', 'en'), { name: 'n', count: '2', inner: { choice: NEW_CHOICE, typed: long } });
    expect(save(working, null).payload.packUnit).toBe('x'.repeat(40));
  });

  test('⚠️ the menu\'s marker is never saved: the supplier the card opened on comes instead', () => {
    const built = buildSave({
      working: typed(open(FLOUR), { supplierId: '__mise_new_supplier__' }), item: FLOUR, kind: 'ingredient', lang: 'en', startSupplierId: 's-alp',
    });
    expect(built.payload.supplierId).toBe('s-alp');
  });

  test('the sentence names the name shown in lists', () => {
    expect(formState(open(FLOUR))).toEqual({ kind: 'single', count: null, inner: '' });
    expect(readChoice({ choice: NEW_CHOICE, typed: ' tray ' })).toBe('tray');
  });
});

describe('the format keys and the order unit they replace (parity C53, C35)', () => {
  test('Single → Case on a kilo item: count, word, the carton word; the line is frozen in «kg»', () => {
    const working = typed(withFormat(open(FLOUR), 'carton', 'en'), { count: '4' });
    const built = save(working, FLOUR);
    expect(built.payload).toMatchObject({ packCount: 4, packUnit: 'bag', unit: 'case' });
    expect(built.unitChangedFrom).toBe('kg');
  });

  test('Single → Case on an item with no unit but a package word: frozen in the package word', () => {
    const item: ItemLike = { id: 'x', name: 'x', packUnit: 'tub' };
    const built = save(typed(withFormat(open(item), 'carton', 'en'), { count: '12' }), item);
    expect(built.payload).toMatchObject({ packCount: 12, packUnit: 'tub', unit: 'case' });
    expect(built.unitChangedFrom).toBe('tub');
  });

  test('Case → Single: the count goes (null), the carton word becomes the package word', () => {
    const item: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: 'case' };
    const built = save(withFormat(open(item), 'single', 'en'), item);
    expect(built.payload).toMatchObject({ packCount: null, unit: 'bag' });
    expect(built.payload).not.toHaveProperty('packUnit');
    expect(built.unitChangedFrom).toBe('case');
  });

  test('⚠️ an empty unit on a card that opened as a Case meant «the whole case»: turned into a Single it is frozen in the carton word', () => {
    const item: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: '' };
    const built = save(withFormat(open(item), 'single', 'en'), item);
    expect(built.payload).toMatchObject({ packCount: null, unit: 'bag' });
    expect(built.unitChangedFrom).toBe('case');
    // ...and in the venue's own carton word.
    expect(save(withFormat(open(item), 'single', 'it'), item, 'ingredient', 'it').unitChangedFrom).toBe('cartone');
  });

  test('⚠️ the same empty unit, a Case staying a Case (the count moved): the carton word now written means what «» meant, nothing is frozen', () => {
    const item: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: '' };
    const built = save(typed(open(item), { count: '6' }), item);
    expect(built.payload).toMatchObject({ packCount: 6, unit: 'case' });
    expect(built.unitChangedFrom).toBe('');
  });

  test('a Case whose count moved keeps its own carton word and freezes nothing', () => {
    const item: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: 'cartone' };
    const built = save(typed(open(item), { count: '5' }), item);
    expect(built.payload).toMatchObject({ packCount: 5, unit: 'cartone' });
    expect(built.unitChangedFrom).toBe('');
  });

  test('a rename of a Case writes none of it', () => {
    const item: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: 'case' };
    const built = save(typed(open(item), { name: 'y' }), item);
    expect(built.payload).not.toHaveProperty('packCount');
    expect(built.payload).not.toHaveProperty('unit');
    expect(built.unitChangedFrom).toBe('');
  });
});

// ── The price's side of the card (step 3e-3: parity C48, C51, C54, C55, C65, C84, C85) ─────────────────────────

describe('the format as a price writer opens it (parity C48, C51)', () => {
  const STORED_CASE: ItemLike = {
    id: 'x', name: 'x', unit: 'cartone', packUnit: 'busta', weight: '2.5kg', priceUnit: 'pcs', pricePerUnit: 5,
    casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5,
  };
  const priced = (item: ItemLike | null, preset: string | null = null) => workingFrom(item, { supplierIds: SUPPLIERS, preset, mayPrice: true, lang: 'it' });

  test('the count of a carton with no packCount is read from the stored case for a price writer, and left empty for anybody else', () => {
    expect(priced(STORED_CASE)).toMatchObject({ format: 'carton', count: '4' });
    expect(workingFrom(STORED_CASE, { supplierIds: SUPPLIERS, preset: null, mayPrice: false, lang: 'it' })).toMatchObject({ format: 'carton', count: '' });
    expect(open(STORED_CASE)).toMatchObject({ format: 'carton', count: '' });
  });

  test('a stored case of PIECES whose ingredient names no package opens showing the venue\'s piece word, in its language', () => {
    const item = { ...STORED_CASE, packUnit: '' };
    expect(priced(item).inner.choice).toBe('pezzo');
    expect(workingFrom(item, { supplierIds: SUPPLIERS, preset: null, mayPrice: true, lang: 'en' }).inner.choice).toBe('piece');
    // a case priced by weight shows no invented word
    expect(priced({ ...item, caseItemUnit: 'pack', caseItemSize: 2.5, priceUnit: 'kg', pricePerUnit: 2 }).inner.choice).toBe('');
  });

  test('the shown piece word is not a change: an untouched Save writes no format key and no package word', () => {
    const item = { ...STORED_CASE, packUnit: '', packCount: 4 };
    const working = priced(item);
    expect(firstRefusal(working, item, { mayPrice: true, lang: 'it' })).toBeNull();
    const built = buildSave({ working, item, kind: 'ingredient', lang: 'it', startSupplierId: working.supplierId, mayPrice: true });
    for (const key of ['unit', 'packUnit', 'packCount']) expect(built.payload).not.toHaveProperty(key);
    expect(built.unitChangedFrom).toBe('');
  });

  test('an untouched carton with no count is not refused, but a price typed under it is (C85)', () => {
    const item: ItemLike = { id: 'x', name: 'x', unit: 'cartone', packUnit: 'busta', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };
    const working = priced(item);
    expect(working).toMatchObject({ format: 'carton', count: '' });
    expect(firstRefusal(working, item, { mayPrice: true, lang: 'it' })).toBeNull();
    expect(firstRefusal(working, item, { mayPrice: true, lang: 'it', priceDirty: true })).toBe('count');
    const noWord = { ...working, count: '3', inner: { choice: '', typed: '' } };
    expect(firstRefusal(noWord, item, { mayPrice: true, lang: 'it', priceDirty: true })).toBe('innerEmpty');
    expect(firstRefusal(noWord, item, { mayPrice: true, lang: 'it' })).toBe('innerEmpty');
  });

  test('a Single is never refused for its count or its inner word, whatever the price did', () => {
    const working = open(FLOUR);
    expect(firstRefusal(working, FLOUR, { mayPrice: true, lang: 'en', priceDirty: true })).toBeNull();
  });
});

describe('what a typed price writes beside the price (parity C54, C55)', () => {
  const priceFor = (priceUnit: string, pricePerUnit: number | null) => ({ priceUnit, pricePerUnit });
  const saveWith = (
    working: Working, item: ItemLike | null,
    extra: { priceDirty?: boolean; pricePatch?: { priceUnit: unknown; pricePerUnit: unknown } | null }, lang = 'it',
  ) => buildSave({ working, item, kind: 'ingredient', lang, startSupplierId: SUPPLIERS[0] as string, mayPrice: true, ...extra });

  test('a price typed under a Case writes packCount and the inner word even though the format was not moved — and NEVER the order unit', () => {
    const item: ItemLike = { id: 'x', name: 'x', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
    const working = workingFrom(item, { supplierIds: SUPPLIERS, preset: null, mayPrice: true, lang: 'it' });
    const built = saveWith(working, item, { priceDirty: true });
    expect(built.payload).toMatchObject({ packCount: 4, packUnit: 'busta' });
    expect(built.payload).not.toHaveProperty('unit');
    expect(built.unitChangedFrom).toBe('');
    // with the price clean the same card writes nothing of it
    expect(saveWith(working, item, {}).payload).not.toHaveProperty('packCount');
    // and the dirty price of a Single adds nothing
    const sack = { ...item, packCount: null, unit: 'sacco' };
    const single = workingFrom(sack, { supplierIds: SUPPLIERS, preset: null, mayPrice: true, lang: 'it' });
    expect(saveWith(single, sack, { priceDirty: true }).payload).not.toHaveProperty('packCount');
  });

  test('a NEW Single with no readable weight priced by the kilo / litre / piece gets the venue\'s word as its order unit', () => {
    const working = { ...chosen(null), name: 'Zucchine' };
    for (const [priceUnit, word] of [['kg', 'kg'], ['l', 'l'], ['pcs', 'pz']] as const) {
      expect(saveWith(working, null, { pricePatch: priceFor(priceUnit, 3) }).payload.unit, priceUnit).toBe(word);
    }
    expect(saveWith(working, null, { pricePatch: priceFor('pcs', 3) }, 'en').payload.unit).toBe('pcs');
  });

  test('…but not with a weight that reads, a Case, no price, or an existing item', () => {
    const named = { ...chosen(null), name: 'Farina' };
    expect(saveWith({ ...named, weight: { amount: '25', unit: 'kg', legacy: '' } }, null, { pricePatch: priceFor('pcs', 20) }).payload.unit).toBe('');
    expect(saveWith(withFormat(named, 'carton', 'it'), null, { pricePatch: priceFor('kg', 3) }).payload.unit).toBe('cartone');
    expect(saveWith(named, null, { pricePatch: priceFor('kg', null) }).payload.unit).toBe('');
    expect(saveWith(named, null, {}).payload.unit).toBe('');
    expect(saveWith(open(FLOUR), FLOUR, { pricePatch: priceFor('kg', 3) }).payload).not.toHaveProperty('unit');
  });
});

describe('the order the VAT line prices, and the leave question (parity C78, C65)', () => {
  const item: ItemLike = { id: 'x', name: 'x', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
  const working = workingFrom(item, { supplierIds: SUPPLIERS, preset: null, mayPrice: true, lang: 'it' });

  test('orderNow is what the card would SAVE: the stored order untouched, the new one once the format moved', () => {
    expect(orderNow(working, item, { mayPrice: true, lang: 'it' })).toEqual({ unit: 'cartone', weight: '2.5 kg', packUnit: 'busta', packCount: 4 });
    expect(orderNow(withFormat(working, 'single', 'it'), item, { mayPrice: true, lang: 'it' }))
      .toEqual({ unit: 'busta', weight: '2.5 kg', packUnit: 'busta', packCount: null });
    expect(orderNow(typed(working, { count: '6' }), item, { mayPrice: true, lang: 'it' })).toMatchObject({ packCount: 6, unit: 'cartone' });
  });

  test('a new item starts with an empty order unit and no count', () => {
    expect(orderNow(open(null), null)).toEqual({ unit: '', weight: '', packUnit: '', packCount: null });
  });

  test('the price counts as part of the card for the leave question: its own edit makes the card dirty', () => {
    expect(isDirty(working, working)).toBe(false);
    expect(isDirty(working, working, false)).toBe(false);
    expect(isDirty(working, working, true)).toBe(true);
  });
});

// ── «Che confezione è?» (Mise 2 only): the package word of a single pack ──────────────────────────────────────────────
describe('the package type (pack-type.ts) in the card model', () => {
  const priceFor = (priceUnit: string, pricePerUnit: number | null) => ({ priceUnit, pricePerUnit });
  const withType = (working: Working, choice: string, typedWord = ''): Working => withPackType(working, { choice, typed: typedWord });
  const saveAs = (
    working: Working, item: ItemLike | null,
    extra: { mayPrice?: boolean; priceDirty?: boolean; pricePatch?: { priceUnit: unknown; pricePerUnit: unknown } | null } = {}, lang = 'it',
  ) => buildSave({ working, item, kind: 'ingredient', lang, startSupplierId: SUPPLIERS[0] as string, ...extra });
  const openPriced = (item: ItemLike, lang = 'it') => workingFrom(item, { supplierIds: SUPPLIERS, preset: null, mayPrice: true, lang });
  const CASE_OF_4: ItemLike = {
    id: 'c', name: 'Rice', weight: '5kg', unit: '', priceUnit: 'kg', pricePerUnit: 5, casePrice: 100, caseCount: 4, caseItemUnit: 'pack', caseItemSize: 5,
  };

  test('a new packaged single with a type writes unit and packUnit, both', () => {
    const working = withType(chosen(null), 'bottiglia');
    const built = saveAs(working, null);
    expect(built.payload).toMatchObject({ unit: 'bottiglia', packUnit: 'bottiglia' });
    expect(built.payload).not.toHaveProperty('packCount');
    expect(built.unitChangedFrom).toBe('');
  });

  test('a typed word is trimmed, and a new word through «+ New…» is the typed one', () => {
    const built = saveAs(withType(chosen(null), NEW_CHOICE, '  damigiana '), null);
    expect(built.payload).toMatchObject({ unit: 'damigiana', packUnit: 'damigiana' });
  });

  test('a new item with no type chosen writes neither key beyond the empty unit', () => {
    const built = saveAs(chosen(null), null);
    expect(built.payload.unit).toBe('');
    expect(built.payload).not.toHaveProperty('packUnit');
  });

  test('a NEW loose item (priced by the kilo, no weight) gets its kilo unit and the menu is not drawn, so a chosen type writes nothing', () => {
    const working = withType(chosen(null), 'bottiglia');
    const options = { pricePatch: priceFor('kg', 4) };
    expect(packTypeVisible(working, null, options)).toBe(false);
    const built = saveAs(working, null, options);
    expect(built.payload.unit).toBe('kg');
    expect(built.payload).not.toHaveProperty('packUnit');
  });

  test('a NEW item priced by the kilo WITH a readable weight is packaged: the menu is drawn and the type is written', () => {
    const working = withType(typed(chosen(null), { weight: { amount: '5', unit: 'kg', legacy: '' } }), 'secchiello');
    const options = { pricePatch: priceFor('kg', 4) };
    expect(packTypeVisible(working, null, options)).toBe(true);
    expect(saveAs(working, null, options).payload).toMatchObject({ unit: 'secchiello', packUnit: 'secchiello' });
  });

  test('the menu is for a Single only', () => {
    expect(packTypeVisible(chosen(null), null)).toBe(true);
    expect(packTypeVisible(open(null), null)).toBe(false);
    expect(packTypeVisible(withFormat(open(null), 'carton', 'en'), null)).toBe(false);
    const carton = typed(withFormat(open(null), 'carton', 'en'), { count: '4' });
    expect(saveAs(withType(carton, 'bottiglia'), null).payload).not.toHaveProperty('packUnit', 'bottiglia');
  });

  test('a type picked and then a Case chosen writes no type', () => {
    const working = typed(withType(chosen(null), 'bottiglia'), { count: '6' });
    const built = saveAs(withFormat(working, 'carton', 'it'), null);
    expect(built.payload).toMatchObject({ unit: 'cartone', packCount: 6, packUnit: 'busta' });
  });

  test('a rename of the type writes both keys and freezes no line (unitChangedFrom is computed without the type keys)', () => {
    const item: ItemLike = { id: 't', name: 'Cream', unit: 'busta', packUnit: 'busta' };
    const built = saveAs(withType(open(item), 'bottiglia'), item);
    expect(built.payload).toMatchObject({ unit: 'bottiglia', packUnit: 'bottiglia' });
    expect(built.unitChangedFrom).toBe('');
  });

  test('⚠️ an employee may rename a type, but cannot add or take one away', () => {
    const untyped: ItemLike = { id: 'u', name: 'Cream', unit: '', weight: '1l' };
    expect(packTypeVisible(open(untyped), untyped)).toBe(false);
    expect(saveAs(withType(open(untyped), 'bottiglia'), untyped).payload).not.toHaveProperty('packUnit');
    const typedItem: ItemLike = { id: 't', name: 'Cream', unit: 'busta', packUnit: 'busta' };
    expect(packTypeVisible(open(typedItem), typedItem)).toBe(true);
    expect(saveAs(withType(open(typedItem), ''), typedItem).payload).not.toHaveProperty('packUnit');
    expect(saveAs(withType(open(typedItem), ''), typedItem).payload).not.toHaveProperty('unit');
  });

  test('a price writer may add and clear a type on an item with no stored case of more than one', () => {
    const plain: ItemLike = { id: 'p', name: 'Cream', unit: '', weight: '1l', priceUnit: 'l', pricePerUnit: 3 };
    expect(saveAs(withType(openPriced(plain), 'bottiglia'), plain, { mayPrice: true }).payload).toMatchObject({ unit: 'bottiglia', packUnit: 'bottiglia' });
    const typedItem: ItemLike = { ...plain, unit: 'bottiglia', packUnit: 'bottiglia' };
    expect(saveAs(withType(openPriced(typedItem), ''), typedItem, { mayPrice: true }).payload).toMatchObject({ unit: '', packUnit: '' });
  });

  test('⚠️ on a stored case of 4 nothing is added or cleared (the money would move); a rename still goes', () => {
    expect(packTypeVisible(openPriced(CASE_OF_4), CASE_OF_4, { mayPrice: true })).toBe(false);
    const added = saveAs(withType(openPriced(CASE_OF_4), 'bottiglia'), CASE_OF_4, { mayPrice: true }).payload;
    expect(added).not.toHaveProperty('packUnit');
    expect(added).not.toHaveProperty('unit');
    const typedCase: ItemLike = { ...CASE_OF_4, unit: 'busta', packUnit: 'busta' };
    expect(saveAs(withType(openPriced(typedCase), ''), typedCase, { mayPrice: true }).payload).not.toHaveProperty('packUnit');
    expect(saveAs(withType(openPriced(typedCase), 'secchiello'), typedCase, { mayPrice: true }).payload)
      .toMatchObject({ unit: 'secchiello', packUnit: 'secchiello' });
  });

  test('an item that already offers a unit choice is left alone', () => {
    const item: ItemLike = { id: 'h', name: 'Oil', unit: 'cartone', packUnit: 'bottiglia', weight: '1l' };
    expect(packTypeVisible(open(item), item)).toBe(false);
  });

  test('an item ordered in kilos has no menu', () => {
    expect(packTypeVisible(open(FLOUR), FLOUR)).toBe(false);
    expect(packTypeVisible(openPriced(FLOUR), FLOUR, { mayPrice: true })).toBe(false);
  });

  test('untouched existing cards write no unit and no packUnit key, typed or not', () => {
    const typedItem: ItemLike = { id: 't', name: 'Cream', unit: 'bottiglia', packUnit: 'bottiglia' };
    for (const item of [typedItem, FLOUR]) {
      const payload = saveAs(open(item), item).payload;
      expect(payload).not.toHaveProperty('unit');
      expect(payload).not.toHaveProperty('packUnit');
    }
  });

  test('⚠️ a Case turned into a Single AND renamed: the line is still frozen in the carton word', () => {
    const item: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: 'case' };
    const working = withType(withFormat(open(item), 'single', 'en'), 'bottle');
    const built = saveAs(working, item, {}, 'en');
    expect(built.payload).toMatchObject({ packCount: null, unit: 'bottle', packUnit: 'bottle' });
    expect(built.unitChangedFrom).toBe('case');
  });

  test('the menu opens on the type the card would save, also after the format moved', () => {
    const item: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'bag', unit: 'case' };
    const single = withFormat(open(item), 'single', 'en');
    expect(packTypeVisible(single, item)).toBe(true);
    expect(packTypeChoiceOf(single, item)).toEqual({ choice: 'bag', typed: '' });
  });

  test('the type is part of what counts as a change; picking the same one again is not', () => {
    const item: ItemLike = { id: 't', name: 'Cream', unit: 'busta', packUnit: 'busta' };
    const base = open(item);
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty(withType(base, 'bottiglia'), base)).toBe(true);
    expect(isDirty(withType(base, 'busta'), base)).toBe(false);
  });

  test('the refusals: a «+ New…» box left empty, then a word that is a unit', () => {
    const named = (working: Working): Working => typed(working, { name: 'Cream' });
    const working = named(withType(chosen(null), NEW_CHOICE, '  '));
    expect(firstRefusal(working, null, { packTypeShown: true })).toBe('packType');
    expect(firstRefusal(named(withType(chosen(null), NEW_CHOICE, 'kg')), null, { packTypeShown: true })).toBe('packTypeWord');
    expect(firstRefusal(named(withType(chosen(null), NEW_CHOICE, 'Pezzi')), null, { packTypeShown: true })).toBe('packTypeWord');
    expect(firstRefusal(named(withType(chosen(null), NEW_CHOICE, 'damigiana')), null, { packTypeShown: true })).toBeNull();
    // Not drawn, or not touched: never refused.
    expect(firstRefusal(working, null)).toBeNull();
    expect(firstRefusal(named(chosen(null)), null, { packTypeShown: true })).toBeNull();
  });

  test('a type word is cut at the 40 characters the rules allow', () => {
    const built = saveAs(withType(chosen(null), NEW_CHOICE, 'x'.repeat(60)), null);
    expect(String(built.payload.packUnit)).toHaveLength(40);
    expect(String(built.payload.unit)).toHaveLength(40);
  });

  test('a rename tells the store which word to reset; nothing else does', () => {
    const item: ItemLike = { id: 't', name: 'Cream', unit: 'busta', packUnit: 'busta' };
    expect(saveAs(withType(open(item), 'secchiello'), item).typeRenamedFrom).toBe('busta');
    expect(saveAs(withType(open(item), 'BUSTA'), item).typeRenamedFrom).toBe('');
    expect(saveAs(open(item), item).typeRenamedFrom).toBe('');
    expect(saveAs(withType(chosen(null), 'bottiglia'), null).typeRenamedFrom).toBe('');
    // Cartone → Single then renamed: the old word is the package the carton had.
    const carton: ItemLike = { id: 'x', name: 'x', packCount: 4, packUnit: 'busta', unit: 'cartone' };
    expect(saveAs(withType(withFormat(open(carton), 'single', 'it'), 'secchiello'), carton).typeRenamedFrom).toBe('busta');
  });

  test('a type picked on a new item and then made loose by a per-kilo price is dropped at Save: nothing is written for it', () => {
    const working = withType(chosen(null), 'bottiglia');
    const built = saveAs(working, null, { pricePatch: priceFor('kg', 4) });
    expect(built.payload.unit).toBe('kg');
    expect(built.payload).not.toHaveProperty('packUnit');
    expect(built.typeRenamedFrom).toBe('');
  });

  describe('⚠️ the card must not flip to the card of before (typeMayRewrite on the fields that will be saved)', () => {
    // A carton of 1 whose price is a pieces case of one and whose piece IS the item: with an empty unit that case is a legacy shape.
    const PIECES_CARTON: ItemLike = {
      id: 'pc', name: 'Eggs', weight: '60 g', packCount: 1, unit: 'cartone', packUnit: 'uovo',
      priceUnit: 'pcs', pricePerUnit: 0.3, casePrice: 0.3, caseCount: 1, caseItemUnit: 'pcs', unitWeightKg: 0.06,
    };
    const single = () => withFormat(openPriced(PIECES_CARTON), 'single', 'it');

    test('the saved shape without a type would be legacy: the guard refuses (a deleted legacy line makes this fail)', () => {
      expect(typeGuardOf(single(), PIECES_CARTON, { mayPrice: true, lang: 'it' }).mayRewrite).toBe(false);
    });

    test('Cartone → Single → «— none —» writes no empty unit: it would reopen on the card of before', () => {
      const cleared = saveAs(withType(single(), ''), PIECES_CARTON, { mayPrice: true });
      expect(cleared.payload).toMatchObject({ packCount: null, unit: 'uovo' });
    });

    test('a rename still goes', () => {
      const renamed = saveAs(withType(single(), 'barattolo'), PIECES_CARTON, { mayPrice: true }).payload;
      expect(renamed).toMatchObject({ unit: 'barattolo', packUnit: 'barattolo' });
    });
  });

  test('⚠️ Cartone → Single with no package word, over a stored case of more than one: a type cannot be added', () => {
    const carton: ItemLike = { ...CASE_OF_4, packCount: 4, unit: 'cartone', packUnit: '' };
    const toSingle = withFormat(openPriced(carton), 'single', 'it');
    expect(packTypeVisible(toSingle, carton, { mayPrice: true, lang: 'it' })).toBe(false);
    const built = saveAs(withType(toSingle, 'bottiglia'), carton, { mayPrice: true });
    expect(built.payload).not.toHaveProperty('packUnit', 'bottiglia');
    expect(built.payload.unit).not.toBe('bottiglia');
  });

  test('the VAT line prices the order as before: the type is not part of orderNow', () => {
    const working = withType(chosen(null), 'bottiglia');
    expect(orderNow(working, null)).toEqual({ unit: '', weight: '', packUnit: '', packCount: null });
  });
});
