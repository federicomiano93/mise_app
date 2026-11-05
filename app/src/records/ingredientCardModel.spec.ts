import { describe, expect, test } from 'vitest';
import {
  NEW_CHOICE, NO_SUPPLIER_ID, buildSave, firstRefusal, formState, isDirty, kindFor, readChoice, weightText, withFormat, withInner, workingFrom,
} from './ingredientCardModel';
import type { ItemLike, Working } from './ingredientCardModel';

// The ingredient card's working copy and its payload (parity C36–C57, C80–C81, C84–C87), with no screen in the way.

const SUPPLIERS = ['s-alp', 's-bru'];
const open = (item: ItemLike | null, preset: string | null = null) => workingFrom(item, { supplierIds: SUPPLIERS, preset });
const save = (working: Working, item: ItemLike | null, kind: 'ingredient' | 'packaging' = 'ingredient', lang = 'en') =>
  buildSave({ working, item, kind, lang, startSupplierId: workingFrom(item, { supplierIds: SUPPLIERS, preset: null }).supplierId });
const typed = (working: Working, change: Partial<Working>): Working => ({ ...working, ...change });

const FLOUR: ItemLike = { id: 'i-1', name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', unit: 'kg' };

describe('opening: the copy a card is made from', () => {
  test('a stored item shows every stored value', () => {
    expect(open(FLOUR)).toEqual({
      name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo',
      category: { choice: 'Bakery', typed: '' }, weight: { amount: '25', unit: 'kg', legacy: '' },
      format: 'single', count: '', inner: { choice: '', typed: '' }, innerAutoSet: false,
    });
  });

  test('a new item starts empty, on «No supplier», in kilos', () => {
    expect(open(null)).toEqual({
      name: '', shortName: '', supplierId: NO_SUPPLIER_ID, brand: '', category: { choice: '', typed: '' },
      weight: { amount: '', unit: 'kg', legacy: '' }, format: 'single', count: '', inner: { choice: '', typed: '' }, innerAutoSet: false,
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
    const working = open(null);
    expect(withFormat(working, 'single', 'en')).toBe(working);
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
      name: 'Flour 000', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', active: true, kind: 'ingredient',
    });
    expect(built.unitChangedFrom).toBe('');
    for (const key of ['unit', 'packCount', 'packUnit', 'pricePerUnit', 'priceUnit', 'vatRate', 'allergens', 'mayContain', 'allergensCheckedAt',
      'nutrition', 'packIngredients', 'invoiceName', 'supplierCode', 'supplierCodes']) {
      expect(key in built.payload, key).toBe(false);
    }
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

  test('a switched-off item stays switched off; an item with no flag is on', () => {
    const off: ItemLike = { id: 'x', name: 'x', active: false };
    expect(save(open(off), off).payload.active).toBe(false);
    expect(save(open({ id: 'x', name: 'x' }), { id: 'x', name: 'x' }).payload.active).toBe(true);
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
    const built = save(typed(open(null), { name: 'Salt' }), null);
    expect(built.payload).toEqual({
      name: 'Salt', shortName: '', supplierId: NO_SUPPLIER_ID, brand: '', weight: '', category: 'Other', unit: '', active: true, kind: 'ingredient',
    });
    expect(built.unitChangedFrom).toBe('');
  });

  test('a NEW packaging item is filed as packaging', () => {
    const built = save(typed(open(null, 's-bru'), { name: 'Box 30x40' }), null, 'packaging');
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
