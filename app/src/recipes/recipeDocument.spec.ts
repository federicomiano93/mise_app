import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { newRecipeData, recipeDataOf } from './recipeDocument';

const rules = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

// The keys the rules let a recipe document hold (firestore.rules, `match /recipes/{id}`, create and update).
function ruleKeys(): string[] {
  const block = /match \/recipes\/\{id\} \{[\s\S]*?keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/.exec(rules);
  expect(block).not.toBeNull();
  // The comments between the keys name fields too: they are dropped before the keys are read.
  const list = (block as RegExpExecArray)[1]!.replace(/\/\/[^\n]*/g, '');
  return [...list.matchAll(/'(\w+)'/g)].map(match => match[1]!);
}

describe('the recipe document a name alone makes', () => {
  test('⚠️ holds the name, an empty ingredient list and nothing else (a null is a removal, never stored)', () => {
    expect(newRecipeData('Crema pasticcera')).toEqual({ name: 'Crema pasticcera', ingredients: [] });
  });

  test('⚠️ every key is one the rules accept, so the batch is never refused for a key (the venue stamp is added by the source)', () => {
    const allowed = new Set(ruleKeys());
    expect(allowed.has('bakery')).toBe(true);
    for (const key of [...Object.keys(newRecipeData('Crema')), 'bakery']) expect(allowed.has(key), key).toBe(true);
  });

  test('it is exactly what the catalogue save sends for the same recipe, minus the nulls', () => {
    const full = recipeDataOf({ name: 'Crema', ingredients: [] }, []);
    expect(full).toEqual({ name: 'Crema', ingredients: [], netWeightG: null, shelfLifeDays: null });
    expect(newRecipeData('Crema')).toEqual({ name: 'Crema', ingredients: [] });
  });
});
