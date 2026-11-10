import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { editorSource, intoForm } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// ⚠️ A FAULT IN THE «COST PER 1 KG» BLOCK MUST NOT TAKE THE CARD DOWN (P17; the current app pins its try/catch in
// tests/foodcost-per-kg-screen.test.mjs). costPerKg is made to throw: the block hides, the answer and the form stay.
vi.mock('@mise/shared/per-kg-model', async importOriginal => ({
  ...(await importOriginal<typeof import('@mise/shared/per-kg-model')>()),
  costPerKg: () => { throw new Error('per-kg fault'); },
}));

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });

it('hides the block when costPerKg throws, and keeps the answer and the form', async () => {
  const { user } = renderFoodcost('/food-cost/product/Green', { source: editorSource([product('Green')]) });
  await intoForm(user);
  expect(screen.getByRole('group', { name: 'Production cost' })).toBeInTheDocument();
  expect(screen.queryByText("This part didn't load")).not.toBeInTheDocument();
  const details = document.querySelector('details');
  // Hidden, or never there: either way nobody sees a block with no figures.
  expect(details === null || details.hidden).toBe(true);
});
