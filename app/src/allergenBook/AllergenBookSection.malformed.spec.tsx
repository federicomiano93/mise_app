import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { LOAD } from '../testing/renderRecipes';
import { closeBookHost } from './bookPrintHost';
import { open } from './allergenBookRender';

// One malformed recipe that makes the book's own work throw must not take the section down: the title stays, the book says it failed in
// its own part, and the band simply has no buttons.
vi.mock('./bookEntry', async importOriginal => {
  const original = await importOriginal<typeof import('./bookEntry')>();
  return { ...original, isBookComplete: () => { throw new Error('a malformed recipe'); } };
});

beforeAll(async () => {
  await import('./AllergenBookSection');
}, 60_000);
beforeEach(() => { window.localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => {
  act(() => { closeBookHost(); });
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('a failure while the book is worked out', () => {
  it('leaves the section and its title standing, with no buttons in the band', async () => {
    open({ lang: 'en', country: 'GB' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Allergen book' }, LOAD)).toBeInTheDocument();
    expect(await screen.findByText('This part didn’t load.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose the products' })).not.toBeInTheDocument();
  });
});
