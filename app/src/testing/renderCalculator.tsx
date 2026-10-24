import { vi } from 'vitest';
import { fakeCalculatorSource } from './fakeCalculatorSource';
import type { FakeCalculatorSource } from './fakeCalculatorSource';
import { renderApp } from './renderApp';

// Draws the real app at a Calculator address, with an in-memory source behind it.
type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  source?: FakeCalculatorSource;
};

export function renderCalculator(path = '/calculator', { source = fakeCalculatorSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { calculator: () => source, ...options.data } });
  return { ...view, source };
}

export const LOAD = { timeout: 10_000 };

// ── A realistic configuration (the shape normalizeConfig reads) ──────────────

// Flour 1000 g, water 700 g, salt 20 g, yeast 5 g: the yeast is 0.5% of the flour, which is the recipe's
// resting point, so the knob at its default changes nothing.
export const FOCACCIA = {
  id: 'focaccia', name: 'Focaccia', logic: 'orders', order: 1, visible: true,
  ingredients: [
    { key: 'flour', label: 'Flour', grams: 1000 },
    { key: 'water', label: 'Water', grams: 700 },
    { key: 'salt', label: 'Salt', grams: 20 },
    { key: 'yeast', label: 'Yeast', grams: 5 },
  ],
  leaveningKey: 'yeast', leaveningDefaultPct: 0.5, baselinePct: 0.5, showLeavening: true,
};

export const BRIOCHE = {
  id: 'brioche', name: 'Brioche', logic: 'total', order: 2, visible: true,
  ingredients: [
    { key: 'flour', label: 'Flour', grams: 500 },
    { key: 'butter', label: 'Butter', grams: 250 },
    { key: 'eggs', label: 'Eggs', grams: 250 },
  ],
};

export const SOURDOUGH = {
  id: 'sourdough', name: 'Sourdough', logic: 'trays', order: 3, visible: true, trayWeight: 1200,
  ingredients: [
    { key: 'flour', label: 'Flour', grams: 600 },
    { key: 'water', label: 'Water', grams: 400 },
  ],
};

export const CLIENTS = [
  {
    id: 'roma', name: 'Cafe Roma',
    products: [
      { id: 'tray', name: 'Focaccia tray', recipeId: 'focaccia', weight: 500, kind: 'number', crate: { show: true, perBox: 10 }, active: true },
      { id: 'slab', name: 'Focaccia slab', recipeId: 'focaccia', weight: 800, kind: 'dropdown', crate: { show: false, perBox: 20 }, active: true },
      { id: 'paused', name: 'Paused loaf', recipeId: 'focaccia', weight: 300, kind: 'number', active: false },
      { id: 'roll', name: 'Brioche roll', recipeId: 'brioche', weight: 60, kind: 'number', active: true },
    ],
  },
  {
    id: 'sole', name: 'Bar Sole',
    products: [
      { id: 'tray', name: 'Focaccia tray', recipeId: 'focaccia', weight: 500, kind: 'number', crate: { show: false, perBox: 20 }, active: true },
      { id: 'cheese', name: 'Cheese by the kilo', recipeId: 'focaccia', weight: 1000, kind: 'kg', active: true },
    ],
  },
];

export function configOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { clients: CLIENTS, recipes: [FOCACCIA, BRIOCHE, SOURDOUGH], ...over };
}

export function onlyFocaccia(over: Record<string, unknown> = {}): Record<string, unknown> {
  return configOf({ recipes: [FOCACCIA], ...over });
}

// The tablet's split: jsdom applies no media query, so the query is answered by hand.
export function split(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1000px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
