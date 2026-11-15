import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { Product } from '@mise/shared/foodcost-model';
import { editorSource } from '../../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../../testing/renderFoodcost';
import { labDraftKey, serializeDraft } from './labDraft';
import { newDraft, startDraft } from './labModel';

// The oven pauses the labour clock (the owner's decision, 12 Nov 2026: «fermalo»). Driven through the screen.

beforeAll(async () => { await import('../FoodcostSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const KEY = labDraftKey('bakery', 'Green');
const MIN = 60_000;
const CARD: Product = {
  id: 'Green', name: 'Green', components: [], packaging: [], sellingMode: 'piece', piecesPerBatch: 10, packSize: null, packUnit: null,
  sellingPrice: null, vatRate: null, foodCostTarget: null, labourMinutes: null, labourPeople: null, noWeightLoss: false,
  rawGrams: null, cookedGrams: null, model: 3,
};

// A production started `startedAgo` ago, in the oven since `ovenAgo` ago (or not in it).
function seed(startedAgo: number, ovenAgo: number | null, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const draft = { ...startDraft(newDraft(CARD), now - startedAgo), step: ovenAgo === null ? 'raw' as const : 'oven' as const, ovenSince: ovenAgo === null ? null : now - ovenAgo };
  window.localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(serializeDraft(draft)) as object, ...extra }));
}

async function openCard() {
  const view = renderFoodcost('/food-cost/product/Green', {
    source: editorSource([product('Green', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }] })]),
  });
  await screen.findByRole('button', { name: 'Edit product' }, LOAD);
  return view;
}
const lab = () => screen.getByRole('dialog', { name: 'Produce in the lab' });
async function resume(view: Awaited<ReturnType<typeof openCard>>) {
  await view.user.click(screen.getByRole('button', { name: 'Resume' }));
  await screen.findByRole('dialog', { name: 'Produce in the lab' }, LOAD);
}

describe('the oven step', () => {
  it('exit and resume while in the oven: the labour clock stays frozen and muted, the big clock is the oven time', async () => {
    // Started 40 minutes ago, in the oven for the last 30: ten minutes of labour.
    seed(40 * MIN, 30 * MIN);
    const view = await openCard();
    // The card banner shows the labour clock and says where it is.
    expect(screen.getByText(/^In the lab · 0:(09:5\d|10:0\d) · in the oven$/)).toBeInTheDocument();
    await resume(view);
    expect(within(lab()).getByRole('heading', { name: 'In the oven' })).toBeInTheDocument();
    const clock = within(lab()).getByRole('timer', { name: 'Timer, paused while in the oven' });
    expect(clock).toHaveTextContent(/^0:(09:5\d|10:0\d)$/);
    expect(clock).toHaveAttribute('data-idle', 'true');
    expect(within(lab()).getByText('In the oven for')).toBeInTheDocument();
    expect(within(lab()).getByText(/^0:30:0\d$/)).toBeInTheDocument();
    expect(within(lab()).getByText('Oven time does not count as labour. You can leave and come back.')).toBeInTheDocument();
  });

  it('leaving the oven by Next puts the labour clock back to running, with the oven visit taken out', async () => {
    seed(40 * MIN, 30 * MIN);
    const view = await openCard();
    await resume(view);
    await view.user.click(within(lab()).getByRole('button', { name: 'Next' }));
    const clock = within(lab()).getByRole('timer', { name: 'Timer' });
    expect(clock).toHaveTextContent(/^0:(09:5\d|10:0\d)$/);
    expect(clock).toHaveAttribute('data-idle', 'false');
    // Back in: a new visit starts, the earlier one is in the total.
    await view.user.click(within(lab()).getByRole('button', { name: 'Back' }));
    expect(within(lab()).getByRole('timer', { name: 'Timer, paused while in the oven' })).toHaveTextContent(/^0:(09:5\d|10:0\d)$/);
    expect(within(lab()).getByText(/^0:00:0\d$/)).toBeInTheDocument();
  });

  it('a dot out of the oven ends the visit too, and the banner drops «in forno»', async () => {
    seed(40 * MIN, 30 * MIN);
    const view = await openCard();
    await resume(view);
    await view.user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Result' }));
    expect(within(lab()).getByRole('timer', { name: 'Timer' })).toHaveTextContent(/^0:(09:5\d|10:0\d)$/);
    await view.user.click(within(lab()).getByRole('button', { name: 'Exit' }));
    expect(await screen.findByText(/^In the lab · 0:(09:5\d|10:0\d)$/)).toBeInTheDocument();
  });

  it('a draft from before the pause has no oven fields: it reads as zero paused time and does not crash', async () => {
    seed(20 * MIN, null);
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string) as Record<string, unknown>;
    delete stored.ovenSince;
    delete stored.ovenPausedMs;
    window.localStorage.setItem(KEY, JSON.stringify({ ...stored, step: 'oven' }));
    const view = await openCard();
    await resume(view);
    expect(within(lab()).getByRole('heading', { name: 'In the oven' })).toBeInTheDocument();
    expect(within(lab()).getByText(/^0:00:00$/)).toBeInTheDocument();
    // The labour clock showed the wall time before (nothing was paused), and Next releases it.
    await view.user.click(within(lab()).getByRole('button', { name: 'Next' }));
    expect(within(lab()).getByRole('timer', { name: 'Timer' })).toHaveTextContent(/^0:20:0\d$/);
  });

  it('the minutes saved from the timer exclude the oven', async () => {
    // 60 minutes since the start, 45 of them in the oven (a visit already left): 15 minutes of labour.
    seed(60 * MIN, null, { ovenPausedMs: 45 * MIN });
    const view = await openCard();
    await resume(view);
    await view.user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Time and people' }));
    expect(within(lab()).getByRole('button', { name: /^Time:/ })).toHaveTextContent('15');
  });
});
