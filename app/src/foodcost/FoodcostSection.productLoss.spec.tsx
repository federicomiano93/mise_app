import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { currentProduct } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import { editorSource, intoForm, recipe } from '../testing/foodcostEditorFixtures';
import { FLOUR, FLOUR_PRICES, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';
import { COPY_WAIT_MS } from './copyWait';

// Product model 3: the oven loss belongs to the PRODUCT (rawGrams / cookedGrams) and a recipe line is RAW kilos. What the SCREENS do
// with a product saved before (model 2): it waits for the recipes and the prices, shows the converted lines, and Save writes model 3.
// The conversion itself is shared/src/foodcost-model.spec.ts.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const pencil = () => screen.findByRole('button', { name: 'Edit product' }, LOAD);
const cardNamed = (name: string) => screen.getByRole('region', { name });
const rowOf = (scope: HTMLElement, label: string): HTMLElement =>
  within(scope).getByText(label, { selector: 'dt' }).parentElement as HTMLElement;

// A recipe of one kilo of flour (£2.00 a kilo raw) that loses 10% in the oven: 0.9 kg come out.
const DOUGH = recipe('Dough', { lossPct: 10 });
// The product as production holds it today: model 2, the line in FINISHED kilos.
const LEGACY = product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 0.9 }], model: 2 });

// The same product, converted on the very tables the screen has: what the expected figures are computed from.
const converted = (): Product => {
  const tables = {
    recipes: { Dough: DOUGH },
    ingredients: { flour: { ...FLOUR, ...FLOUR_PRICES.flour } },
  };
  const out = currentProduct(LEGACY, tables as never);
  if (!out) throw new Error('not converted');
  return out;
};

describe('a product saved before model 3 (production today)', () => {
  it('(i) waits for the prices: loading at its address, neither the read view nor the form, then it opens', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdIngredients();
    renderFoodcost('/food-cost/product/Loaf', { source: fake });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    // Give the screen every chance to open on unconverted lines.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Made of' })).not.toBeInTheDocument();

    act(() => { fake.releaseIngredients(); });
    expect(await pencil()).toBeInTheDocument();
  });

  // ⚠️ Code reviews, 11 Nov 2026: the recipes' «loaded» flag is true on this phone's own copy, which can be older than the server's
  // — a recipe added since is missing, a loss changed since is stale. Opened on it, the FORM would copy the wrong raw kilos and Save
  // would write them, a wrong cost for ever. The READ view (which saves nothing) opens on the copy after the short wait, its pencil
  // held until the form may open: on the server's word or — with no signal or a stream that died — on a copy holding every recipe
  // of the product's lines. Held means aria-disabled: the pencil keeps its place and the focus, and a tap says why.
  const WAIT_NOTE = 'You can edit it once the latest recipes arrive.';
  const FAILED_NOTE = 'The recipes didn’t load: leave Food cost and come back to edit it.';
  const editButton = () => screen.getByRole('button', { name: 'Edit product' });
  const setOnline = (online: boolean) => {
    vi.stubGlobal('navigator', { ...navigator, onLine: online });
    act(() => { window.dispatchEvent(new Event(online ? 'online' : 'offline')); });
  };

  it('(v) ⚠️ a copy of the recipes older than the recipe on its line (slow Wi-Fi): read only after the short wait, the pencil held', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    // The server's answer is held back; the browser's own copy, which has never heard of «Dough», comes first.
    fake.holdRecipes([]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderFoodcost('/food-cost/product/Loaf', { source: fake });
    // React holds a revealed section back for a few hundred ms of its own: let the product's screen mount first.
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(COPY_WAIT_MS * 3); });
    // Nothing is costed without its recipe, which would open the FORM: it is read, and the pencil says why it is held.
    expect(editButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(WAIT_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Name' })).not.toBeInTheDocument();

    vi.useRealTimers();
    act(() => { fake.releaseRecipes(); });
    await waitFor(() => { expect(editButton()).not.toHaveAttribute('aria-disabled', 'true'); });
    expect(screen.queryByText(WAIT_NOTE)).not.toBeInTheDocument();
    expect(rowOf(cardNamed('Made of'), 'Dough')).toHaveTextContent('1.00 kg');
  });

  it('(vi) …a copy holding every recipe (a loss may have changed since): read on the copy after the short wait, the pencil held', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdRecipes([DOUGH]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(COPY_WAIT_MS); });
    // Read on the copy, converted with it.
    expect(rowOf(cardNamed('Made of'), 'Dough')).toHaveTextContent('1.00 kg');
    const held = editButton();
    expect(held).toHaveAttribute('aria-disabled', 'true');
    expect(held).toHaveAccessibleDescription(WAIT_NOTE);

    vi.useRealTimers();
    // A tap on the held pencil opens nothing, and says why in the status line.
    await user.click(held);
    expect(screen.queryByRole('combobox', { name: 'Name' })).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getAllByRole('status').some(node => node.textContent?.includes(WAIT_NOTE))).toBe(true); });
    act(() => { fake.releaseRecipes(); });
    // The server's word frees the SAME button: a tap that came before swallows nothing, and the focus never moves.
    await waitFor(() => { expect(held).not.toHaveAttribute('aria-disabled', 'true'); });
    await user.click(held);
    expect(await screen.findByRole('combobox', { name: 'Name' }, LOAD)).toBeInTheDocument();
  });

  it('(vii) …it never hangs: a recipes stream that died reads it on what this phone has, the pencil held for a missing recipe', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.refuse.recipes = true;
    renderFoodcost('/food-cost/product/Loaf', { source: fake });
    // No copy of «Dough» at all: nothing costed, which would open the form — it is read, the pencil held. Nothing listens
    // again until a new visit, so the sentence says that, not «once they arrive».
    const held = await pencil();
    expect(held).toHaveAttribute('aria-disabled', 'true');
    expect(held).toHaveAccessibleDescription(FAILED_NOTE);
    expect(screen.queryByText(WAIT_NOTE)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('(vii) …and a stream that dies after a copy holding every recipe opens the form on that copy, all there will be', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdRecipes([DOUGH]);
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    expect(await pencil()).toHaveAttribute('aria-disabled', 'true');
    act(() => { fake.failRecipes(); });
    await waitFor(() => { expect(editButton()).not.toHaveAttribute('aria-disabled', 'true'); });
    await intoForm(user);
  });

  it('(viii) …nor with no signal: a copy holding every recipe of its lines opens at once', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdRecipes([DOUGH]);
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    await intoForm(user);
  });

  it('(viii) ⚠️ …but a copy missing a recipe of its lines is only read: saved offline, that line would lose nothing for ever', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdRecipes([]);
    renderFoodcost('/food-cost/product/Loaf', { source: fake });
    expect(await pencil()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(WAIT_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('(ix) nothing typed is lost when the signal comes back before the server has answered (P20)', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdRecipes([DOUGH]);
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    await intoForm(user);
    const name = screen.getByRole('combobox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Loaf typed offline');
    setOnline(true);
    expect(screen.getByRole('combobox', { name: 'Name' })).toBe(name);
    expect(name).toHaveValue('Loaf typed offline');
  });

  it('(x) the signal going after the product opened frees the pencil, on a copy holding every recipe', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdRecipes([DOUGH]);
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    const button = await pencil();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    setOnline(false);
    await waitFor(() => { expect(button).not.toHaveAttribute('aria-disabled', 'true'); });
    await user.click(button);
    expect(await screen.findByRole('combobox', { name: 'Name' }, LOAD)).toBeInTheDocument();
  });

  it('(xi) a pencil held again (the signal back, the server not heard yet) keeps the focus', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    fake.holdRecipes([DOUGH]);
    renderFoodcost('/food-cost/product/Loaf', { source: fake });
    const button = await pencil();
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
    act(() => { button.focus(); });
    setOnline(true);
    await waitFor(() => { expect(button).toHaveAttribute('aria-disabled', 'true'); });
    expect(button).toHaveFocus();
  });

  it('(ii) reads the line in RAW kilos, with the raw weight, the cooked weight and the loss of the product', async () => {
    renderFoodcost('/food-cost/product/Loaf', { source: editorSource([LEGACY], { recipes: [DOUGH] }) });
    await pencil();
    const made = cardNamed('Made of');
    // The line is the converted one, never the 0.9 kg stored: 0.9 kg of a dough that loses 10% was ONE kilo raw — the round
    // weight a person typed, never «999.99 g» (the conversion takes the roundest weight that keeps the cost).
    expect(rowOf(made, 'Dough')).toHaveTextContent('1.00 kg');
    expect(rowOf(made, 'Dough')).not.toHaveTextContent('900.00 g');
    // The weighings are written in grams, as they are typed.
    expect(rowOf(made, 'Raw dough')).toHaveTextContent('1000.00 g');
    expect(rowOf(made, 'Cooked dough')).toHaveTextContent('900.00 g');
    expect(rowOf(made, 'Oven loss')).toHaveTextContent('10.00%');
  });

  it('(iii)(iv) Save without changes writes model 3 with the raw kilos and the cooked weight, no flag, no margin point, and the cost does not move', async () => {
    const fake = editorSource([LEGACY], { recipes: [DOUGH] });
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    await pencil();
    const costBefore = screen.getByRole('group', { name: 'Production cost' }).textContent;
    await user.click(screen.getByRole('button', { name: 'Edit product' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }, LOAD));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Save' }));
    await screen.findByText('Product saved.');

    const now = converted();
    expect(fake.saved.map(write => write.kind)).toEqual(['product']);
    expect(fake.saved[0]).toMatchObject({ snapshot: null, data: { model: 3, components: now.components, cookedGrams: now.cookedGrams } });
    expect(fake.saved[0]?.data).not.toHaveProperty('noWeightLoss');
    expect(fake.saved[0]?.data).not.toHaveProperty('rawGrams');

    // Back on the read view of what was saved (a model 3 product now): the same cost.
    await pencil();
    expect(screen.getByRole('group', { name: 'Production cost' }).textContent).toBe(costBefore);
  });
});

describe('the cooking of a model 3 product, read', () => {
  it('(d) a cooked weight heavier than the raw one shows the red warning and no «Oven loss» row', async () => {
    const heavy = product('Heavy', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 1200, model: 3 });
    renderFoodcost('/food-cost/product/Heavy', { source: editorSource([heavy], { recipes: [DOUGH] }) });
    await pencil();
    const made = cardNamed('Made of');
    const warning = within(made).getByText('The cooked dough cannot weigh more than the raw dough.');
    expect(within(made).queryByText('Oven loss', { selector: 'dt' })).not.toBeInTheDocument();
    // Spoken, as the weighing pairs' notes it replaces were.
    expect(warning.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('(d) the live region is on the page before the warning, so the warning is announced when a line makes it true', async () => {
    const fine = product('Fine', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 900, model: 3 });
    renderFoodcost('/food-cost/product/Fine', { source: editorSource([fine], { recipes: [DOUGH] }) });
    await pencil();
    const region = cardNamed('Made of').querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
  });

  it('(d) in the form too: the region is there first, and lowering the dough under the cooked weight puts the warning in it', async () => {
    const fine = product('Fine', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 900, model: 3 });
    const { user } = renderFoodcost('/food-cost/product/Fine', { source: editorSource([fine], { recipes: [DOUGH] }) });
    await intoForm(user);
    const made = cardNamed('Made of');
    const region = rowOf(made, 'Cooked dough').closest('dl')?.parentElement?.querySelector('[aria-live="polite"]');
    expect(region).toBeInstanceOf(HTMLElement);
    expect(region).toBeEmptyDOMElement();
    const box = within(made).getByRole('textbox', { name: 'Quantity' });
    await user.clear(box);
    await user.type(box, '0.5');
    expect(region).toHaveTextContent('The cooked dough cannot weigh more than the raw dough.');
  });

  it('(d) a product with recipe lines and no cooked weight says «No oven loss.»', async () => {
    const plain = product('Plain', { components: [{ recipeId: 'Dough', qtyKg: 1 }], model: 3 });
    renderFoodcost('/food-cost/product/Plain', { source: editorSource([plain], { recipes: [DOUGH] }) });
    await pencil();
    expect(cardNamed('Made of')).toHaveTextContent('No oven loss.');
  });
});
