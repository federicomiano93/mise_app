// Unit tests for the link between a recipe and its Food cost (P15 — the owner cannot read code, so these tests
// are the safety net), run against BOTH implementations: the TypeScript port in shared/ and js/recipe-link.js,
// which the live app uses today. Ported from tests/foodcost-from-recipe.test.mjs: the id-from-address tests and
// the two «who is shown the button» tests (the others read the screens' source or the Food cost model).
//
// recipe-link.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also builds the page
// addresses of the current app (`recipeHash`, `foodCostHref`, `recipeHref`, `ordersHref`,
// `catalogueOriginFromHash`). The last block of this file stands in for what pairing would have checked.
// The builders and `recipeIdParam` are new in Mise 2 and have no original: they are tested on their own.

import { describe, expect, test } from 'vitest';
import * as ported from './recipe-link';
import * as legacyJs from '../../js/recipe-link.js';

const legacy = legacyJs as unknown as typeof ported & { recipeHash: (id: unknown) => string };

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('anything that is not a usable id reads as no recipe at all', () => {
    for (const hash of ['', '#', '#recipe=', '#other=abc', '#recipe=a/b', `#recipe=${'x'.repeat(201)}`, null, undefined]) {
      expect(m.recipeIdFromHash(hash), String(hash)).toBe(null);
    }
  });

  test('an id is read from the address, with or without the #', () => {
    expect(m.recipeIdFromHash('#recipe=abc123')).toBe('abc123');
    expect(m.recipeIdFromHash('recipe=abc123')).toBe('abc123');
    expect(m.recipeIdFromHash('#recipe=a%20b%26c%3Dd')).toBe('a b&c=d');
    expect(m.recipeIdFromHash(`#recipe=${'x'.repeat(200)}`)).toBe('x'.repeat(200));
    expect(m.recipeIdFromHash('#recipe=%20abc%20'), 'trimmed').toBe('abc');
  });

  test('⚠️ the button is offered exactly to whoever the Food cost page lets in', () => {
    const venue = { sections: {} };
    expect(m.mayOpenFoodCost(venue, true), 'an owner or a manager').toBe(true);
    expect(m.mayOpenFoodCost(venue, false), 'an employee: the Food cost card is hidden from staff until the venue shows it').toBe(false);
    expect(m.mayOpenFoodCost({ sections: {}, staffShownCards: { foodcost: true } }, false),
      'an employee in a venue that chose to show them Food cost').toBe(true);
    expect(m.mayOpenFoodCost({ sections: { foodcost: false } }, true), 'nobody, in a venue that does not use Food cost at all').toBe(false);
  });

  test('⚠️ before a venue is open, nobody is shown it', () => {
    // allowedSections() alone would answer «allowed» for a document that is not there.
    for (const loc of [null, undefined, 'bakery']) {
      expect(m.mayOpenFoodCost(loc, true), String(loc)).toBe(false);
      expect(m.mayOpenOrders(loc, true), String(loc)).toBe(false);
    }
    expect(m.mayOpenFoodCost({ sections: {} }, 'true'), 'only a real true is a manager').toBe(false);
  });

  test('Orders is judged the same way, by its section and its card', () => {
    expect(m.mayOpenOrders({ sections: {} }, true)).toBe(true);
    expect(m.mayOpenOrders({ sections: { orders: false } }, true)).toBe(false);
    expect(m.mayOpenOrders({ sections: {} }, 'true')).toBe(m.mayOpenOrders({ sections: {} }, false));
  });
});

describe('the new builders and the parameter reader (Mise 2 only)', () => {
  test('a recipe\'s Food cost and its own address, with the id encoded', () => {
    expect(ported.foodCostForRecipePath('abc123')).toBe('/food-cost?recipe=abc123');
    expect(ported.recipeAddress('abc123')).toBe('/recipes/abc123');
    expect(ported.foodCostForRecipePath('a b%c')).toBe('/food-cost?recipe=a%20b%25c');
    expect(ported.recipeAddress('a b%c')).toBe('/recipes/a%20b%25c');
    expect(ported.foodCostForRecipePath('crème#1&x=2')).toBe(`/food-cost?recipe=${encodeURIComponent('crème#1&x=2')}`);
  });

  test('an id that cannot be a document id gives no address', () => {
    for (const bad of ['', '   ', 'a/b', 'x'.repeat(201), null, undefined]) {
      expect(ported.foodCostForRecipePath(bad), String(bad)).toBe(null);
      expect(ported.recipeAddress(bad), String(bad)).toBe(null);
    }
    expect(ported.foodCostForRecipePath('x'.repeat(200))).toBe(`/food-cost?recipe=${'x'.repeat(200)}`);
  });

  test('an id survives the trip, whatever it contains', () => {
    for (const id of ['abc123', 'a b&c=d', 'crème#1', '100%', 'x'.repeat(200)]) {
      const path = ported.foodCostForRecipePath(id) as string;
      expect(ported.recipeIdParam(path.slice(path.indexOf('?')), 'recipe'), id).toBe(id);
      expect(decodeURIComponent((ported.recipeAddress(id) as string).split('/')[2] as string), id).toBe(id);
    }
  });

  test('recipeIdParam reads one parameter, with or without ? or #, and cleans it', () => {
    expect(ported.recipeIdParam('?recipe=abc', 'recipe')).toBe('abc');
    expect(ported.recipeIdParam('#recipe=abc', 'recipe')).toBe('abc');
    expect(ported.recipeIdParam('recipe=abc', 'recipe')).toBe('abc');
    expect(ported.recipeIdParam('?x=1&recipe=a%2Fb', 'recipe'), 'a slash is refused').toBe(null);
    expect(ported.recipeIdParam('?other=abc', 'recipe')).toBe(null);
    expect(ported.recipeIdParam('?other=abc', 'other')).toBe('abc');
    expect(ported.recipeIdParam('?recipe=', 'recipe')).toBe(null);
    expect(ported.recipeIdParam('?recipe=%20%20', 'recipe')).toBe(null);
    expect(ported.recipeIdParam(`?recipe=${'x'.repeat(201)}`, 'recipe')).toBe(null);
    expect(ported.recipeIdParam('', 'recipe')).toBe(null);
    expect(ported.recipeIdParam(null, 'recipe')).toBe(null);
    expect(ported.recipeIdParam(undefined, 'recipe')).toBe(null);
  });

  test('the state the recipe screen hands Food cost is a fixed, frozen marker', () => {
    expect(ported.FROM_RECIPE_LINK).toStrictEqual({ fromRecipeLink: true });
    expect(Object.isFrozen(ported.FROM_RECIPE_LINK)).toBe(true);
  });
});

describe('the port against the original', () => {
  const LEFT_OUT = ['recipeHash', 'foodCostHref', 'recipeHref', 'ordersHref', 'catalogueOriginFromHash'];
  const ADDED = ['FROM_RECIPE_LINK', 'foodCostForRecipePath', 'recipeAddress', 'recipeIdParam'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared, ...ADDED].sort());
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      expect((port[name] as { name: string }).name, name).toBe((original[name] as { name: string }).name);
      expect((port[name] as { length: number }).length, `${name}: arity`).toBe((original[name] as { length: number }).length);
    }
  });
});
