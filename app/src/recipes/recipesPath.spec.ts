import { describe, expect, it } from 'vitest';
import { ALLERGENS_PATH, NEW_PATH, PHOTO_PATH, RECIPES_PATH, SETTINGS_PATH, editPath, labelPath, mixPath, parseRecipesPath, recipePath, resolveRecipesPath, stepsPath } from './recipesPath';

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
    expect(parseRecipesPath('/abc/def/ghi')).toEqual({ kind: 'unknown' });
  });

  // The words a later step will take as its own: a recipe's id is never one of them (a Firestore auto
  // id has 20 characters), so they are not looked up as recipes that do not exist.
  it('has the Allergen sheet at /recipes/allergens, and nothing more under it', () => {
    expect(ALLERGENS_PATH).toBe('/recipes/allergens');
    expect(parseRecipesPath('/allergens')).toEqual({ kind: 'allergens' });
    expect(parseRecipesPath('/allergens/')).toEqual({ kind: 'allergens' });
    expect(parseRecipesPath('/allergens/x')).toEqual({ kind: 'unknown' });
    expect(resolveRecipesPath('/allergens')).toEqual({ view: { kind: 'allergens' } });
  });

  // The label (step 3d-3) is one level below its recipe: «label» after an id, and nothing else.
  it('has the label of a recipe at /recipes/<id>/label, the id written whole and read back whole', () => {
    expect(labelPath('abc')).toBe('/recipes/abc/label');
    expect(parseRecipesPath('/abc/label')).toEqual({ kind: 'label', id: 'abc' });
    expect(parseRecipesPath('/abc/label/')).toEqual({ kind: 'label', id: 'abc' });
    for (const id of ['a/b c', '100%', 'é', 'x?y#z']) {
      expect(parseRecipesPath(labelPath(id).slice(RECIPES_PATH.length))).toEqual({ kind: 'label', id });
    }
    expect(resolveRecipesPath('/abc/label')).toEqual({ view: { kind: 'label', id: 'abc' } });
  });

  it('keeps the reserved words and bad ids out of the label address', () => {
    for (const word of ['new', 'allergens', 'settings', 'photo']) {
      expect(parseRecipesPath(`/${word}/label`), word).toEqual({ kind: 'unknown' });
    }
    expect(parseRecipesPath('/%/label')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('//label')).toEqual({ kind: 'recipe', id: 'label' });
    expect(parseRecipesPath('/abc/label/x')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/labels')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/Label')).toEqual({ kind: 'unknown' });
  });

  it('reads «photo» as the photo screen, never as a recipe', () => {
    expect(PHOTO_PATH).toBe('/recipes/photo');
    expect(parseRecipesPath('/photo')).toEqual({ kind: 'photo' });
    expect(parseRecipesPath('/photo/')).toEqual({ kind: 'photo' });
    expect(parseRecipesPath('/photo/x')).toEqual({ kind: 'unknown' });
    expect(resolveRecipesPath('/photo')).toEqual({ view: { kind: 'photo' } });
  });

  it('sends an unknown address back to the list, and draws a known one', () => {
    expect(resolveRecipesPath('/abc/edits')).toEqual({ redirect: '/recipes' });
    expect(resolveRecipesPath('/abc')).toEqual({ view: { kind: 'recipe', id: 'abc' } });
    expect(resolveRecipesPath('')).toEqual({ view: { kind: 'list' } });
  });
});

describe('the label Settings address (step 3d-5)', () => {
  it('is /recipes/settings, and nothing more under it', () => {
    expect(SETTINGS_PATH).toBe('/recipes/settings');
    expect(parseRecipesPath('/settings')).toEqual({ kind: 'settings' });
    expect(parseRecipesPath('/settings/')).toEqual({ kind: 'settings' });
    expect(parseRecipesPath('/settings/x')).toEqual({ kind: 'unknown' });
    expect(resolveRecipesPath('/settings')).toEqual({ view: { kind: 'settings' } });
  });
});

describe('the editor addresses (step 3d-6)', () => {
  it('has a new recipe at /recipes/new, and nothing more under it', () => {
    expect(NEW_PATH).toBe('/recipes/new');
    expect(parseRecipesPath('/new')).toEqual({ kind: 'new' });
    expect(parseRecipesPath('/new/')).toEqual({ kind: 'new' });
    expect(parseRecipesPath('/new/x')).toEqual({ kind: 'unknown' });
    expect(resolveRecipesPath('/new')).toEqual({ view: { kind: 'new' } });
  });

  it('has the editor of a recipe at /recipes/<id>/edit, the id written whole and read back whole', () => {
    expect(editPath('abc')).toBe('/recipes/abc/edit');
    expect(parseRecipesPath('/abc/edit')).toEqual({ kind: 'edit', id: 'abc' });
    expect(parseRecipesPath('/abc/edit/')).toEqual({ kind: 'edit', id: 'abc' });
    for (const id of ['a/b c', '100%', 'é', 'x?y#z']) {
      expect(parseRecipesPath(editPath(id).slice(RECIPES_PATH.length))).toEqual({ kind: 'edit', id });
    }
    expect(resolveRecipesPath('/abc/edit')).toEqual({ view: { kind: 'edit', id: 'abc' } });
  });

  it('keeps the reserved words and bad ids out of the editor address', () => {
    for (const word of ['new', 'allergens', 'settings', 'photo']) {
      expect(parseRecipesPath(`/${word}/edit`), word).toEqual({ kind: 'unknown' });
    }
    expect(parseRecipesPath('/%/edit')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/Edit')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/edit/x')).toEqual({ kind: 'unknown' });
  });
});

describe('the mixing steps address (step 3d-8)', () => {
  it('has the steps of a recipe at /recipes/<id>/steps, the id written whole and read back whole', () => {
    expect(stepsPath('abc')).toBe('/recipes/abc/steps');
    expect(parseRecipesPath('/abc/steps')).toEqual({ kind: 'steps', id: 'abc' });
    expect(parseRecipesPath('/abc/steps/')).toEqual({ kind: 'steps', id: 'abc' });
    for (const id of ['a/b c', '100%', 'é', 'x?y#z']) {
      expect(parseRecipesPath(stepsPath(id).slice(RECIPES_PATH.length))).toEqual({ kind: 'steps', id });
    }
    expect(resolveRecipesPath('/abc/steps')).toEqual({ view: { kind: 'steps', id: 'abc' } });
  });

  it('keeps the reserved words and bad ids out of the steps address', () => {
    for (const word of ['new', 'allergens', 'settings', 'photo']) {
      expect(parseRecipesPath(`/${word}/steps`), word).toEqual({ kind: 'unknown' });
    }
    expect(parseRecipesPath('/%/steps')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/Steps')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/step')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/steps/x')).toEqual({ kind: 'unknown' });
  });
});

describe('the guided mix address (step 3d-8, slice B)', () => {
  it('has the run of a recipe at /recipes/<id>/mix, the id written whole and read back whole', () => {
    expect(mixPath('abc')).toBe('/recipes/abc/mix');
    expect(parseRecipesPath('/abc/mix')).toEqual({ kind: 'mix', id: 'abc' });
    expect(parseRecipesPath('/abc/mix/')).toEqual({ kind: 'mix', id: 'abc' });
    for (const id of ['a/b c', '100%', 'é', 'x?y#z']) {
      expect(parseRecipesPath(mixPath(id).slice(RECIPES_PATH.length))).toEqual({ kind: 'mix', id });
    }
    expect(resolveRecipesPath('/abc/mix')).toEqual({ view: { kind: 'mix', id: 'abc' } });
  });

  it('keeps the reserved words and bad ids out of the mix address', () => {
    for (const word of ['new', 'allergens', 'settings', 'photo']) {
      expect(parseRecipesPath(`/${word}/mix`), word).toEqual({ kind: 'unknown' });
    }
    expect(parseRecipesPath('/%/mix')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/Mix')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/mixes')).toEqual({ kind: 'unknown' });
    expect(parseRecipesPath('/abc/mix/x')).toEqual({ kind: 'unknown' });
  });
});
