import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { FROM_RECIPE_LINK } from '@mise/shared/recipe-link';
import { editorSource, halfPricedRecipe, intoForm, recipe } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// Step 2b: the product's own «Cottura» boxes (Federico, 10 Nov 2026: «il calo è del prodotto»). The raw box follows the lines' total
// until a weight is typed apart; the cooked box empty is «no loss»; a heavier cooked weight is kept, in red, and never blocks Save;
// a product made of ONE recipe writes that recipe's weighing too, only when somebody typed here. The pure rules are in
// productEditorModel.spec.ts; the model is in shared/src/foodcost-product-loss.spec.ts.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// A recipe of one kilo of flour (£2.00 a kilo raw), with and without an oven loss.
const DOUGH = recipe('Dough');
const LOSSY = recipe('Dough', { lossPct: 10 });
// A product of one kilo of that dough, saved by Mise 2 (model 3): its line is RAW kilos, and it has not been weighed.
const LOAF = product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], model: 3 });
// The same product as the current app saved it (model 2): still costed through the recipe's loss.
const ROLL = product('Roll', { components: [{ recipeId: 'Dough', qtyKg: 0.9 }], model: 2 });

const baking = () => screen.getByRole('region', { name: 'Baking' });
const rawBox = () => within(baking()).getByRole('textbox', { name: 'Raw dough' });
const cookedBox = () => within(baking()).getByRole('textbox', { name: 'Cooked dough' });
const useTotal = () => within(baking()).queryByRole('button', { name: /^use the total/ });
// The result line is the <p>, the warning region the <div>: both polite.
const result = () => baking().querySelector('p[aria-live="polite"]') as HTMLElement;
const notes = () => baking().querySelector('div[aria-live="polite"]') as HTMLElement;

async function type(user: UserEvent, box: HTMLElement, text: string) {
  await user.clear(box);
  if (text !== '') await user.type(box, text);
}

async function pressSave(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  return screen.findByRole('alertdialog', undefined, LOAD);
}

async function save(user: UserEvent) {
  const dialog = await pressSave(user);
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await screen.findByText(/^Product (saved|added)\.$/, undefined, LOAD);
}

async function openLoaf(options: Parameters<typeof renderFoodcost>[1] = {}, products = [LOAF], recipes = [DOUGH]) {
  const fake = editorSource(products, { recipes });
  const view = renderFoodcost('/food-cost/product/Loaf', { source: fake, ...options });
  await intoForm(view.user);
  return { ...view, fake };
}

const savedProduct = (fake: { saved: { kind: string; data?: unknown; snapshot?: unknown }[] }) => {
  const write = fake.saved.find(entry => entry.kind === 'product');
  if (!write) throw new Error('no product was saved');
  return write;
};
const lossWrites = (fake: { saved: { kind: string }[] }) => fake.saved.filter(entry => entry.kind === 'loss');

describe('the boxes and the result line', () => {
  it('(a) show the lines’ total in the raw box and no loss for a product that was not weighed', async () => {
    await openLoaf();
    expect(rawBox()).toHaveValue('1000');
    expect(cookedBox()).toHaveValue('');
    expect(cookedBox()).toHaveAttribute('placeholder', '—');
    expect(result()).toHaveTextContent('No oven loss: 1 kg costs £2.00');
    expect(useTotal()).toBeNull();
  });

  it('(b) typing the cooked weight puts the loss in the result line, live; emptying it takes the loss away', async () => {
    const { user } = await openLoaf();
    await type(user, cookedBox(), '900');
    expect(result()).toHaveTextContent('Oven loss 10.00% · 1 kg cooked costs £2.22');
    await type(user, cookedBox(), '');
    expect(result()).toHaveTextContent('No oven loss: 1 kg costs £2.00');
  });

  it('(c) a raw weight typed apart counts, and the raw box follows the lines while nothing is typed', async () => {
    const { user } = await openLoaf();
    await type(user, cookedBox(), '900');
    await type(user, rawBox(), '2000');
    // 450 g come out of a dough made double: £2.00 ÷ 0.45 kg.
    expect(result()).toHaveTextContent('Oven loss 55.00% · 1 kg cooked costs £4.44');
    await user.click(within(baking()).getByRole('button', { name: /^use the total/ }));
    const line = within(screen.getByRole('region', { name: 'Made of' })).getByRole('textbox', { name: 'Quantity' });
    await type(user, line, '2000');
    // Following the total, live: the box shows the new total without being touched.
    expect(rawBox()).toHaveValue('2000');
    expect(result()).toHaveTextContent('Oven loss 55.00% · 1 kg cooked costs £4.44');
  });

  it('(d) «use the total» shows only past 0.05 g, brings the total back and gives the focus to the raw box', async () => {
    const { user } = await openLoaf();
    await type(user, rawBox(), '1000.04');
    expect(useTotal()).toBeNull();
    await type(user, rawBox(), '1000.2');
    const button = await within(baking()).findByRole('button', { name: 'use the total (1000.00 g)' });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(rawBox()).toHaveValue('1000');
    expect(rawBox()).toHaveFocus();
    expect(useTotal()).toBeNull();
  });

  it('(d) …and never while the lines weigh nothing: a raw weight typed on a product with no lines has no total to go back to', async () => {
    const lineless = product('Loaf', { components: [], model: 3 });
    const { user } = await openLoaf({}, [lineless]);
    await type(user, rawBox(), '500');
    expect(useTotal()).toBeNull();
  });

  it('(e) leaving the raw box empty, or within 0.05 g of the total, goes back to following the total; a real weight stays', async () => {
    const { user } = await openLoaf();
    await type(user, rawBox(), '');
    await user.tab();
    expect(rawBox()).toHaveValue('1000');
    await type(user, rawBox(), '1000.03');
    await user.tab();
    expect(rawBox()).toHaveValue('1000');
    await type(user, rawBox(), '1200');
    await user.tab();
    expect(rawBox()).toHaveValue('1200');
    expect(useTotal()).not.toBeNull();
  });

  it('(f) says «more than» when something on the product has no price', async () => {
    const fake = editorSource([product('Half', { components: [{ recipeId: 'Half', qtyKg: 1 }], model: 3 })], { recipes: [halfPricedRecipe('Half')] });
    const { user } = renderFoodcost('/food-cost/product/Half', { source: fake });
    await intoForm(user);
    expect(result().textContent).toMatch(/^No oven loss: 1 kg costs more than £/);
    await type(user, cookedBox(), '500');
    expect(result().textContent).toMatch(/1 kg cooked costs more than £/);
  });

  it('(g) the polite regions are on the page before they speak', async () => {
    const { user } = await openLoaf();
    expect(notes()).toBeEmptyDOMElement();
    await type(user, cookedBox(), '1200');
    expect(notes()).toHaveTextContent('The cooked dough cannot weigh more than the raw dough.');
    await type(user, cookedBox(), '900');
    expect(notes()).toBeEmptyDOMElement();
  });
});

describe('a cooked weight heavier than the raw one', () => {
  it('(h) shows the warning, turns the cooked box red and leaves the result line empty', async () => {
    const { user } = await openLoaf();
    await type(user, cookedBox(), '1200');
    const warning = within(notes()).getByText('The cooked dough cannot weigh more than the raw dough.');
    expect(cookedBox()).toHaveAttribute('aria-invalid', 'true');
    expect(cookedBox()).toHaveAttribute('data-invalid', 'true');
    expect(cookedBox()).toHaveAccessibleDescription('The cooked dough cannot weigh more than the raw dough.');
    expect(warning.closest('[aria-live="polite"]')).toBe(notes());
    expect(result()).toBeEmptyDOMElement();
    expect(rawBox()).not.toHaveAttribute('aria-invalid');
  });

  it('(i) ⚠️ never blocks the save: Save points at the cooked box and says so, the question names it, one OK keeps the numbers', async () => {
    const { user, fake } = await openLoaf();
    const cooked = cookedBox();
    await type(user, cooked, '1200');
    // Save focuses the cooked box before it asks (the question then takes the focus, and gives it back when it is cancelled).
    const focused = vi.fn();
    cooked.addEventListener('focus', focused);
    const dialog = await pressSave(user);
    expect(focused).toHaveBeenCalled();
    expect(screen.getAllByRole('status').some(node => node.textContent?.includes('Check the baking weights.'))).toBe(true);
    expect(dialog).toHaveTextContent('The cooked dough weighs more than the raw dough.');
    expect(dialog).toHaveTextContent('Save anyway?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(cooked).toHaveFocus(); });
    expect(fake.saved).toEqual([]);
    await save(user);
    expect(savedProduct(fake).data).toMatchObject({ cookedGrams: 1200 });
  });

  it('(j) a pair that is not heavier is asked with the usual question', async () => {
    const { user } = await openLoaf();
    await type(user, cookedBox(), '900');
    const dialog = await pressSave(user);
    expect(dialog).not.toHaveTextContent('Save anyway?');
  });
});

describe('what Save writes', () => {
  it('(k) the weights only with a value: a product that was not weighed carries neither', async () => {
    const { user, fake } = await openLoaf();
    await type(user, cookedBox(), 'x');
    await type(user, cookedBox(), '');
    await user.click(screen.getByRole('combobox', { name: 'Name' }));
    await user.type(screen.getByRole('combobox', { name: 'Name' }), ' 2');
    await save(user);
    const data = savedProduct(fake).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('rawGrams');
    expect(data).not.toHaveProperty('cookedGrams');
    expect(data).toMatchObject({ model: 3 });
  });

  it('(l) typed weights are written as typed, a comma being a decimal point, and a raw weight apart only when it is apart', async () => {
    const { user, fake } = await openLoaf();
    await type(user, cookedBox(), '812,5');
    await type(user, rawBox(), '1200');
    await save(user);
    expect(savedProduct(fake).data).toMatchObject({ rawGrams: 1200, cookedGrams: 812.5 });
  });

  it('(m) ⚠️ a raw weight within 0.05 g of the total counts as the total at SAVE, without the box having lost the focus', async () => {
    const { user, fake } = await openLoaf();
    await type(user, cookedBox(), '900');
    await type(user, rawBox(), '1000.04');
    // ⚠️ A click moves the focus and so blurs the box first; a click event sent straight to the button does not, which is what this proves.
    const box = rawBox();
    expect(box).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Product saved.', undefined, LOAD);
    expect(savedProduct(fake).data).not.toHaveProperty('rawGrams');
    expect(savedProduct(fake).data).toMatchObject({ cookedGrams: 900 });
  });

  it('(n) ⚠️ UNTOUCHED MEANS UNCHANGED: a stored 416.6667 g comes back exactly through a rename, with no margin point', async () => {
    const weighed = product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 416.6667, model: 3 });
    const { user, fake } = await openLoaf({}, [weighed]);
    expect(cookedBox()).toHaveValue('416.7');
    const name = screen.getByRole('combobox', { name: 'Name' });
    await user.type(name, 's');
    await save(user);
    const write = savedProduct(fake);
    expect((write.data as { cookedGrams: number }).cookedGrams).toBe(416.6667);
    expect(write.snapshot).toBeNull();
  });

  it('(o) a changed weight records a margin point (a rename records none: see n)', async () => {
    const { user, fake } = await openLoaf();
    await type(user, cookedBox(), '900');
    await save(user);
    expect(savedProduct(fake).snapshot).not.toBeNull();
  });

  it.each([
    ['cooked', '0', 'Cooked dough'],
    ['cooked', 'abc', 'Cooked dough'],
    ['cooked', '20000000', 'Cooked dough'],
    ['raw', '0', 'Raw dough'],
    ['raw', 'abc', 'Raw dough'],
    ['raw', '20000000', 'Raw dough'],
  ])('(p) a %s weight of «%s» is refused at Save, naming the box', async (which, text, label) => {
    const { user, fake } = await openLoaf();
    const box = which === 'raw' ? rawBox() : cookedBox();
    await type(user, box, text);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getAllByRole('status').some(node => node.textContent?.includes(`Check «${label}»`))).toBe(true);
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(fake.saved).toEqual([]);
    // Typing in it again clears the mark.
    await user.type(box, '1');
    expect(box).not.toHaveAttribute('aria-invalid');
  });
});

describe('a product made of one recipe writes the recipe’s weighing too', () => {
  it('(q) when somebody typed here: the pair goes onto the recipe, with its loss', async () => {
    const { user, fake } = await openLoaf();
    await type(user, cookedBox(), '900');
    await save(user);
    expect(lossWrites(fake)).toEqual([{ kind: 'loss', id: 'Dough', data: { lossPct: 10, rawGrams: 1000, cookedGrams: 900 } }]);
  });

  it('(q) the raw weight typed apart is the recipe’s raw weight', async () => {
    const { user, fake } = await openLoaf();
    await type(user, cookedBox(), '900');
    await type(user, rawBox(), '1200');
    await save(user);
    expect(lossWrites(fake)).toEqual([{ kind: 'loss', id: 'Dough', data: { lossPct: 25, rawGrams: 1200, cookedGrams: 900 } }]);
  });

  it('(r) ⚠️ never when nothing was typed: opening a converted product and saving it must not move the recipe', async () => {
    const weighed = product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 900, model: 3 });
    const { user, fake } = await openLoaf({}, [weighed]);
    await user.type(screen.getByRole('combobox', { name: 'Name' }), 's');
    await save(user);
    expect(lossWrites(fake)).toEqual([]);
  });

  it('(r) …and not when the weight typed was taken out again', async () => {
    const { user, fake } = await openLoaf();
    await type(user, cookedBox(), '900');
    await type(user, cookedBox(), '');
    await save(user);
    expect(lossWrites(fake)).toEqual([]);
  });

  it('(s) not for a product made of a recipe AND something else', async () => {
    const mixed = product('Loaf', {
      components: [{ recipeId: 'Dough', qtyKg: 1 }, { kind: 'ingredient', ingredientId: 'flour', qty: 100, unit: 'g' }],
      model: 3,
    });
    const { user, fake } = await openLoaf({}, [mixed]);
    await type(user, cookedBox(), '900');
    await save(user);
    expect(lossWrites(fake)).toEqual([]);
    expect(savedProduct(fake).data).toMatchObject({ cookedGrams: 900 });
  });

  it('(t) not at a venue that has the catalogue section off: its recipes cannot be written there', async () => {
    const { user, fake } = await openLoaf({ session: { location: { sections: { catalogue: false } } } });
    await type(user, cookedBox(), '900');
    await save(user);
    expect(lossWrites(fake)).toEqual([]);
    expect(savedProduct(fake).data).toMatchObject({ cookedGrams: 900 });
  });

  it('(u) ⚠️ the VENUE’s section decides, not the role’s: the owner of the sales side writes it on a venue with the catalogue', async () => {
    const { user, fake } = await openLoaf({ session: { role: 'owner-sales', canManage: true, isOwner: false } });
    await type(user, cookedBox(), '900');
    await save(user);
    expect(lossWrites(fake)).toHaveLength(1);
  });

  it('(v) says the recipe’s loss changes too when a product saved before the switch still uses it', async () => {
    const { user } = await openLoaf({}, [LOAF, ROLL]);
    expect(within(baking()).queryByText(/loss changes too/)).not.toBeInTheDocument();
    await type(user, cookedBox(), '900');
    expect(within(notes()).getByText('The recipe’s loss changes too: 1 other product still uses it.')).toBeInTheDocument();
  });

  it('(v) …but not for a wrong pair, which only keeps its two numbers, nor when nothing changes the loss', async () => {
    const { user } = await openLoaf({}, [LOAF, ROLL]);
    await type(user, cookedBox(), '1200');
    expect(within(baking()).queryByText(/loss changes too/)).not.toBeInTheDocument();
  });

  it('(v) …nor when the loss stays the same (only the two weights differ)', async () => {
    const same = recipe('Dough', { lossPct: 10, rawGrams: 2000, cookedGrams: 1800 });
    const { user } = await openLoaf({}, [LOAF, ROLL], [same]);
    await type(user, rawBox(), '1000');
    await type(user, cookedBox(), '900');
    expect(result()).toHaveTextContent('Oven loss 10.00%');
    expect(within(baking()).queryByText(/loss changes too/)).not.toBeInTheDocument();
  });

  it('(v) …nor for a product already saved in the new shape', async () => {
    const other = product('Bun', { components: [{ recipeId: 'Dough', qtyKg: 1 }], model: 3 });
    const { user } = await openLoaf({}, [LOAF, other]);
    await type(user, cookedBox(), '900');
    expect(within(baking()).queryByText(/loss changes too/)).not.toBeInTheDocument();
  });
});

describe('in Italian', () => {
  it('(z) says it in the venue’s words, with the plural of the shared-loss note', async () => {
    const fake = editorSource([LOAF, ROLL], { recipes: [DOUGH] });
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake, lang: 'it' });
    await intoForm(user);
    const card = screen.getByRole('region', { name: 'Cottura' });
    const cooked = within(card).getByRole('textbox', { name: 'Impasto cotto' });
    await type(user, cooked, '900');
    // The figures follow the venue’s layout, the words the interface language.
    expect(card.querySelector('p[aria-live="polite"]')).toHaveTextContent(/Calo 10.00% · 1 kg di cotto costa/);
    expect(within(card).getByText('Cambia anche il calo della ricetta: lo usa ancora 1 altro prodotto.')).toBeInTheDocument();
    await type(user, cooked, '1200');
    expect(within(card).getByText('Il cotto non può pesare più del crudo.')).toBeInTheDocument();
  });
});

describe('a recipe that loses weight, on a product nobody has weighed', () => {
  const fromRecipe = () => [
    '/recipes/Dough',
    { pathname: '/food-cost', search: '?recipe=Dough', state: FROM_RECIPE_LINK },
  ];

  it('(w) a NEW product from it says so, shows no loss, and typing the cooked weight replaces the hint with the loss', async () => {
    const { user } = renderFoodcost('/food-cost', { entries: fromRecipe(), source: editorSource([], { recipes: [LOSSY] }) });
    await screen.findByRole('combobox', { name: 'Name' }, LOAD);
    // Nothing pre-filled: no kilos, no cooked weight.
    expect(cookedBox()).toHaveValue('');
    expect(within(notes()).getByText('Dough loses 10.00% in the oven: weigh the cooked dough.')).toBeInTheDocument();
    await type(user, within(screen.getByRole('region', { name: 'Made of' })).getByRole('textbox', { name: 'Quantity' }), '1000');
    expect(result()).toHaveTextContent('No oven loss: 1 kg costs £2.00');
    await type(user, cookedBox(), '900');
    expect(notes()).toBeEmptyDOMElement();
    expect(result()).toHaveTextContent('Oven loss 10.00% · 1 kg cooked costs £2.22');
  });

  it('(w) the hint names the FIRST recipe that loses weight', async () => {
    const second = recipe('Roll', { lossPct: 20 });
    const both = product('Both', {
      components: [{ recipeId: 'Plain', qtyKg: 1 }, { recipeId: 'Roll', qtyKg: 1 }, { recipeId: 'Dough', qtyKg: 1 }],
      model: 3,
    });
    const fake = editorSource([both], { recipes: [recipe('Plain'), second, LOSSY] });
    const { user } = renderFoodcost('/food-cost/product/Both', { source: fake });
    await intoForm(user);
    expect(within(notes()).getByText('Roll loses 20.00% in the oven: weigh the cooked dough.')).toBeInTheDocument();
  });
});

describe('the read view', () => {
  it('(x) shows «Baking» with the cooked weight of a converted product whose recipe line was replaced by an ingredient', async () => {
    const converted = product('Loaf', {
      components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 2, unit: 'kg' }],
      cookedGrams: 1500,
      model: 3,
    });
    const fake = editorSource([converted], { recipes: [DOUGH] });
    const { user } = renderFoodcost('/food-cost/product/Loaf', { source: fake });
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    const card = baking();
    expect(within(card).getByText('Cooked dough', { selector: 'dt' }).parentElement).toHaveTextContent('1500.00 g');
    expect(within(card).getByText('Oven loss', { selector: 'dt' }).parentElement).toHaveTextContent('25.00%');
    // The pencil: the form shows it in the cooked box, and it can be weighed again.
    await intoForm(user);
    expect(cookedBox()).toHaveValue('1500');
    expect(rawBox()).toHaveValue('2000');
    await type(user, cookedBox(), '1600');
    await save(user);
    expect(savedProduct(fake).data).toMatchObject({ cookedGrams: 1600 });
    expect(lossWrites(fake)).toEqual([]);
  });

  it('(x) a product with lines but no weight says «No oven loss.» in its own card', async () => {
    renderFoodcost('/food-cost/product/Loaf', { source: editorSource([LOAF], { recipes: [DOUGH] }) });
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(baking()).toHaveTextContent('No oven loss.');
  });
});

describe('a product converted past ten tonnes', () => {
  // 12 000 kg of dough (grams typed into the old kilo box) that lost 10%: both weights kept a thousand times lighter, the raw one apart.
  const HUGE = product('Loaf', {
    components: [{ recipeId: 'Dough', qtyKg: 12000 }],
    rawGrams: 12000,
    cookedGrams: 10800,
    model: 3,
  });

  it('(y) opens on the stored raw weight, offers «use the total», and keeps the loss it had', async () => {
    await openLoaf({}, [HUGE]);
    expect(rawBox()).toHaveValue('12000');
    expect(cookedBox()).toHaveValue('10800');
    expect(within(baking()).getByRole('button', { name: 'use the total (12000000.00 g)' })).toBeInTheDocument();
    expect(result()).toHaveTextContent('Oven loss 10.00%');
  });

  it('(y) correcting the line to the weight that was meant makes the pair the meant one', async () => {
    const { user, fake } = await openLoaf({}, [HUGE]);
    const line = within(screen.getByRole('region', { name: 'Made of' })).getByRole('textbox', { name: 'Quantity' });
    await type(user, line, '12500');
    // 12.5 kg now, against a raw weight of 12 kg: the total is offered, and taking it makes the loss 13.6%.
    await user.click(await within(baking()).findByRole('button', { name: 'use the total (12500.00 g)' }));
    expect(result()).toHaveTextContent('Oven loss 13.60%');
    await save(user);
    // The tap alone counts as «typed here»: nothing else was typed in «Cottura», yet the recipe gets the pair.
    expect(lossWrites(fake)).toEqual([{ kind: 'loss', id: 'Dough', data: { lossPct: 13.6, rawGrams: 12500, cookedGrams: 10800 } }]);
    const data = savedProduct(fake).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('rawGrams');
    expect(data).toMatchObject({ cookedGrams: 10800 });
  });
});
