// Tests for «Che confezione è?» (Mise 2 only: no original to compare with).
//
// ⚠️ THE GUARD GRID at the end is the one that matters: choosing, renaming or clearing a type must never change what a line
// costs, how many items an ordered unit holds, what a stocktake is worth or how the card reads the item.
import { describe, expect, test } from 'vitest';
import { hasUnitChoice, lineUnit } from './order-unit';
import { itemsPerOrderedUnit, lineUnitCost, unitCost } from './order-cost';
import { formatOf, usesLegacyCard } from './pack-format';
import { storedCaseOf } from './price-model';
import { packPrice, valueBlocker } from './inventory-value';
import {
  PACK_TYPE_MAX, isPackTypeWord, linePackWord, packTypeOf, packTypePatch, packTypeShown, qtyWithPack, shownQty,
} from './pack-type';

describe('isPackTypeWord', () => {
  test('a package word is one', () => {
    for (const word of ['bottiglia', 'secchiello', 'latta', 'bucket', 'damigiana', 'Busta', ' sacco ']) expect(isPackTypeWord(word), word).toBe(true);
  });

  test('a weight, volume, piece or carton word is not', () => {
    for (const word of ['kg', 'KG', 'g', 'gr', 'l', 'lt', 'litri', 'ml', 'cl', 'pz', 'pcs', 'pezzi', 'each', 'cartone', 'case', 'cassa', 'crate', 'kg.']) {
      expect(isPackTypeWord(word), word).toBe(false);
    }
  });

  test('nothing is not', () => {
    for (const word of ['', '   ', null, undefined, 4]) expect(isPackTypeWord(word)).toBe(false);
  });
});

describe('packTypeOf', () => {
  test('unit and packUnit the same package word, no packCount: the type', () => {
    expect(packTypeOf({ unit: 'bottiglia', packUnit: 'bottiglia' })).toBe('bottiglia');
    expect(packTypeOf({ unit: 'Busta', packUnit: ' busta ' })).toBe('busta');
  });

  test('every other shape has none', () => {
    expect(packTypeOf({ unit: '', packUnit: 'bottiglia' })).toBe('');
    expect(packTypeOf({ unit: 'bottiglia', packUnit: '' })).toBe('');
    expect(packTypeOf({ unit: 'cartone', packUnit: 'bottiglia' })).toBe('');
    expect(packTypeOf({ unit: 'kg', packUnit: 'kg' })).toBe('');
    expect(packTypeOf({ unit: 'cartone', packUnit: 'cartone' })).toBe('');
    expect(packTypeOf({ unit: 'bottiglia', packUnit: 'bottiglia', packCount: 6 })).toBe('');
    expect(packTypeOf({})).toBe('');
    expect(packTypeOf(null)).toBe('');
    expect(packTypeOf('bottiglia')).toBe('');
    expect(packTypeOf({ unit: 4, packUnit: 4 })).toBe('');
  });

  test('a packCount that is not a valid count does not count as a carton', () => {
    expect(packTypeOf({ unit: 'bottiglia', packUnit: 'bottiglia', packCount: 0 })).toBe('bottiglia');
    expect(packTypeOf({ unit: 'bottiglia', packUnit: 'bottiglia', packCount: '6' })).toBe('bottiglia');
  });
});

describe('packTypeShown', () => {
  const free = { mayRewrite: true };
  const held = { mayRewrite: false };

  test('never for a carton or over an existing unit choice', () => {
    expect(packTypeShown({ unit: 'cartone', packUnit: 'busta' }, free)).toBe(false);
    expect(packTypeShown({ unit: '', packUnit: '', packCount: 4 }, free)).toBe(false);
    expect(packTypeShown({ unit: 'bottiglia', packUnit: 'bottiglia', packCount: 4 }, free)).toBe(false);
  });

  test('an item that has a type always shows it, even when it may not be rewritten', () => {
    expect(packTypeShown({ unit: 'bottiglia', packUnit: 'bottiglia' }, held)).toBe(true);
  });

  test('an item without a type shows it only when it may be rewritten, and its unit is empty or a package word', () => {
    expect(packTypeShown({ unit: '', packUnit: '' }, free)).toBe(true);
    expect(packTypeShown({}, free)).toBe(true);
    expect(packTypeShown({ unit: 'sacco' }, free)).toBe(true);
    expect(packTypeShown({ unit: '', packUnit: '' }, held)).toBe(false);
    expect(packTypeShown({ unit: 'kg' }, free)).toBe(false);
    expect(packTypeShown({ unit: 'pz' }, free)).toBe(false);
    expect(packTypeShown({ unit: 'cartone' }, free)).toBe(false);
  });
});

describe('packTypePatch', () => {
  const free = { mayRewrite: true };
  const held = { mayRewrite: false };

  test('choosing a type writes BOTH keys, never one', () => {
    expect(packTypePatch({ unit: '', packUnit: '' }, 'bottiglia', free)).toStrictEqual({ unit: 'bottiglia', packUnit: 'bottiglia' });
    expect(packTypePatch({}, ' secchiello ', free)).toStrictEqual({ unit: 'secchiello', packUnit: 'secchiello' });
    expect(packTypePatch({ unit: 'sacco' }, 'latta', free)).toStrictEqual({ unit: 'latta', packUnit: 'latta' });
  });

  test('a rename is always allowed', () => {
    const typed = { unit: 'busta', packUnit: 'busta' };
    expect(packTypePatch(typed, 'bottiglia', held)).toStrictEqual({ unit: 'bottiglia', packUnit: 'bottiglia' });
  });

  test('clearing the type is allowed only when it may be rewritten', () => {
    const typed = { unit: 'busta', packUnit: 'busta' };
    expect(packTypePatch(typed, '', free)).toStrictEqual({ unit: '', packUnit: '' });
    expect(packTypePatch(typed, '', held)).toStrictEqual({});
  });

  test('no type to a type, held: nothing', () => {
    expect(packTypePatch({ unit: '', packUnit: '' }, 'bottiglia', held)).toStrictEqual({});
  });

  test('the same word (in any case) or nothing to nothing: no change', () => {
    expect(packTypePatch({ unit: 'busta', packUnit: 'busta' }, 'BUSTA', free)).toStrictEqual({});
    expect(packTypePatch({ unit: '', packUnit: '' }, '', free)).toStrictEqual({});
    expect(packTypePatch({}, '   ', free)).toStrictEqual({});
  });

  test('a word that is a unit is refused: nothing is written', () => {
    for (const word of ['kg', 'pz', 'cartone', 'litri']) expect(packTypePatch({}, word, free), word).toStrictEqual({});
    expect(packTypePatch({ unit: 'busta', packUnit: 'busta' }, 'kg', free)).toStrictEqual({});
  });

  test('where the menu is not drawn nothing is written', () => {
    expect(packTypePatch({ unit: 'kg' }, 'bottiglia', free)).toStrictEqual({});
    expect(packTypePatch({ unit: 'cartone', packUnit: 'busta' }, 'bottiglia', free)).toStrictEqual({});
    expect(packTypePatch({ packCount: 4, unit: 'cartone' }, 'bottiglia', free)).toStrictEqual({});
  });

  test('a long word is cut at the 40 characters the rules allow', () => {
    const patch = packTypePatch({}, 'x'.repeat(60), free);
    expect(patch.unit).toHaveLength(PACK_TYPE_MAX);
    expect(patch.packUnit).toHaveLength(PACK_TYPE_MAX);
  });
});

describe('linePackWord', () => {
  const typed = { unit: 'bottiglia', packUnit: 'bottiglia' };

  test('the card’s type when the line shows no unit of its own', () => {
    expect(linePackWord(typed, { qty: 2 })).toBe('bottiglia');
    expect(linePackWord(typed, undefined)).toBe('bottiglia');
    expect(linePackWord(typed, { qty: 2, unit: 'Bottiglia' })).toBe('bottiglia');
  });

  test('nothing when the line carries a unit (a frozen different unit)', () => {
    expect(linePackWord(typed, { qty: 2, unit: 'cartone' })).toBe('');
    expect(lineUnit(typed, { qty: 2, unit: 'cartone' })).toBe('cartone');
  });

  test('nothing for a card without a type', () => {
    expect(linePackWord({ unit: 'kg' }, { qty: 2 })).toBe('');
    expect(linePackWord({ unit: 'cartone', packUnit: 'busta' }, { qty: 2 })).toBe('');
  });
});

describe('qtyWithPack and shownQty', () => {
  test('the plural for a known word, the singular for one', () => {
    expect(qtyWithPack(2, 'bottiglia', 'it')).toBe('2 bottiglie');
    expect(qtyWithPack(1, 'secchiello', 'it')).toBe('1 secchiello');
    expect(qtyWithPack(3, 'bottle', 'en')).toBe('3 bottles');
  });

  test('an unknown word reads «2 × word»', () => {
    expect(qtyWithPack(2, 'damigiana', 'it')).toBe('2 × damigiana');
    expect(qtyWithPack(2, 'constructor', 'it')).toBe('2 × constructor');
    expect(qtyWithPack(1, 'constructor', 'it')).toBe('1 × constructor');
  });

  test('no word, just the number', () => {
    expect(qtyWithPack(2, '', 'it')).toBe('2');
    expect(qtyWithPack(2, undefined, 'it')).toBe('2');
  });

  test('shownQty: a unit of its own, else the card’s type, else the number', () => {
    const typed = { unit: 'bottiglia', packUnit: 'bottiglia' };
    expect(shownQty(2, 'cartone', typed, 'it')).toBe('2 × cartone');
    expect(shownQty(2, '', typed, 'it')).toBe('2 bottiglie');
    expect(shownQty(2, undefined, typed, 'it')).toBe('2 bottiglie');
    expect(shownQty(2, '', { unit: 'kg' }, 'it')).toBe('2');
    expect(shownQty(2, '', undefined, 'it')).toBe('2');
  });
});

// ── THE GUARD GRID ─────────────────────────────────────────────────────────────────────────────────────────────
// Every price shape × every unit the item may have × every word a person may pick. The patch is applied with the guard the
// card uses (`mayRewrite` = no stored case of more than one), and nothing the readers compute may differ before and after.
describe('⚠️ the guard grid: a type never changes money, a count or how the card reads the item', () => {
  const month = { id: 'm' };
  const base = { id: 'i1', name: 'Item' };

  const prices: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['no price', { weight: '' }],
    ['kg rate on a 5kg pack', { weight: '5kg', priceUnit: 'kg', pricePerUnit: 5 }],
    ['kg rate, no weight', { weight: '', priceUnit: 'kg', pricePerUnit: 5 }],
    ['pcs rate', { weight: '1kg', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 1 }],
    ['pack case of 1', { weight: '5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 10, caseCount: 1, caseItemUnit: 'pack', caseItemSize: 5 }],
    ['pack case of 4', { weight: '5kg', priceUnit: 'kg', pricePerUnit: 5, casePrice: 100, caseCount: 4, caseItemUnit: 'pack', caseItemSize: 5 }],
    ['pcs case of 1', { weight: '1kg', priceUnit: 'pcs', pricePerUnit: 3, unitWeightKg: 1, casePrice: 3, caseCount: 1, caseItemUnit: 'pcs' }],
    ['pcs case of 30', { weight: '1kg', priceUnit: 'pcs', pricePerUnit: 1, unitWeightKg: 1, casePrice: 30, caseCount: 30, caseItemUnit: 'pcs' }],
    ['explicit kg case of 4', { weight: '', priceUnit: 'kg', pricePerUnit: 5, casePrice: 50, caseCount: 4, caseItemUnit: 'kg', caseItemSize: 2.5 }],
  ];
  const units: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['no unit', { unit: '', packUnit: '' }],
    ['unit sacco', { unit: 'sacco', packUnit: '' }],
    ['typed busta', { unit: 'busta', packUnit: 'busta' }],
  ];
  const words = ['', 'bottiglia', 'secchiello', 'latta', 'busta', 'Sacco'];

  test('the price fixtures really are stored cases where they say so', () => {
    const cases = prices.filter(([name]) => name.includes('case')).map(([, price]) => storedCaseOf(price)?.caseCount);
    expect(cases).toStrictEqual([1, 4, 1, 30, 4]);
  });

  let applied = 0;
  let changed = 0;
  for (const [priceName, price] of prices) {
    for (const [unitName, unit] of units) {
      for (const word of words) {
        test(`${priceName} · ${unitName} · «${word}»`, () => {
          const before = { ...base, ...price, ...unit };
          // The card's own rule (ingredientCardModel typeMayRewrite): no stored case of more than one, and clearing a type must not
          // turn the item into one the card of before opens (a pieces case of one: '' there is a legacy shape).
          const mayRewrite = !((storedCaseOf(before)?.caseCount ?? 0) > 1) && !usesLegacyCard({ ...before, unit: '', packUnit: '' });
          const guard = { mayRewrite };
          const patch = packTypePatch(before, word, guard);
          const after = { ...before, ...patch };
          applied += 1;
          if (Object.keys(patch).length > 0) changed += 1;

          // Both keys or none, and never a unit choice.
          expect(Object.keys(patch).sort()).toStrictEqual(Object.keys(patch).length ? ['packUnit', 'unit'] : []);
          expect(hasUnitChoice(after)).toBe(false);
          // The money.
          expect(unitCost(after, after), 'unitCost').toBe(unitCost(before, before));
          expect(lineUnitCost(after, after, ''), 'lineUnitCost').toBe(lineUnitCost(before, before, ''));
          expect(itemsPerOrderedUnit(after)).toBe(itemsPerOrderedUnit(before));
          // The stocktake.
          expect(packPrice(month, after), 'packPrice').toBe(packPrice(month, before));
          expect(valueBlocker(month, after), 'valueBlocker').toBe(valueBlocker(month, before));
          // The card.
          expect(formatOf(after, after).kind).toBe(formatOf(before, before).kind);
          if (packTypeOf(after) !== '') expect(formatOf(after, after).kind).toBe('single');
          // A price writer's card decides ONCE at open whether it is the card of before (a legacy price shape); that card has no
          // type menu, so for them only an item that opens on the new card can be changed here. The card cannot flip on reopening.
          if (!(mayRewrite && usesLegacyCard(before))) expect(usesLegacyCard(after)).toBe(usesLegacyCard(before));
          // A line keeps showing no unit of its own.
          expect(lineUnit(after, { qty: 2 })).toBe('');
        });
      }
    }
  }

  test('the grid really applied patches (it is not all no-ops)', () => {
    expect(applied).toBe(prices.length * units.length * words.length);
    expect(changed).toBeGreaterThan(40);
  });

  test('WITHOUT the guard, a type on a stored case of 4 DOES change the money (why the guard exists)', () => {
    const before = { ...base, ...prices[5]![1], unit: '', packUnit: '' };
    const after = { ...before, unit: 'bottiglia', packUnit: 'bottiglia' };
    expect(unitCost(before, before)).not.toBe(unitCost(after, after));
    expect(packTypePatch(before, 'bottiglia', { mayRewrite: false })).toStrictEqual({});
    expect(packTypePatch(before, 'bottiglia', { mayRewrite: true })).not.toStrictEqual({});
  });

  test('a rename on a stored case of 4 is allowed and changes nothing', () => {
    const before = { ...base, ...prices[5]![1], unit: 'busta', packUnit: 'busta' };
    const patch = packTypePatch(before, 'secchiello', { mayRewrite: false });
    expect(patch).toStrictEqual({ unit: 'secchiello', packUnit: 'secchiello' });
    const after = { ...before, ...patch };
    expect(unitCost(after, after)).toBe(unitCost(before, before));
  });
});
