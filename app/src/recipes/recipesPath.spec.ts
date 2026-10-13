import { describe, expect, it } from 'vitest';
import { RECIPES_PATH, parseRecipesPath, recipePath, resolveRecipesPath } from './recipesPath';

describe('the addresses of the Recipe catalogue', () => {
  it('has the list at /recipes and a recipe at /recipes/<id>', () => {
    expect(RECIPES_PATH).toBe('/recipes');
    expect(parseRecipesPath('')).toEqual({ kind: 'list' });
    expect(parseRecipesPath(undefined)).toEqual({ kind: 'list' });
    expect(parseRecipesPath('/')).toEqual({ kind: 'list' });
    expect(parseRecipesPath('/abc123')).toEqual({ kind: 'recipe', id: 'abc123' });
  });

  it('writes an id whole and reads it back whole: a slash, a space and a percent sign survive', () => {
    for (const id of ['a/b c', '100%', 'é', 'x?y#z']) {
      const path = recipePath(id);
      expect(path.startsWith('/recipes/')).toBe(true);
      expect(parseRecipesPath(path.slice(RECIPES_PATH.length))).toEqual({ kind: 'recipe', id });
    }
  });

  it('takes an address that is not valid percent-encoding, or has more to it, for an unknown one', () => {
    expect(parseRecipesPath('/%')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/%E0%A4%A')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/edit')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/def/ghi')).toEqual({ kind: 'unknown' });
  });

  // The words a later step will take as its own: a recipe's id is never one of them (a Firestore auto
  // id has 20 characters), so they are not looked up as recipes that do not exist.
  it.each(['new', 'allergens', 'settings', 'photo'])('keeps «%s» for a later step, never reading it as a recipe', word => {
    expect(parseRecipesPath(`/${word}`)).toEqual({ kind: 'unknown' });
  });

  it('sends an unknown address back to the list, and draws a known one', () => {
    expect(resolveRecipesPath('/abc/edit')).toEqual({ redirect: '/recipes' });
    expect(resolveRecipesPath('/abc')).toEqual({ view: { kind: 'recipe', id: 'abc' } });
    expect(resolveRecipesPath('')).toEqual({ view: { kind: 'list' } });
  });
});
