import { describe, expect, it } from 'vitest';
import {
  CALCULATOR_PATH, SETTINGS_PATH, clientPath, clientsPath, divisorPath, divisorRecipePath, extraPath, logSettingsPath,
  newClientPath, newRecipePath, parseCalculatorPath, recipePath, recipeSettingsPath, recipesPath, resolveCalculatorPath,
} from './calculatorPath';

describe('parseCalculatorPath', () => {
  it.each([
    ['', { kind: 'home' }],
    ['/', { kind: 'home' }],
    ['/brioche', { kind: 'recipe', id: 'brioche' }],
    ['/brioche/', { kind: 'recipe', id: 'brioche' }],
  ])('%j → %j', (rest, expected) => {
    expect(parseCalculatorPath(rest)).toEqual(expected);
  });

  it('reads no address at all as the home', () => {
    expect(parseCalculatorPath(undefined)).toEqual({ kind: 'home' });
  });

  // A recipe id is a Firestore document id: it may hold a slash, a percent sign or a space. The segments are
  // split BEFORE they are decoded.
  it('splits the segments before decoding them, so an id with a slash comes back whole', () => {
    expect(parseCalculatorPath('/a%2Fb%20c')).toEqual({ kind: 'recipe', id: 'a/b c' });
  });

  it('does not decode an id twice', () => {
    expect(parseCalculatorPath('/100%2525')).toEqual({ kind: 'recipe', id: '100%25' });
  });

  it.each(['/a/b', '/%', '/%E0%A4%A', '/a/b/c'])('%s is unknown', rest => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'unknown' });
  });
});

describe('recipePath', () => {
  it('writes the id percent-encoded, and parse reads it back', () => {
    for (const id of ['brioche', 'a/b c', '100%', 'é']) {
      expect(recipePath(id)).toMatch(new RegExp(`^${CALCULATOR_PATH}/[^/]+$`));
      expect(parseCalculatorPath(recipePath(id).slice(CALCULATOR_PATH.length))).toEqual({ kind: 'recipe', id });
    }
  });
});

describe('resolveCalculatorPath', () => {
  const visible = ['focaccia', 'brioche'];

  it('shows the first visible recipe at the bare address', () => {
    expect(resolveCalculatorPath('', visible)).toEqual({ active: 'focaccia' });
  });

  it('shows the recipe in the address when it is visible', () => {
    expect(resolveCalculatorPath('/brioche', visible)).toEqual({ active: 'brioche' });
  });

  it('sends an unknown or hidden recipe to the first visible one', () => {
    expect(resolveCalculatorPath('/gone', visible)).toEqual({ redirect: '/calculator/focaccia' });
  });

  it('sends an address of another shape back to the Calculator', () => {
    expect(resolveCalculatorPath('/a/b', visible)).toEqual({ redirect: '/calculator' });
  });

  it('leaves the address alone while there is no visible recipe to judge it by', () => {
    expect(resolveCalculatorPath('/gone', [])).toEqual({ active: null });
    expect(resolveCalculatorPath('', [])).toEqual({ active: null });
  });
});

describe('the Settings addresses', () => {
  it.each([
    ['/settings', { kind: 'hub' }],
    ['/settings/', { kind: 'hub' }],
    ['/settings/extra', { kind: 'extra' }],
    ['/settings/log', { kind: 'log' }],
    ['/settings/divisor', { kind: 'divisor', recipeId: null }],
    ['/settings/divisor/focaccia', { kind: 'divisor', recipeId: 'focaccia' }],
    ['/settings/divisor/a%2Fb%20c', { kind: 'divisor', recipeId: 'a/b c' }],
    ['/settings/clients', { kind: 'clients', target: { kind: 'list' } }],
    ['/settings/clients/new', { kind: 'clients', target: { kind: 'new' } }],
    ['/settings/clients/c-1', { kind: 'clients', target: { kind: 'one', id: 'c-1' } }],
    ['/settings/recipes', { kind: 'recipes', target: { kind: 'list' } }],
    ['/settings/recipes/new', { kind: 'recipes', target: { kind: 'new' } }],
    ['/settings/recipes/r%2F1', { kind: 'recipes', target: { kind: 'one', id: 'r/1' } }],
  ])('%s is a Settings screen', (rest, view) => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'settings', view });
  });

  it.each([
    '/settings/nonsense', '/settings/extra/more', '/settings/log/x', '/settings/divisor/a/b', '/settings/divisor/%',
    '/settings/clients/a/b', '/settings/recipes/%E0%A4%A',
  ])('%s is an unknown Settings address', rest => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'settings', view: { kind: 'unknown' } });
  });

  it('reads a trailing slash as the same screen', () => {
    expect(parseCalculatorPath('/settings/extra/')).toEqual({ kind: 'settings', view: { kind: 'extra' } });
  });

  it('reads «settings» as the first segment as Settings, never as a recipe called settings', () => {
    expect(parseCalculatorPath('/settings')).toEqual({ kind: 'settings', view: { kind: 'hub' } });
  });

  it('writes every address percent-encoded, and parse reads it back', () => {
    for (const id of ['brioche', 'a/b c', '100%', 'é']) {
      expect(divisorRecipePath(id)).toMatch(new RegExp(`^${divisorPath}/[^/]+$`));
      expect(parseCalculatorPath(divisorRecipePath(id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'divisor', recipeId: id } });
      expect(parseCalculatorPath(clientPath(id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'clients', target: { kind: 'one', id } } });
      expect(parseCalculatorPath(recipeSettingsPath(id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'recipes', target: { kind: 'one', id } } });
    }
    expect(SETTINGS_PATH).toBe('/calculator/settings');
    expect([extraPath, logSettingsPath, clientsPath, newClientPath, recipesPath, newRecipePath]).toEqual([
      '/calculator/settings/extra', '/calculator/settings/log', '/calculator/settings/clients',
      '/calculator/settings/clients/new', '/calculator/settings/recipes', '/calculator/settings/recipes/new',
    ]);
  });
});

describe('resolveCalculatorPath for Settings', () => {
  const visible = ['focaccia', 'brioche'];

  it.each([
    ['/settings', { kind: 'hub' }],
    ['/settings/extra', { kind: 'extra' }],
    ['/settings/log', { kind: 'log' }],
    ['/settings/divisor/brioche', { kind: 'divisor', recipeId: 'brioche' }],
  ])('%s is drawn, whatever the tabs are', (rest, settings) => {
    expect(resolveCalculatorPath(rest, visible)).toEqual({ settings });
    expect(resolveCalculatorPath(rest, [])).toEqual({ settings });
  });

  it.each(['/settings/clients', '/settings/clients/new', '/settings/clients/c-1', '/settings/recipes',
    '/settings/recipes/new', '/settings/recipes/r-1'])('%s is reserved: it goes to the hub until it is drawn', rest => {
    expect(resolveCalculatorPath(rest, visible)).toEqual({ redirect: '/calculator/settings' });
  });

  it('sends any other address under Settings to the hub', () => {
    expect(resolveCalculatorPath('/settings/nonsense', visible)).toEqual({ redirect: '/calculator/settings' });
    expect(resolveCalculatorPath('/settings/extra/more', [])).toEqual({ redirect: '/calculator/settings' });
  });
});
