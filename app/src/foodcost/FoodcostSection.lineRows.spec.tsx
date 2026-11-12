import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { BOX, editorSource, intoForm, PACKAGING_PRICES, recipe, SALT } from '../testing/foodcostEditorFixtures';
import { FLOUR, FLOUR_PRICES, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// The lines of «Made of» and of the packaging, step 3b of the Food cost plan (11 Nov 2026): the money at the right-hand end of the
// amount row, the «Raw dough» foot, only the units an ingredient's price converts to, the two notes (no piece weight, recipe deleted)
// and the «?» of «Made of». Form and read view.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;
const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');

// Eggs, bought by the piece; butter, bought by the kilo.
const EGG = { id: 'egg', name: 'Egg', active: true, unit: 'pcs' } as const;
const BUTTER = { id: 'butter', name: 'Butter', active: true, unit: 'kg' } as const;
const INGREDIENTS = [FLOUR, SALT, EGG, BUTTER, BOX];

type Prices = Record<string, Record<string, unknown>>;
function source(products: Parameters<typeof editorSource>[0], prices: Prices = {}, extra: Parameters<typeof editorSource>[1] = {}) {
  return editorSource(products, { ingredients: INGREDIENTS, prices: { ...FLOUR_PRICES, ...PACKAGING_PRICES, ...prices }, ...extra });
}

const EGG_EACH = { egg: { priceUnit: 'pcs', pricePerUnit: 0.3 } };
const EGG_EACH_WEIGHED = { egg: { priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.06 } };
const BUTTER_KILO = { butter: { priceUnit: 'kg', pricePerUnit: 10 } };
const BUTTER_KILO_PIECE = { butter: { priceUnit: 'kg', pricePerUnit: 10, unitWeightKg: 0.25 } };

const madeOf = () => screen.getByRole('region', { name: /^(Made of|Composto da)$/ });
const packaging = () => screen.getByRole('region', { name: 'Packaging' });
const lineOf = (region: HTMLElement, name: string) => within(region).getByRole('button', { name: `Change: ${name}` }).closest('li') as HTMLElement;
const unitsOf = (line: HTMLElement) => Array.from(within(line).getByRole('combobox', { name: 'Unit' }).querySelectorAll('option')).map(option => option.value);
const foot = () => within(madeOf()).getByText(/^(Raw dough|Impasto crudo)$/).parentElement as HTMLElement;

async function form(fake: ReturnType<typeof source>, id: string, options = {}) {
  const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
  await intoForm(view.user);
  return view;
}

async function read(fake: ReturnType<typeof source>, id: string, options = {}) {
  const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
  await screen.findByRole('button', { name: /^(Edit product|Modifica il prodotto)$/ }, LOAD);
  return view;
}

describe('the money sits at the end of the amount row', () => {
  it('in the form: after the unit, in the same row as the box, with the note below the row', async () => {
    await form(source([product('Eggs', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 500, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'egg', qty: 3, unit: 'pcs' }] })], EGG_EACH), 'Eggs');
    const flour = lineOf(madeOf(), 'Flour');
    const box = within(flour).getByRole('textbox', { name: 'Quantity' });
    const row = box.parentElement as HTMLElement;
    const money = within(flour).getByText('£2.00/kg · this amount £1.00');
    expect(money.parentElement).toBe(row);
    expect(row.lastElementChild).toBe(money);
    expect(money.tagName).toBe('SPAN');
    // The note stays under the row.
    const egg = lineOf(madeOf(), 'Egg');
    const note = within(egg).getByText('No piece weight: it doesn’t count in the raw dough.');
    expect(note.parentElement).toBe(egg);
    const eggRow = within(egg).getByText('£0.30 each · this amount £0.90').parentElement as HTMLElement;
    expect(eggRow.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('packaging too: after the fixed «pieces»', async () => {
    await form(source([product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 2 }] })]), 'Boxed');
    const line = lineOf(packaging(), 'Box');
    const money = within(line).getByText('£0.25 each · this amount £0.50');
    expect(money.previousElementSibling).toHaveTextContent('pieces');
    expect(money.parentElement).toBe(within(line).getByRole('textbox', { name: 'Pieces' }).parentElement);
  });

  it('in the read view: the name on top, the amount and its money on the row under it, the note after', async () => {
    await read(source([product('Eggs', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 500, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'egg', qty: 3, unit: 'pcs' }], packaging: [{ ingredientId: 'box', qtyPcs: 2 }] })], EGG_EACH), 'Eggs');
    const money = within(madeOf()).getByText('£2.00/kg · this amount £1.00');
    const amountRow = money.closest('dd') as HTMLElement;
    expect(amountRow.firstElementChild).toHaveTextContent('500.00 g');
    expect(amountRow.lastElementChild).toBe(money);
    expect(amountRow.previousElementSibling).toHaveTextContent('Flour');
    const note = within(madeOf()).getByText('No piece weight: it doesn’t count in the raw dough.');
    expect(note.previousElementSibling).toBe(within(madeOf()).getByText('£0.30 each · this amount £0.90').closest('dd'));
    const box = within(packaging()).getByText('£0.25 each · this amount £0.50').closest('dd') as HTMLElement;
    expect(box.firstElementChild).toHaveTextContent('2.00 pcs');
    expect(madeOf().querySelector('input, select, textarea')).toBeNull();
  });
});

describe('the «Raw dough» foot', () => {
  it('weighs the lines raw and adds up what they cost — no packaging — and follows what is typed', async () => {
    const { user } = await form(source([product('Zulle', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 790, unit: 'g' }],
      packaging: [{ ingredientId: 'box', qtyPcs: 2 }] })]), 'Zulle');
    expect(foot().lastElementChild).toHaveTextContent('790.00 g · £1.58');
    // The very raw total the «Baking» box follows.
    expect(screen.getByRole('textbox', { name: 'Raw dough' })).toHaveValue('790');
    // The last thing in the list area: after the lines, before the button that adds one.
    expect(foot().previousElementSibling?.tagName).toBe('UL');
    const box = within(madeOf()).getByRole('textbox', { name: 'Quantity' });
    await user.clear(box);
    await user.type(box, '1500');
    expect(foot().lastElementChild).toHaveTextContent('1.50 kg · £3.00');
  });

  it('says «more than» when a line has no cost, the summary\'s rule, and leaves pieces with no weight out of the weight', async () => {
    await form(source([product('Mixed', { components: [
      { kind: 'ingredient', ingredientId: 'flour', qty: 500, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'egg', qty: 3, unit: 'pcs' },
    ] })], EGG_EACH), 'Mixed');
    // 500 g + 20 g (the eggs weigh nothing known); £1.00 + £0.90, and the salt has no price.
    expect(foot().lastElementChild).toHaveTextContent('520.00 g · more than £1.90');
  });

  it('shows a dash, never «£0.00», when nothing is costed', async () => {
    await form(source([product('Salty', { components: [{ kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' }] })]), 'Salty');
    expect(foot().lastElementChild).toHaveTextContent('20.00 g · —');
    expect(foot()).not.toHaveTextContent('£');
  });

  it('shows a dash, not «£0.00», for a priced line with no amount yet', async () => {
    await form(source([product('Fresh', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 0, unit: 'g' }] })]), 'Fresh');
    expect(foot().lastElementChild).toHaveTextContent('0.00 g · —');
  });

  it('is not drawn without a line', async () => {
    await form(source([product('Empty', { components: [] })]), 'Empty');
    expect(within(madeOf()).queryByText('Raw dough')).not.toBeInTheDocument();
  });

  it('reads the same in the read view, in Italian', async () => {
    await read(source([product('Zulle', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 790, unit: 'g' }] })]), 'Zulle', ITALY);
    expect(plain(foot().textContent)).toBe('Impasto crudo790,00 g · 1,58 €');
    expect(foot().tagName).toBe('P');
  });

  it('counts a recipe line at its raw kilos', async () => {
    await read(source([product('Bread', { model: 3, components: [{ recipeId: 'Dough', qtyKg: 0.4 },
      { kind: 'ingredient', ingredientId: 'flour', qty: 100, unit: 'g' }] })], {}, { recipes: [recipe('Dough')] }), 'Bread');
    expect(foot().lastElementChild).toHaveTextContent('500.00 g · £1.00');
  });
});

describe('an ingredient line offers only the units its price converts to', () => {
  it('priced per kilo, no piece weight: g and kg', async () => {
    await form(source([product('P', { components: [{ kind: 'ingredient', ingredientId: 'butter', qty: 100, unit: 'g' }] })], BUTTER_KILO), 'P');
    expect(unitsOf(lineOf(madeOf(), 'Butter'))).toEqual(['g', 'kg']);
  });

  it('priced per kilo with a piece weight: g, kg and pieces', async () => {
    await form(source([product('P', { components: [{ kind: 'ingredient', ingredientId: 'butter', qty: 100, unit: 'g' }] })], BUTTER_KILO_PIECE), 'P');
    expect(unitsOf(lineOf(madeOf(), 'Butter'))).toEqual(['g', 'kg', 'pcs']);
  });

  it('priced per piece with a piece weight: g, kg and pieces', async () => {
    await form(source([product('P', { components: [{ kind: 'ingredient', ingredientId: 'egg', qty: 3, unit: 'pcs' }] })], EGG_EACH_WEIGHED), 'P');
    const line = lineOf(madeOf(), 'Egg');
    expect(unitsOf(line)).toEqual(['g', 'kg', 'pcs']);
    expect(within(line).getByRole('option', { name: 'pieces' })).toBeInTheDocument();
    expect(within(line).queryByText('No piece weight: it doesn’t count in the raw dough.')).not.toBeInTheDocument();
  });

  it('priced per piece, no piece weight: pieces alone, as fixed text like packaging — no menu of one', async () => {
    await form(source([product('P', { components: [{ kind: 'ingredient', ingredientId: 'egg', qty: 3, unit: 'pcs' }] })], EGG_EACH), 'P');
    const line = lineOf(madeOf(), 'Egg');
    expect(within(line).queryByRole('combobox', { name: 'Unit' })).not.toBeInTheDocument();
    expect(within(line).getByText('pieces')).toBeInTheDocument();
    expect(within(line).getByText('No piece weight: it doesn’t count in the raw dough.')).toBeInTheDocument();
  });

  it('⚠️ a saved line in a unit outside the set keeps that unit as an option, still chosen: never changed behind the person\'s back', async () => {
    const fake = source([product('Odd', { model: 3, components: [{ kind: 'ingredient', ingredientId: 'butter', qty: 2, unit: 'pcs' }] })], BUTTER_KILO);
    const { user } = await form(fake, 'Odd');
    const line = lineOf(madeOf(), 'Butter');
    const unit = within(line).getByRole('combobox', { name: 'Unit' });
    expect(unit).toHaveValue('pcs');
    expect(unitsOf(line)).toEqual(['g', 'kg', 'pcs']);
    // Bought by the kilo, the missing piece weight leaves the cost out too: one note says both, and where to fix it.
    expect(within(line).getByText('No piece weight: it doesn’t count in the raw dough or in the cost. Add it in Ingredients and suppliers, or count it in grams.')).toBeInTheDocument();
    expect(within(line).getByText('£10.00/kg')).toBeInTheDocument();
    // Moved to a unit that converts, the odd one is gone from the menu.
    await user.selectOptions(unit, 'g');
    expect(unitsOf(lineOf(madeOf(), 'Butter'))).toEqual(['g', 'kg']);
  });

  it('a pieces line with no quantity says nothing about the raw dough yet', async () => {
    await form(source([product('P', { components: [{ kind: 'ingredient', ingredientId: 'egg', qty: 0, unit: 'pcs' }] })], EGG_EACH), 'P');
    expect(madeOf()).not.toHaveTextContent('No piece weight');
  });

  it('a new line of something bought by the piece with no weight opens on pieces; one bought by the kilo on grams', async () => {
    const { user } = await form(source([product('P')], EGG_EACH), 'P');
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' }));
    let dialog = await screen.findByRole('dialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: /^Egg/ }));
    const egg = lineOf(madeOf(), 'Egg');
    expect(within(egg).queryByRole('combobox', { name: 'Unit' })).not.toBeInTheDocument();
    expect(within(egg).getByText('pieces')).toBeInTheDocument();
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe or ingredient' }));
    dialog = await screen.findByRole('dialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: /^Salt/ }));
    expect(within(lineOf(madeOf(), 'Salt')).getByRole('combobox', { name: 'Unit' })).toHaveValue('g');
  });

  it('an ingredient with no price basis yet offers all three', async () => {
    await form(source([product('P', { components: [{ kind: 'ingredient', ingredientId: 'salt', qty: 5, unit: 'g' }] })]), 'P');
    expect(unitsOf(lineOf(madeOf(), 'Salt'))).toEqual(['g', 'kg', 'pcs']);
  });

  it('a recipe line keeps grams and kilos', async () => {
    await form(source([product('Bread', { model: 3, components: [{ recipeId: 'Dough', qtyKg: 0.4 }] })], {}, { recipes: [recipe('Dough')] }), 'Bread');
    expect(unitsOf(lineOf(madeOf(), 'Dough'))).toEqual(['g', 'kg']);
  });
});

describe('a recipe line whose recipe is gone', () => {
  const gone = () => source([product('Lost', { model: 3, components: [{ recipeId: 'Ghost', qtyKg: 0.4 },
    { kind: 'ingredient', ingredientId: 'flour', qty: 100, unit: 'g' }] })], {}, { recipes: [recipe('Dough')] });

  it('says what to do, in sight, in the form', async () => {
    await form(gone(), 'Lost');
    const line = lineOf(madeOf(), 'This recipe no longer exists');
    expect(within(line).getByText('Recipe deleted: choose another or remove the line.')).toBeVisible();
  });

  it('and in the read view, in Italian', async () => {
    await read(gone(), 'Lost', ITALY);
    expect(within(madeOf()).getByText('Ricetta eliminata: scegline un’altra o togli la riga.')).toBeVisible();
    expect(within(madeOf()).getByText('Questa ricetta non esiste più')).toBeInTheDocument();
  });
});

describe('the «?» of «Made of»', () => {
  const help = () => {
    const toggle = within(madeOf()).getByRole('button', { name: /^(Explanation|Spiegazione): (Made of|Composto da)$/ });
    return document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement;
  };

  it('the form says what to type and that the money is on the right', async () => {
    await form(source([product('Green')]), 'Green', ITALY);
    expect(help().textContent).toBe('Scrivi quello che metti nell’impasto, pesato crudo. Tocca un nome per cambiarlo. A destra c’è quanto costa la quantità scritta.');
  });

  it('the read view drops what only the form can do', async () => {
    await read(source([product('Green')]), 'Green', ITALY);
    expect(help().textContent).toBe('Quello che va nell’impasto, pesato crudo. A destra c’è quanto costa la quantità scritta.');
  });
});
