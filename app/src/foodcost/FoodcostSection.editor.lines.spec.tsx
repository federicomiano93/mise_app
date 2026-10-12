import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { halfPricedRecipe, editorSource, recipe, unpricedRecipe } from '../testing/foodcostEditorFixtures';
import { bareProduct, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// The lines of a product: the chooser, the notes under each line, the name's suggestions, packaging and
// the weighings.

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
  await screen.findByRole('combobox', { name: 'Name' }, LOAD);
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
  it('offers only packaging, flags what is not priced by the piece, and leaves out what is inactive', async () => {
    const { user } = await open('/food-cost/product/Green', editorSource([product('Green')]));
    await user.click(within(packaging()).getByRole('button', { name: '+ Add packaging' }));
    const dialog = await chooser();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Choose packaging' })).toBeInTheDocument();
    expect(optionNames(dialog)).toEqual(['Box£0.25 each', 'Ribbonpriced by weight', 'Tissuenot priced']);
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
    expect(within(packaging()).getByText('£0.25 each · £0.50')).toBeInTheDocument();
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
  it('carry no money under a recipe or an ingredient', async () => {
    await open('/food-cost/product/Mixed', editorSource([product('Mixed', { components: [
      { recipeId: 'Dough', qtyKg: 1 },
      { kind: 'ingredient', ingredientId: 'flour', qty: 200, unit: 'g' },
    ] })], { recipes: [recipe('Dough')] }));
    expect(madeOf()).not.toHaveTextContent('£');
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
    expect(within(region).getByText('This recipe is not priced yet')).toBeInTheDocument();
    expect(within(region).getByText('Only part of this recipe has a price')).toBeInTheDocument();
    expect(within(region).getByText('This ingredient has no price yet')).toBeInTheDocument();
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
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('£0.0025per piece');
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

  it('treats a recipe as kilos and packaging as pieces: no unit to choose', async () => {
    await open('/food-cost/product/Dough', editorSource([product('Dough', { components: [{ recipeId: 'Dough', qtyKg: 1 }] })], { recipes: [recipe('Dough')] }));
    expect(within(madeOf()).queryByRole('combobox', { name: 'Unit' })).not.toBeInTheDocument();
    expect(within(madeOf()).getByText('kg')).toBeInTheDocument();
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
    expect(within(madeOf()).getByRole('textbox', { name: 'Kilos' })).toHaveFocus();
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

describe('the weighings', () => {
  const DOUGH_PRODUCT = product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }] });

  it('are one raw and cooked pair at the end of «Made of», and only where the catalogue is on', async () => {
    await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], { recipes: [recipe('Dough')] }));
    expect(within(madeOf()).getByRole('textbox', { name: 'Raw dough' })).toHaveValue('1000');
    expect(within(madeOf()).getByRole('textbox', { name: 'Cooked dough' })).toHaveValue('');
    expect(within(madeOf()).getByText('Weight lost in the oven: weigh the baked dough to work it out')).toBeInTheDocument();
    // One recipe: the pair is not titled.
    expect(within(madeOf()).queryByText(/^Dough for/)).not.toBeInTheDocument();
  });

  it('are not offered where the catalogue is off — the save would always be refused', async () => {
    await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], { recipes: [recipe('Dough')] }), {
      session: { location: { sections: { catalogue: false } } },
    });
    expect(within(madeOf()).getByRole('button', { name: 'Change: Dough' })).toBeInTheDocument();
    expect(within(madeOf()).queryByRole('textbox', { name: 'Raw dough' })).not.toBeInTheDocument();
  });

  it('name the recipe when there are several, one pair each however many lines carry it', async () => {
    await open('/food-cost/product/Both', editorSource([product('Both', { components: [
      { recipeId: 'Dough', qtyKg: 1 },
      { recipeId: 'Brioche', qtyKg: 0.5 },
      { recipeId: 'Dough', qtyKg: 0.2 },
    ] })], { recipes: [recipe('Dough'), recipe('Brioche')] }));
    expect(within(madeOf()).getAllByRole('textbox', { name: 'Raw dough' })).toHaveLength(2);
    expect(within(madeOf()).getByText('Dough for «Dough»')).toBeInTheDocument();
    expect(within(madeOf()).getByText('Dough for «Brioche»')).toBeInTheDocument();
  });

  it('change what the product costs, live, before anything is saved', async () => {
    const { user, fake } = await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], { recipes: [recipe('Dough')] }));
    // A kilo of dough made of a kilo of flour: £2.00 a kilo, £0.20 a piece.
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('£0.20per piece');

    await user.type(within(madeOf()).getByRole('textbox', { name: 'Cooked dough' }), '800');
    expect(within(madeOf()).getByText('Weight lost in the oven: 20%')).toBeInTheDocument();
    // 20% lost in the oven: a kilo of flour makes 800 g, so a kilo of dough costs £2.50.
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('£0.25per piece');
    expect(fake.saved).toEqual([]);
  });

  it('are written onto the recipe by Save — and count as a change worth a margin point', async () => {
    const { user, fake } = await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], { recipes: [recipe('Dough')] }));
    await user.type(within(madeOf()).getByRole('textbox', { name: 'Cooked dough' }), '800');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');

    expect(fake.saved.map(write => write.kind)).toEqual(['loss', 'product']);
    expect(fake.saved[0]).toMatchObject({ kind: 'loss', id: 'Dough', data: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } });
    // Nothing else about the product changed, yet the weighing moved its cost: a point is recorded.
    expect(fake.saved[1]).toMatchObject({ kind: 'product', snapshot: { unitCost: 0.25 } });
  });

  it('write nothing, and no point, when nobody typed in them', async () => {
    const { user, fake } = await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], { recipes: [recipe('Dough')] }));
    await user.type(nameBox(), '!');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(fake.saved.map(write => write.kind)).toEqual(['product']);
    expect(fake.saved[0]).toMatchObject({ snapshot: null });
  });

  it('say the moment it is true that the loss changes other products too', async () => {
    const { user } = await open('/food-cost/product/Loaf', editorSource([
      DOUGH_PRODUCT, product('Roll', { components: [{ recipeId: 'Dough', qtyKg: 1 }] }),
    ], { recipes: [recipe('Dough')] }));
    expect(screen.queryByText(/The loss belongs to the recipe/)).not.toBeInTheDocument();
    await user.type(within(madeOf()).getByRole('textbox', { name: 'Cooked dough' }), '800');
    expect(screen.getByText('The loss belongs to the recipe: it changes 1 other product too.')).toBeInTheDocument();
  });

  it('warn when the cooked dough weighs more than the raw', async () => {
    const { user } = await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], { recipes: [recipe('Dough')] }));
    await user.type(within(madeOf()).getByRole('textbox', { name: 'Cooked dough' }), '1200');
    expect(screen.getByText('The cooked dough cannot weigh more than the raw dough.')).toBeInTheDocument();
  });

  it('never rewrite the box being typed in: «12.» keeps its point', async () => {
    const { user } = await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], { recipes: [recipe('Dough')] }));
    const raw = within(madeOf()).getByRole('textbox', { name: 'Raw dough' });
    await user.clear(raw);
    await user.type(raw, '12.');
    expect(raw).toHaveValue('12.');
    expect(raw).toHaveFocus();
  });

  it('start again from the recipe\'s own weighing, shown as weighed', async () => {
    await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT], {
      recipes: [recipe('Dough', { lossPct: 10, rawGrams: 1000, cookedGrams: 900 })],
    }));
    expect(within(madeOf()).getByRole('textbox', { name: 'Raw dough' })).toHaveValue('1000');
    expect(within(madeOf()).getByRole('textbox', { name: 'Cooked dough' })).toHaveValue('900');
    expect(within(madeOf()).getByText('Weight lost in the oven: 10%')).toBeInTheDocument();
  });

  it('do not appear for a recipe that no longer exists', async () => {
    await open('/food-cost/product/Loaf', editorSource([DOUGH_PRODUCT]));
    expect(within(madeOf()).queryByRole('textbox', { name: 'Raw dough' })).not.toBeInTheDocument();
  });
});

describe('a bare new product', () => {
  it('adds a recipe line, and the answer asks for the rest', async () => {
    const { user } = await open('/food-cost/new', editorSource([bareProduct('x')], { recipes: [recipe('Dough')] }));
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe' }));
    await user.click(within(await chooser()).getByRole('button', { name: 'Dough' }));
    await user.type(within(madeOf()).getByRole('textbox', { name: 'Kilos' }), '1');
    expect(screen.getByRole('group', { name: 'Production cost' })).toHaveTextContent('£2.00whole batch');
    expect(screen.getByRole('group', { name: 'Food cost' })).toHaveTextContent('Choose whether this is sold by the piece, by weight or by the pack');
  });
});
