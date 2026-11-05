import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';

// «No paper is not no screen» (P17). buildLabel() has already said this recipe can be declared, so when the layout
// refuses to draw it something upstream changed shape — and the right answer is the screen the app had before
// printing existed, not a blank page: the card, the notes, the caveat, Copy and Send. The model never refuses a
// label that was built (the only refusals are an unbuilt label and a label with no blocks), so this spec makes it do so.
vi.mock('@mise/shared/label-template-model', async importOriginal => {
  const original = await importOriginal<typeof import('@mise/shared/label-template-model')>();
  return { ...original, resolveLabel: () => ({ ok: false, reason: 'no-blocks' }) };
});

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });

const FLOUR = { id: 'flour', name: 'flour', allergens: ['gluten-wheat'], allergensCheckedAt: '2026-01-01' };
const CAKE = { id: 'cake', name: 'Cake', ingredients: [{ label: 'Flour', grams: 500, unit: 'g', refId: 'flour' }] };

describe('a label whose paper cannot be laid out', () => {
  it('keeps the card, the notes, the caveat, Copy and Send, and has no paper and no Print button', async () => {
    renderRecipes('/recipes/cake/label', {
      source: fakeRecipesSource({ recipes: [CAKE], ingredients: [FLOUR] }), session: { location: { country: 'GB' } },
    });
    const main = within(await screen.findByRole('main'));
    await main.findByRole('group', { name: 'What the label shows' }, LOAD);

    expect(main.getByText('Contains: Wheat')).toBeInTheDocument();
    expect(main.getByText('Check this before it goes on food')).toBeInTheDocument();
    expect(main.getByText(/^This label is produced in English/)).toBeInTheDocument();
    expect(main.getByRole('button', { name: 'Copy the text' })).toBeEnabled();
    expect(main.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(main.queryByRole('button', { name: /^Print/ })).not.toBeInTheDocument();
    expect(document.querySelector('.lab-sheet')).toBeNull();
  });
});
