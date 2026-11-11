import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { halfPricedRecipe, editorSource, intoForm, recipe, unpricedRecipe, SALT, INACTIVE } from '../testing/foodcostEditorFixtures';
import { bareProduct, FLOUR, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// The lines of a product: the chooser, the notes under each line, the name's suggestions and packaging.
// (The per-recipe weighings and the «no weight loss» switch left the product editor with product model 3.)

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const saveBar = () => screen.getByRole('button', { name: 'Save' });
const question = () => screen.findByRole('alertdialog', undefined, LOAD);
const suggestions = () => screen.queryByRole('listbox', { name: 'Recipes to base this product on' });
const suggested = () => within(screen.getByRole('listbox', { name: 'Recipes to base this product on' })).getAllByRole('option');
const nameBox = () => screen.getByRole('combobox', { name: 'Name' });
const chooser = () => screen.findByRole('dialog', undefined, LOAD);
const madeOf = () => screen.getByRole('region', { name: 'Made of' });
const packaging = () => screen.getByRole('region', { name: 'Packaging' });

async function confirmSave(user: UserEvent) {
  await user.click(within(await question()).getByRole('button', { name: 'Save' }));
}

async function open(path: string, fake: ReturnType<typeof editorSource>, options = {}) {
  const view = renderFoodcost(path, { source: fake, ...options });
  await intoForm(view.user);
  return { ...view, fake };
}

const optionNames = (dialog: HTMLElement) => within(dialog).getAllByRole('listitem').map(item => item.textContent);

describe('the chooser', () => {
  const fake = () => editorSource([product('Green')], { recipes: [recipe('Dough'), recipe('Brioche')] });

  it('opens on recipes while the product is made of nothing, and on both once there is a line', async () => {
    const empty = await open('/food-cost/new', fake());
    expect(within(madeOf()).getByRole('button', { name: '+ Add recipe' })).toBeInTheDocument();
    await empty.user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe' }));
    const recipesOnly = await chooser();
    expect(within(recipesOnly).getByRole('heading', { level: 2, name: 'Choose a recipe' })).toBeInTheDocument();
    expect(optionNames(recipesOnly)).toEqual(['Brioche', 'Dough']);
    expect(within(recipesOnly).queryByRole('heading', { name: 'Ingredients' })).not.toBeInTheDocument();
  });

  it('offers recipes and ingredients, with headings, no price and never packaging', async () => {
    const { user } = await open('/food-cost/product/Green', fake());
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' }));
    const dialog = await chooser();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Add to the product' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Recipes' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Ingredients' })).toBeInTheDocument();
    // A recipe says so; an ingredient says the pack it comes in; nothing says what it costs.
    expect(optionNames(dialog)).toEqual(['BriocheRecipe', 'DoughRecipe', 'Flour', 'Salt1 kg']);
    expect(dialog).not.toHaveTextContent('£');
    expect(within(dialog).queryByText('Box')).not.toBeInTheDocument();
  });

  it('searches by what is typed, accents and capitals aside', async () => {
    const { user } = await open('/food-cost/product/Green', fake());
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' }));
    const dialog = await chooser();
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search…' }), 'BRI');
    expect(optionNames(dialog)).toEqual(['BriocheRecipe']);
    await user.clear(within(dialog).getByRole('searchbox'));
    await user.type(within(dialog).getByRole('searchbox'), 'zzz');
    expect(within(dialog).getByText('Nothing matches your search.')).toBeInTheDocument();
  });

  it('adds the line chosen and puts the focus in its quantity', async () => {
    const { user } = await open('/food-cost/product/Green', fake());
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' }));
    await user.click(within(await chooser()).getByRole('button', { name: /^Salt/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(madeOf()).getByRole('button', { name: 'Change: Salt' })).toBeInTheDocument();
    const boxes = within(madeOf()).getAllByRole('textbox', { name: 'Quantity' });
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toHaveFocus();
    expect(boxes[1]).toHaveValue('');
  });

  it('closes with nothing chosen on Escape, and gives the focus back to the button that opened it', async () => {
    const { user } = await open('/food-cost/product/Green', fake());
    const add = within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' });
    await user.click(add);
    await chooser();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(within(madeOf()).getAllByRole('textbox', { name: 'Quantity' })).toHaveLength(1);
    await vi.waitFor(() => { expect(add).toHaveFocus(); });
  });

  it('closes with nothing chosen on its Back', async () => {
    const { user } = await open('/food-cost/product/Green', fake());
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' }));
    await user.click(within(await chooser()).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(madeOf()).getAllByRole('textbox', { name: 'Quantity' })).toHaveLength(1);
  });

  it('points a line at something else of its own kind', async () => {
    const { user } = await open('/food-cost/product/Green', fake());
    await user.click(within(madeOf()).getByRole('button', { name: 'Change: Flour' }));
    const dialog = await chooser();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Choose an ingredient' })).toBeInTheDocument();
    expect(optionNames(dialog)).toEqual(['Flour', 'Salt1 kg']);
    await user.click(within(dialog).getByRole('button', { name: /^Salt/ }));
    expect(within(madeOf()).getByRole('button', { name: 'Change: Salt' })).toBeInTheDocument();
    expect(within(madeOf()).queryByRole('button', { name: 'Change: Flour' })).not.toBeInTheDocument();
  });

  it('puts an ingredient switched off LAST under «Not in use», after the recipes and the others, and picks it (3e-5b)', async () => {
    const stale = { id: 'sugar', name: 'Sugar', active: false, unit: 'kg', weight: '5 kg' };
    const source = editorSource([product('Green')], { recipes: [recipe('Dough')], ingredients: [FLOUR, SALT, stale, INACTIVE] });
    const { user } = await open('/food-cost/product/Green', source);
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' }));
    const dialog = await chooser();
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['Recipes', 'Ingredients', 'Not in use']);
    const section = within(dialog).getByRole('heading', { level: 3, name: 'Not in use' }).closest('section') as HTMLElement;
    expect(within(section).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Sugar5 kg · Not in use']);
    await user.click(within(section).getByRole('button', { name: /^Sugar/ }));
    expect(within(madeOf()).getByRole('button', { name: 'Change: Sugar' })).toBeInTheDocument();
  });

  it('says there are no recipes yet, and no packaging yet', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { ingredients: [] }));
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe' }));
    expect(await within(await chooser()).findByText('No recipes yet — add them in the Recipe book.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await user.click(within(packaging()).getByRole('button', { name: '+ Add packaging' }));
    expect(await within(await chooser()).findByText(/^No packaging yet/)).toBeInTheDocument();
  });
});

describe('packaging', () => {
  it('offers packaging, flags what is not priced by the piece, and puts what is inactive LAST under «Not in use»', async () => {
    const { user } = await open('/food-cost/product/Green', editorSource([product('Green')]));
    await user.click(within(packaging()).getByRole('button', { name: '+ Add packaging' }));
    const dialog = await chooser();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Choose packaging' })).toBeInTheDocument();
    expect(optionNames(dialog)).toEqual(['Box£0.25 each', 'Ribbonpriced by weight', 'Tissuenot priced', 'Old tinnot priced · Not in use']);
    const headings = within(dialog).getAllByRole('heading', { level: 3 });
    expect(headings.map(node => node.textContent)).toEqual(['Not in use']);
    const section = headings[0]!.closest('section') as HTMLElement;
    expect(within(section).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Old tinnot priced · Not in use']);
    await user.click(within(section).getByRole('button', { name: /^Old tin/ }));
    expect(within(packaging()).getByRole('button', { name: /Old tin/ })).toBeInTheDocument();
  });

  it('adds a line counted in pieces per unit sold, and says what that line costs', async () => {
    const { user } = await open('/food-cost/product/Green', editorSource([product('Green')]));
    expect(within(packaging()).queryByText(/^Quantity/)).not.toBeInTheDocument();
    await user.click(within(packaging()).getByRole('button', { name: '+ Add packaging' }));
    await user.click(within(await chooser()).getByRole('button', { name: /^Box/ }));

    const pieces = within(packaging()).getByRole('textbox', { name: 'Pieces' });
    expect(pieces).toHaveFocus();
    expect(within(packaging()).getByText('Quantity per piece')).toBeInTheDocument();
    await user.type(pieces, '2');
    expect(within(packaging()).getByText('£0.25 each · this amount £0.50')).toBeInTheDocument();
    // The packaging adds to the cost of every piece sold: £0.20 + 2 × £0.25.
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('£0.70per piece');
  });

  it('says plainly that packaging priced by weight cannot be counted in pieces', async () => {
    await open('/food-cost/product/Green', editorSource([product('Green', { packaging: [{ ingredientId: 'ribbon', qtyPcs: 1 }] })]));
    expect(within(packaging()).getByText(/^Priced by weight/)).toBeInTheDocument();
  });

  it('removes a line with its bin, and only on the copy until Save', async () => {
    const { user, fake } = await open('/food-cost/product/Green', editorSource([product('Green', { packaging: [{ ingredientId: 'box', qtyPcs: 1 }] })]));
    await user.click(within(packaging()).getByRole('button', { name: 'Remove packaging item' }));
    expect(within(packaging()).queryByRole('textbox', { name: 'Pieces' })).not.toBeInTheDocument();
    expect(fake.saved).toEqual([]);
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect((fake.saved[0]?.data as { packaging: unknown[] }).packaging).toEqual([]);
  });
});

describe('the notes under a line', () => {
  it('keep their money out: it has its own line above the note (the rate and what the amount costs)', async () => {
    await open('/food-cost/product/Mixed', editorSource([product('Mixed', { components: [
      { recipeId: 'Dough', qtyKg: 1 },
      { kind: 'ingredient', ingredientId: 'flour', qty: 200, unit: 'g' },
    ] })], { recipes: [recipe('Dough')] }));
    // A kilo of Dough is £2.00 a kilo, 200 g of flour £0.40: both fully priced, so no note stands under them.
    expect(within(madeOf()).getByText('£2.00/kg · this amount £2.00')).toBeInTheDocument();
    expect(within(madeOf()).getByText('£2.00/kg · this amount £0.40')).toBeInTheDocument();
    expect(madeOf()).not.toHaveTextContent(/priced|exist/i);
  });

  it('say what stops a line being costed', async () => {
    await open('/food-cost/product/Gaps', editorSource([product('Gaps', { components: [
      { recipeId: 'Ghost', qtyKg: 1 },
      { recipeId: 'Half', qtyKg: 1 },
      { recipeId: 'Missing', qtyKg: 1 },
      { kind: 'ingredient', ingredientId: 'salt', qty: 10, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'nothing', qty: 10, unit: 'g' },
    ] })], { recipes: [unpricedRecipe('Ghost'), halfPricedRecipe('Half')] }));
    const region = madeOf();
    // «No price» is said ONCE, in the money line: the note that said the same thing is gone.
    expect(within(region).getAllByText('— No price')).toHaveLength(2);
    expect(within(region).queryByText('This recipe is not priced yet')).not.toBeInTheDocument();
    expect(within(region).queryByText('This ingredient has no price yet')).not.toBeInTheDocument();
    expect(within(region).getByText('Only part of this recipe has a price')).toBeInTheDocument();
    expect(within(region).getByText('£2.00/kg · this amount £2.00 · not exact yet')).toBeInTheDocument();
    // A recipe and an item that are gone name themselves so, on the button and in the note.
    expect(within(region).getByRole('button', { name: 'Change: This recipe no longer exists' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Change: This item no longer exists' })).toBeInTheDocument();
    expect(within(region).getByText('This item no longer exists', { selector: 'p' })).toBeInTheDocument();
  });

  it('explain an ingredient counted in pieces that has no weight or price', async () => {
    await open('/food-cost/product/Eggs', editorSource([product('Eggs', { components: [
      { kind: 'ingredient', ingredientId: 'flour', qty: 3, unit: 'pcs' },
    ] })]));
    expect(within(madeOf()).getByText(/^Bought by weight — say what one piece weighs/)).toBeInTheDocument();
  });
});

describe('typing a quantity', () => {
  it('never rebuilds its own row: it is the same box, with the focus, after every key', async () => {
    const { user } = await open('/food-cost/product/Green', editorSource([product('Green')]));
    const box = within(madeOf()).getByRole('textbox', { name: 'Quantity' });
    await user.clear(box);
    await user.type(box, '12.5');
    expect(within(madeOf()).getByRole('textbox', { name: 'Quantity' })).toBe(box);
    expect(box).toHaveFocus();
    expect(box).toHaveValue('12.5');
    // …and the answers followed: 12.5 g of flour at £2.00 a kilo is £0.025 a batch of ten.
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('< £0.01per piece');
  });

  it('keeps the other rows standing when one above them is removed', async () => {
    const { user } = await open('/food-cost/product/Two', editorSource([product('Two', { components: [
      { kind: 'ingredient', ingredientId: 'flour', qty: 100, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'salt', qty: 5, unit: 'g' },
    ] })]));
    const [first, second] = within(madeOf()).getAllByRole('textbox', { name: 'Quantity' });
    await user.click(within(madeOf()).getAllByRole('button', { name: 'Remove ingredient' })[0] as HTMLElement);
    const [left] = within(madeOf()).getAllByRole('textbox', { name: 'Quantity' });
    expect(left).toBe(second);
    expect(first).not.toBeInTheDocument();
    expect(left).toHaveValue('5');
  });

  it('changes the unit of an ingredient line', async () => {
    const { user } = await open('/food-cost/product/Green', editorSource([product('Green')]));
    await user.selectOptions(within(madeOf()).getByRole('combobox', { name: 'Unit' }), 'kg');
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('£200.00per piece');
  });

  it('offers grams or kilos on a recipe line, opened on grams; packaging is pieces, with no unit to choose', async () => {
    await open('/food-cost/product/Dough', editorSource([product('Dough', {
      components: [{ recipeId: 'Dough', qtyKg: 1 }], packaging: [{ ingredientId: 'box', qtyPcs: 1 }],
    })], { recipes: [recipe('Dough')] }));
    const unit = within(madeOf()).getByRole('combobox', { name: 'Unit' });
    expect(within(unit).getAllByRole('option').map(option => option.textContent)).toEqual(['g', 'kg']);
    expect(unit).toHaveValue('g');
    expect(within(madeOf()).getByRole('textbox', { name: 'Quantity' })).toHaveValue('1000');
    expect(within(packaging()).queryByRole('combobox', { name: 'Unit' })).not.toBeInTheDocument();
  });
});

describe('the name suggests recipes', () => {
  const recipes = [recipe('Dough'), recipe('Donut')];

  it('offers them from two letters while «Made of» is empty, and a tap names the product', async () => {
    const fake = editorSource([product('Other', { components: [{ recipeId: 'Dough', qtyKg: 1 }] })], { recipes });
    const { user } = await open('/food-cost/new', fake);
    await user.type(nameBox(), 'D');
    expect(suggestions()).not.toBeInTheDocument();
    await user.type(nameBox(), 'o');
    expect(suggested().map(option => option.textContent)).toEqual(['Donut', 'Dough']);

    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dough' }));
    expect(nameBox()).toHaveValue('Dough');
    expect(suggestions()).not.toBeInTheDocument();
    const line = within(madeOf()).getByRole('button', { name: 'Change: Dough' });
    expect(line).toBeInTheDocument();
    expect(within(madeOf()).getByRole('textbox', { name: 'Quantity' })).toHaveFocus();
    // Said, never prevented: another product already uses it.
    expect(screen.getByText('“Dough” is already in another product.')).toBeInTheDocument();
  });

  it('is picked with the arrows and Enter', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { recipes }));
    await user.type(nameBox(), 'do');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dough' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(nameBox()).toHaveValue('Dough');
  });

  it('is closed with Escape, and by leaving the box', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { recipes }));
    await user.type(nameBox(), 'do');
    expect(suggested()).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(suggestions()).not.toBeInTheDocument();

    await user.type(nameBox(), 'u');
    expect(suggested()).toHaveLength(1);
    await user.tab();
    expect(suggestions()).not.toBeInTheDocument();
  });

  it('is not offered once the product is made of something', async () => {
    const { user } = await open('/food-cost/product/Green', editorSource([product('Green')], { recipes }));
    await user.clear(nameBox());
    await user.type(nameBox(), 'Dou');
    expect(suggestions()).not.toBeInTheDocument();
  });

  it('offers «See all» past five, and opens the chooser already searching', async () => {
    const many = Array.from({ length: 7 }, (_, index) => recipe(`Loaf ${index + 1}`));
    const { user } = await open('/food-cost/new', editorSource([], { recipes: many }));
    await user.type(nameBox(), 'loaf');
    expect(suggested()).toHaveLength(6);
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'See all (7)' }));

    const dialog = await chooser();
    expect(within(dialog).getByRole('searchbox')).toHaveValue('loaf');
    expect(optionNames(dialog)).toHaveLength(7);
    await user.click(within(dialog).getByRole('button', { name: 'Loaf 3' }));
    expect(nameBox()).toHaveValue('Loaf 3');
    expect(within(madeOf()).getByRole('button', { name: 'Change: Loaf 3' })).toBeInTheDocument();
  });

  it('says nothing when no other product uses the recipe', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { recipes }));
    await user.type(nameBox(), 'dough');
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dough' }));
    expect(screen.queryByText(/is already in/)).not.toBeInTheDocument();
  });
});

describe('a bare new product', () => {
  it('adds a recipe line, and the answer asks for the rest', async () => {
    const { user } = await open('/food-cost/new', editorSource([bareProduct('x')], { recipes: [recipe('Dough')] }));
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe' }));
    await user.click(within(await chooser()).getByRole('button', { name: 'Dough' }));
    // A new recipe line is in grams: 1000 g is the one kilo of the recipe.
    await user.type(within(madeOf()).getByRole('textbox', { name: 'Quantity' }), '1000');
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('£2.00whole batch');
    expect(screen.getByRole('group', { name: 'Food cost' })).toHaveTextContent('Choose whether this is sold by the piece, by weight or by the pack');
  });
});

// ⚠️ A RECIPE LINE OPENS IN GRAMS, THE g/kg SWITCH KEEPS THE TYPED NUMBER, AND 20 BATCHES WARN (current app a7f4c75d,
// 8 Nov 2026; tests/foodcost-line-units-and-switch.test.mjs). Production had 16 lines in 11 products with grams typed into a
// box that opened on kilos — every cost ×1000. The line is still STORED in kilos.
describe('a recipe line in grams', () => {
  const qtyBox = () => within(madeOf()).getByRole('textbox', { name: 'Quantity' });
  const unitSelect = () => within(madeOf()).getByRole('combobox', { name: 'Unit' });
  const doughWith = (qtyKg: number) => editorSource(
    [product('Dough', { components: [{ recipeId: 'Dough', qtyKg }] })],
    { recipes: [recipe('Dough')] },
  );
  const savedLines = (fake: ReturnType<typeof editorSource>) =>
    (fake.saved[0]?.data as { components: { recipeId: string; qtyKg: number }[] }).components;

  async function save(user: UserEvent) {
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
  }

  it('a stored 3.233 kg opens as «3233» g, and an untouched save keeps the kilos', async () => {
    const { user, fake } = await open('/food-cost/product/Dough', doughWith(3.233));
    expect(qtyBox()).toHaveValue('3233');
    expect(unitSelect()).toHaveValue('g');
    await user.type(nameBox(), '!');
    await save(user);
    expect(savedLines(fake)).toEqual([{ recipeId: 'Dough', qtyKg: 3.233 }]);
  });

  it('522 typed in grams is stored as 0.522 kg — never float noise', async () => {
    const { user, fake } = await open('/food-cost/product/Dough', doughWith(1));
    await user.clear(qtyBox());
    await user.type(qtyBox(), '522');
    await save(user);
    expect(savedLines(fake)).toEqual([{ recipeId: 'Dough', qtyKg: 0.522 }]);
  });

  it('switching g → kg keeps «522» in the box and stores 522 kg; the form has a change to save', async () => {
    const { user, fake } = await open('/food-cost/product/Dough', doughWith(0.522));
    expect(qtyBox()).toHaveValue('522');
    await user.selectOptions(unitSelect(), 'kg');
    expect(qtyBox(), 'the box is never rewritten by a switch').toHaveValue('522');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(within(await question()).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(await question()).getByRole('button', { name: 'Cancel' }));
    await save(user);
    expect(savedLines(fake)).toEqual([{ recipeId: 'Dough', qtyKg: 522 }]);
  });

  it('switching the unit of an EMPTY box changes nothing stored, so nothing is asked on Back', async () => {
    const { user, router } = await open('/food-cost/product/Dough', doughWith(0));
    expect(qtyBox()).toHaveValue('');
    await user.selectOptions(unitSelect(), 'kg');
    expect(unitSelect()).toHaveValue('kg');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('warns under the line, first, when it asks for more than 20 whole batches — a note, never a block', async () => {
    // The recipe makes 1 kg (1000 g of flour, no loss); 522 kg is grams typed as kilos.
    const { user, fake } = await open('/food-cost/product/Dough', doughWith(0.522));
    expect(within(madeOf()).queryByText(/but the recipe makes/)).not.toBeInTheDocument();
    await user.selectOptions(unitSelect(), 'kg');
    expect(within(madeOf()).getByText('522.00 kg, but the recipe makes 1.00 kg: did you mean 522.00 g?')).toBeInTheDocument();
    await save(user);
    expect(savedLines(fake), 'Save is not blocked').toEqual([{ recipeId: 'Dough', qtyKg: 522 }]);
  });

  it('the warning comes FIRST, then the partly-priced note, in one note under the line', async () => {
    // The half-priced recipe makes 1.02 kg (1000 g of flour and 20 g of salt); 522 kg is far beyond 20 batches.
    const { user } = await open('/food-cost/product/Half', editorSource(
      [product('Half', { components: [{ recipeId: 'Half', qtyKg: 0.522 }] })],
      { recipes: [halfPricedRecipe('Half')] },
    ));
    await user.selectOptions(unitSelect(), 'kg');
    expect(within(madeOf()).getByText(/but the recipe makes/))
      .toHaveTextContent(/^522\.00 kg, but the recipe makes 1\.02 kg: did you mean 522\.00 g\? Only part of this recipe has a price$/);
  });

  it('exactly 20 whole batches is a real order: no warning', async () => {
    await open('/food-cost/product/Dough', doughWith(20));
    expect(qtyBox()).toHaveValue('20000');
    expect(within(madeOf()).queryByText(/but the recipe makes/)).not.toBeInTheDocument();
  });

  it('the warning in Italian, with the venue\'s decimal comma', async () => {
    const { user } = renderFoodcost('/food-cost/product/Dough', {
      source: doughWith(522), lang: 'it', session: { language: 'it', location: { country: 'IT' } },
    });
    await intoForm(user);
    expect(within(screen.getByRole('region', { name: 'Composto da' }))
      .getByText('522,00 kg, ma la ricetta ne fa 1,00 kg: intendevi 522,00 g?')).toBeInTheDocument();
  });
});
