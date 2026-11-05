import { vi } from 'vitest';
import type { StoredDoc } from '../recipes/recipesSource';
import { fakeRecipesSource } from './fakeRecipesSource';
import type { FakeRecipesSource } from './fakeRecipesSource';
import { renderApp } from './renderApp';

// Draws the real app at a Recipe catalogue address, with an in-memory source behind it.
type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  source?: FakeRecipesSource;
};

export function renderRecipes(path = '/recipes', { source = fakeRecipesSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { recipes: () => source, ...options.data } });
  return { ...view, source };
}

// A recipe as the database holds it: only grams in the rows, so the amounts are easy to read.
export function recipe(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return {
    id,
    name: id,
    ingredients: [
      { label: 'Flour', grams: 1000, unit: 'g' },
      { label: 'Water', grams: 700, unit: 'g' },
      { label: 'Salt', grams: 20, unit: 'g' },
    ],
    ...fields,
  };
}

export function sourceWith(recipes: StoredDoc[]): FakeRecipesSource {
  return fakeRecipesSource({ recipes });
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

export const LOAD = { timeout: 10_000 };
