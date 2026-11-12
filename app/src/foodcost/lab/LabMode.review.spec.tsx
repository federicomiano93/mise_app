import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { editorSource } from '../../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../../testing/renderFoodcost';
import { labDraftKey, serializeDraft } from './labDraft';
import { newDraft, startDraft } from './labModel';
import type { Product } from '@mise/shared/foodcost-model';
import type { LabStepId } from './labModel';

// The review of PR #537: what the lab must not do to the card, and how a production is given up.

beforeAll(async () => { await import('../FoodcostSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const KEY = labDraftKey('bakery', 'Green');

const GREEN = () => product('Green', {
  components: [
    { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' },
  ],
  labourMinutes: 30,
  labourPeople: 1,
  model: 3,
});
const source = (fields?: Record<string, unknown>) => editorSource([{ ...GREEN(), ...fields }]);

const CARD: Product = {
  id: 'Green', name: 'Green', components: [], packaging: [], sellingMode: 'piece', piecesPerBatch: 10, packSize: null, packUnit: null,
  sellingPrice: null, vatRate: null, foodCostTarget: null, labourMinutes: null, labourPeople: null, noWeightLoss: false,
  rawGrams: null, cookedGrams: null, model: 3,
};
const seedDraft = (agoMs: number, step: LabStepId = 'ingredients') => {
  window.localStorage.setItem(KEY, serializeDraft({ ...startDraft(newDraft(CARD), Date.now() - agoMs), step }));
};

async function openCard(fake = source()) {
  const view = renderFoodcost('/food-cost/product/Green', { source: fake });
  await screen.findByRole('button', { name: 'Edit product' }, LOAD);
  return { ...view, fake };
}
const lab = () => screen.getByRole('dialog', { name: 'Produce in the lab' });
async function openLab(fake = source()) {
  const view = await openCard(fake);
  await view.user.click(screen.getByRole('button', { name: 'Produce in the lab' }));
  await screen.findByRole('dialog', { name: 'Produce in the lab' }, LOAD);
  return view;
}
type User = Awaited<ReturnType<typeof openLab>>['user'];
const start = (user: User) => user.click(within(lab()).getByRole('button', { name: 'Start' }));
const dot = (user: User, name: string) =>
  user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name }));
const press = async (user: User, keys: string) => {
  for (const key of keys) await user.click(within(lab()).getByRole('button', { name: key }));
};
async function saveFromResult(user: User) {
  await dot(user, 'Result');
  await user.click(within(lab()).getByRole('button', { name: 'Save to the card' }));
  const asked = await screen.findByRole('alertdialog', undefined, LOAD);
  return asked;
}

describe('no cooked weight typed keeps the oven loss of the card', () => {
  it('says so on the cooked step, on the result and in the save question — and writes the scaled cooked weight', async () => {
    // 1,020 g raw and 918 g cooked on the card: a 10% loss.
    const { user, fake } = await openLab(source({ cookedGrams: 918 }));
    await start(user);
    await dot(user, 'Cooked dough');
    expect(within(lab()).getByText('If you do not weigh it, the card’s loss stays (10.00%).')).toBeInTheDocument();
    // Salt 20 g to 120 g: the raw total is 1,120 g, and the cooked weight follows it.
    await dot(user, 'Ingredients');
    await user.click(within(lab()).getByRole('button', { name: /^Weighed Salt:/ }));
    await press(user, '120');
    await dot(user, 'Result');
    expect(within(lab()).getByText('10.00%')).toBeInTheDocument();
    expect(within(lab()).getByText('the card’s loss')).toBeInTheDocument();
    await user.click(within(lab()).getByRole('button', { name: 'Save to the card' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText('Baking: raw 1,120 g, cooked 1,008 g (the card’s loss, 10.00%)')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Saved to the card' }, LOAD);
    const data = fake.saved.find(item => item.kind === 'product')?.data as { cookedGrams: number };
    expect(data.cookedGrams).toBeCloseTo(1008, 3);
  });

  it('a product without a cooked weight stays without one', async () => {
    const { user, fake } = await openLab();
    await start(user);
    await dot(user, 'Result');
    expect(within(lab()).queryByText('the card’s loss')).not.toBeInTheDocument();
    const asked = await saveFromResult(user);
    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Saved to the card' }, LOAD);
    const data = fake.saved.find(item => item.kind === 'product')?.data as { cookedGrams?: number | null };
    expect(data.cookedGrams ?? null).toBeNull();
  });
});

describe('the margin note', () => {
  it('is shown only when a margin point will really be recorded', async () => {
    const { user } = await openLab();
    await start(user);
    await dot(user, 'Cooked dough');
    await press(user, '900');
    const asked = await saveFromResult(user);
    expect(within(asked).getByText('The margin history keeps a record.')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
  });

  it('is left out when nothing changes', async () => {
    const { user } = await openLab();
    await start(user);
    const asked = await saveFromResult(user);
    expect(within(asked).queryByText('The margin history keeps a record.')).not.toBeInTheDocument();
  });
});

describe('giving a production up', () => {
  it('asks first (No keeps it), and «Cancel production» clears the draft and the banner without touching the card', async () => {
    seedDraft(60_000);
    const { user, fake } = await openCard();
    await user.click(screen.getByRole('button', { name: 'Cancel production' }));
    const asked = await screen.findByRole('alertdialog', { name: 'Cancel the production in progress?' }, LOAD);
    expect(within(asked).getByText('The weights written so far are lost. The card does not change.')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'No' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel production' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Cancel production' }));
    await waitFor(() => { expect(window.localStorage.getItem(KEY)).toBeNull(); });
    expect(screen.queryByText(/^In the lab/)).not.toBeInTheDocument();
    expect(fake.saved).toHaveLength(0);
  });
});

describe('a production older than a day', () => {
  it('does not let «Tempo» follow the timer: the card minutes stand, and «Dal cronometro» is there', async () => {
    seedDraft(26 * 3_600_000, 'time');
    const { user } = await openCard(source({ labourMinutes: 30 }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('dialog', { name: 'Produce in the lab' }, LOAD);
    expect(within(lab()).getByRole('button', { name: /^Time:/ })).toHaveTextContent('30');
    await user.click(within(lab()).getByRole('button', { name: 'From the timer' }));
    expect(within(lab()).getByRole('button', { name: /^Time:/ })).toHaveTextContent('1560');
  });
});

describe('a resumed step that no longer exists', () => {
  it('opens on the next step, with its own box selected', async () => {
    // «Pezzi ottenuti» for a product now sold by weight.
    seedDraft(60_000, 'pieces');
    const { user } = await openCard(source({ sellingMode: 'weight', piecesPerBatch: null }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('dialog', { name: 'Produce in the lab' }, LOAD);
    expect(within(lab()).getByRole('heading', { name: 'Time and people' })).toBeInTheDocument();
    expect(within(lab()).getByRole('button', { name: /^Time:/ })).toHaveAttribute('aria-current', 'true');
  });
});

describe('the lab holds the app', () => {
  it('marks it busy while open, so a reload the app starts itself waits, and lets go on leaving', async () => {
    const { isBusy } = await import('../../session/busy');
    const { user } = await openLab();
    expect(isBusy()).toBe(true);
    await user.click(within(lab()).getByRole('button', { name: 'Exit' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });
});

describe('the people of the card', () => {
  it('are saved untouched when the stepper was not pressed (1.5 stays 1.5)', async () => {
    const { user, fake } = await openLab(source({ labourPeople: 1.5 }));
    await start(user);
    const asked = await saveFromResult(user);
    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Saved to the card' }, LOAD);
    expect(fake.saved.find(item => item.kind === 'product')?.data).toMatchObject({ labourPeople: 1.5 });
  });
});

describe('a line over the rules\' limit', () => {
  it('keeps the production open and says why', async () => {
    const line = { kind: 'ingredient', ingredientId: 'flour', qty: 1, unit: 'g' };
    const { user, fake } = await openLab(source({ components: Array.from({ length: 99 }, () => line) }));
    await start(user);
    await user.click(within(lab()).getByRole('button', { name: 'Add an ingredient' }));
    const chooser = await screen.findByRole('dialog', { name: 'Choose an ingredient' }, LOAD);
    await user.click(within(chooser).getByRole('button', { name: /^Flour/ }));
    await press(user, '5');
    await user.click(within(lab()).getByRole('button', { name: 'Add an ingredient' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Choose an ingredient' }, LOAD)).getByRole('button', { name: /^Flour/ }));
    await press(user, '6');
    await dot(user, 'Result');
    await user.click(within(lab()).getByRole('button', { name: 'Save to the card' }));
    expect(await screen.findByText(/Too many lines/)).toBeInTheDocument();
    expect(fake.saved.filter(item => item.kind === 'product')).toHaveLength(0);
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });
});
