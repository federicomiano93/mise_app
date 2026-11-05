import { describe, expect, it } from 'vitest';
import {
  CALCULATOR_PATH, SETTINGS_PATH, clientPath, clientsPath, divisorPath, divisorRecipePath, extraPath, inRecipesEditor, logSettingsPath,
  LOG_PATH, inWhatsappItem, logEditPath, newWhatsappDirectPath, newWhatsappListPath, whatsappDirectAddPath, whatsappDirectPath, whatsappEntryAddPath, whatsappEntryPath, whatsappListAddPath, whatsappListPath, whatsappPath, logHistoryPath, logVersionPath, logViewPath, newClientPath, newLogPath, newRecipePath, parseCalculatorPath, recipePath, recipeSettingsPath, recipesPath, resolveCalculatorPath,
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

  it.each([
    ['/settings/recipes', { kind: 'list' }],
    ['/settings/recipes/new', { kind: 'new' }],
    ['/settings/recipes/r-1', { kind: 'one', id: 'r-1' }],
  ])('%s is drawn as the Recipes editor, whatever the tabs are', (rest, target) => {
    expect(resolveCalculatorPath(rest, visible)).toEqual({ settings: { kind: 'recipes', target } });
    expect(resolveCalculatorPath(rest, [])).toEqual({ settings: { kind: 'recipes', target } });
  });

  it('knows which addresses belong to the Recipes editor', () => {
    expect(inRecipesEditor(recipesPath)).toBe(true);
    expect(inRecipesEditor(recipeSettingsPath('r-1'))).toBe(true);
    expect(inRecipesEditor(newRecipePath)).toBe(true);
    expect(inRecipesEditor('/calculator/settings')).toBe(false);
    expect(inRecipesEditor('/calculator/settings/recipesx')).toBe(false);
    expect(inRecipesEditor('/calculator/settings/clients')).toBe(false);
  });

  it('sends the bare word «new» under Clients to the list: a client is made by Add client', () => {
    expect(resolveCalculatorPath('/settings/clients/new', visible)).toEqual({ redirect: '/calculator/settings/clients' });
  });

  it('sends any other address under Settings to the hub', () => {
    expect(resolveCalculatorPath('/settings/nonsense', visible)).toEqual({ redirect: '/calculator/settings' });
    expect(resolveCalculatorPath('/settings/extra/more', [])).toEqual({ redirect: '/calculator/settings' });
  });
});

describe('the WhatsApp addresses', () => {
  it.each([
    ['/settings/whatsapp', { kind: 'top' }],
    ['/settings/whatsapp/', { kind: 'top' }],
    ['/settings/whatsapp/list/new', { kind: 'new', group: 'list' }],
    ['/settings/whatsapp/direct/new', { kind: 'new', group: 'direct' }],
    ['/settings/whatsapp/list/wl-1', { kind: 'list', id: 'wl-1' }],
    ['/settings/whatsapp/list/wl-1/add', { kind: 'listAdd', id: 'wl-1' }],
    ['/settings/whatsapp/list/wl-1/client/roma', { kind: 'entry', id: 'wl-1', clientId: 'roma' }],
    ['/settings/whatsapp/list/wl-1/client/roma/add', { kind: 'entryAdd', id: 'wl-1', clientId: 'roma' }],
    ['/settings/whatsapp/list/wl-1/client/add', { kind: 'entry', id: 'wl-1', clientId: 'add' }],
    ['/settings/whatsapp/direct/wc-1', { kind: 'direct', id: 'wc-1' }],
    ['/settings/whatsapp/direct/wc-1/add', { kind: 'directAdd', id: 'wc-1' }],
    ['/settings/whatsapp/list/a%2Fb%20c', { kind: 'list', id: 'a/b c' }],
  ])('%s is a WhatsApp screen', (rest, target) => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'settings', view: { kind: 'whatsapp', target } });
  });

  it.each([
    '/settings/whatsapp/nonsense', '/settings/whatsapp/list', '/settings/whatsapp/direct', '/settings/whatsapp/list/new/add',
    '/settings/whatsapp/list/wl-1/x', '/settings/whatsapp/list/wl-1/add/x', '/settings/whatsapp/list/wl-1/client',
    '/settings/whatsapp/list/wl-1/client/roma/x', '/settings/whatsapp/list/wl-1/client/roma/add/x',
    '/settings/whatsapp/direct/wc-1/client/roma', '/settings/whatsapp/direct/new/x', '/settings/whatsapp/list/%',
    '/settings/whatsapp/list/wl-1/client/%',
  ])('%s is an unknown address: it goes back to Settings', rest => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'settings', view: { kind: 'unknown' } });
    expect(resolveCalculatorPath(rest, ['focaccia'])).toEqual({ redirect: SETTINGS_PATH });
  });

  it('draws every WhatsApp address whatever the tabs are', () => {
    expect(resolveCalculatorPath('/settings/whatsapp/list/new', [])).toEqual({
      settings: { kind: 'whatsapp', target: { kind: 'new', group: 'list' } },
    });
  });

  it('writes every address percent-encoded, and parse reads it back', () => {
    for (const id of ['wl-1', 'a/b c', '100%', 'é']) {
      expect(parseCalculatorPath(whatsappListPath(id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'whatsapp', target: { kind: 'list', id } } });
      expect(parseCalculatorPath(whatsappListAddPath(id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'whatsapp', target: { kind: 'listAdd', id } } });
      expect(parseCalculatorPath(whatsappEntryPath(id, id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'whatsapp', target: { kind: 'entry', id, clientId: id } } });
      expect(parseCalculatorPath(whatsappEntryAddPath(id, 'x').slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'whatsapp', target: { kind: 'entryAdd', id, clientId: 'x' } } });
      expect(parseCalculatorPath(whatsappDirectPath(id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'whatsapp', target: { kind: 'direct', id } } });
      expect(parseCalculatorPath(whatsappDirectAddPath(id).slice(CALCULATOR_PATH.length)))
        .toEqual({ kind: 'settings', view: { kind: 'whatsapp', target: { kind: 'directAdd', id } } });
    }
    expect([whatsappPath, newWhatsappListPath, newWhatsappDirectPath]).toEqual([
      '/calculator/settings/whatsapp', '/calculator/settings/whatsapp/list/new', '/calculator/settings/whatsapp/direct/new',
    ]);
  });

  it('knows which addresses belong to ONE item: its own screens, never the top or another item', () => {
    expect(inWhatsappItem(whatsappListPath('wl-1'), 'list', 'wl-1')).toBe(true);
    expect(inWhatsappItem(whatsappListAddPath('wl-1'), 'list', 'wl-1')).toBe(true);
    expect(inWhatsappItem(whatsappEntryAddPath('wl-1', 'roma'), 'list', 'wl-1')).toBe(true);
    expect(inWhatsappItem(whatsappDirectAddPath('wc-1'), 'direct', 'wc-1')).toBe(true);
    expect(inWhatsappItem(whatsappPath, 'list', 'wl-1')).toBe(false);
    expect(inWhatsappItem(whatsappListPath('wl-10'), 'list', 'wl-1')).toBe(false);
    expect(inWhatsappItem(whatsappListPath('wc-1'), 'direct', 'wc-1')).toBe(false);
    expect(inWhatsappItem('/calculator/settings', 'list', 'wl-1')).toBe(false);
  });
});

describe('the Dough history addresses', () => {
  it.each([
    ['/log', { kind: 'list' }],
    ['/log/', { kind: 'list' }],
    ['/log/new', { kind: 'new' }],
    ['/log/l-1', { kind: 'one', id: 'l-1' }],
    ['/log/l-1/edit', { kind: 'edit', id: 'l-1' }],
    ['/log/l-1/history', { kind: 'history', id: 'l-1' }],
    ['/log/l-1/history/3', { kind: 'version', id: 'l-1', n: 3 }],
    ['/log/a%2Fb%20c/history/12', { kind: 'version', id: 'a/b c', n: 12 }],
  ])('%s is a Dough history screen', (rest, view) => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'log', view });
  });

  it.each([
    '/log/l-1/more', '/log/l-1/edit/x', '/log/l-1/history/0', '/log/l-1/history/-1', '/log/l-1/history/1.5',
    '/log/l-1/history/abc', '/log/l-1/history/1/x', '/log/new/edit', '/log/%', '/log/a/b/c/d',
  ])('%s is an unknown Dough history address', rest => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'log', view: { kind: 'unknown' } });
  });

  it('reads «log» as the first segment as the Dough history, never as a recipe called log', () => {
    expect(parseCalculatorPath('/log')).toEqual({ kind: 'log', view: { kind: 'list' } });
  });

  it('writes every address percent-encoded, and parse reads it back', () => {
    for (const id of ['l-1', 'a/b c', '100%', 'é']) {
      expect(logViewPath(id)).toMatch(new RegExp(`^${LOG_PATH}/[^/]+$`));
      const back = (path: string) => parseCalculatorPath(path.slice(CALCULATOR_PATH.length));
      expect(back(logViewPath(id))).toEqual({ kind: 'log', view: { kind: 'one', id } });
      expect(back(logEditPath(id))).toEqual({ kind: 'log', view: { kind: 'edit', id } });
      expect(back(logHistoryPath(id))).toEqual({ kind: 'log', view: { kind: 'history', id } });
      expect(back(logVersionPath(id, 2))).toEqual({ kind: 'log', view: { kind: 'version', id, n: 2 } });
    }
    expect([LOG_PATH, newLogPath]).toEqual(['/calculator/log', '/calculator/log/new']);
  });

  it('is drawn whatever the tabs are, and sends anything unknown to the list', () => {
    expect(resolveCalculatorPath('/log/l-1', [])).toEqual({ log: { kind: 'one', id: 'l-1' } });
    expect(resolveCalculatorPath('/log/new', ['focaccia'])).toEqual({ log: { kind: 'new' } });
    expect(resolveCalculatorPath('/log/l-1/history/zero', ['focaccia'])).toEqual({ redirect: '/calculator/log' });
    expect(resolveCalculatorPath('/log/a/b/c/d', [])).toEqual({ redirect: '/calculator/log' });
  });
});
