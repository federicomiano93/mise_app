import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { REFERENCE, SPONGE, cakeDoc, incompleteCake, renderCakes, storedReference } from '../testing/renderCakes';
import { EMPLOYEE, FLOUR, FLOUR_PRICES, LOAD, product } from '../testing/renderFoodcost';
import { openMeasures } from '../testing/openMeasures';

// A cake's measures, and what it costs and sells for (the sixth step): the measure boxes and their limits, the materials, the labour (only for somebody who
// can read the labour rate), the slice, the price with its VAT and target, the food cost with its light, and the suggested price.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// 22 cm, 2 discs, 8 slices: 1000 g of the sponge (£2.00 a kilo) sold at £12.00 with 20% VAT (net £10.00): a food cost of 20%, target 30%.
const SACHER = cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE });

const foodcost = (settings: Record<string, unknown> | null = null) => fakeFoodcostSource({
  products: [SPONGE],
  ingredients: [FLOUR],
  prices: FLOUR_PRICES,
  categories: [{ id: 'cat1', name: 'Celebration cakes', order: 1 }],
  settings,
});

const open = async (cake = SACHER, options: Parameters<typeof renderCakes>[1] = {}, path = `/cakes/${cake.id}`) => {
  const view = renderCakes(path, { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: foodcost(), ...options });
  await screen.findByRole('heading', { level: 2, name: String(cake.name) || 'Untitled cake' }, LOAD);
  return view;
};

const card = (name: string | RegExp) => screen.getByRole('heading', { level: 3, name }).closest('section') as HTMLElement;
// ⚠️ A saved cake opens with every step closed: «Cost and price» is a button that opens the step, which is a group named by it.
const COST = /^Cost and price/;
const openCost = async (user: Awaited<ReturnType<typeof open>>['user']) => {
  await user.click(screen.getByRole('button', { name: COST }));
  return within(screen.getByRole('group', { name: COST }));
};
const PRICE = /^Price of the whole cake, VAT included/;

describe('the cost', () => {
  it('shows the raw materials, the slice and the food cost with its light and its word', async () => {
    const { user } = await open();
    const cost = await openCost(user);
    expect(cost.getByText('Raw materials').parentElement).toHaveTextContent('£2.00');
    expect(cost.getByText('Per slice, out of 8 slices').parentElement).toHaveTextContent('£0.25 cost · £1.50 price');
    expect(cost.getByText('20.00%')).toBeInTheDocument();
    expect(cost.getByText('On target')).toBeInTheDocument();
    expect(cost.getByText('raw materials over the net price · target 30.00%')).toBeInTheDocument();
    // An owner without a labour rate set sees no labour.
    expect(cost.queryByText('Labour')).not.toBeInTheDocument();
    expect(cost.queryByText('Total cost')).not.toBeInTheDocument();
  });

  it('shows the labour, and the total, to somebody who can read the labour rate — and the slice’s cost stays the materials alone', async () => {
    const { user } = await open(cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE, assemblyMinutes: 20 }), { foodcost: foodcost({ labourCostPerHour: 18 }) });
    const cost = await openCost(user);
    // 20 minutes at £18 an hour: £6.00 of assembly; the sponge carries none.
    expect(await cost.findByText('Labour', undefined, LOAD)).toBeInTheDocument();
    expect(cost.getByText('Labour').parentElement).toHaveTextContent('£6.00');
    expect(cost.getByText('Total cost').parentElement).toHaveTextContent('£8.00');
    expect(cost.getByText('Raw materials').parentElement).toHaveTextContent('£2.00');
    expect(cost.getByText('Per slice, out of 8 slices').parentElement).toHaveTextContent('£0.25 cost · £1.50 price');
    expect(cost.getByText('materials + labour: £1.00 a slice')).toBeInTheDocument();
  });

  it('⚠️ shows no labour anywhere to an employee, who cannot read the rate', async () => {
    const { user } = await open(cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE, assemblyMinutes: 20 }), { session: EMPLOYEE, foodcost: foodcost({ labourCostPerHour: 18 }) });
    await user.click(screen.getByRole('button', { name: /^Base/ }));
    const cost = await openCost(user);
    expect(cost.getByText('Raw materials').parentElement).toHaveTextContent('£2.00');
    expect(cost.queryByText('Labour')).not.toBeInTheDocument();
    expect(cost.queryByText('Total cost')).not.toBeInTheDocument();
    expect(cost.queryByText(/materials \+ labour/)).not.toBeInTheDocument();
    expect(screen.queryByText('labour')).not.toBeInTheDocument();
    expect(screen.queryByText('Labour')).not.toBeInTheDocument();
  });

  it('a card with no price makes the cost «incomplete»: «?», «+?», and the card named', async () => {
    const unpriced = product('MARZIPAN', {
      name: 'Marzipan', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null,
      components: [{ kind: 'ingredient', ingredientId: 'nothing', qty: 1000, unit: 'g' }],
    });
    const cake = cakeDoc('c1', 'Cassata', { lines: [{ tier: 0, part: 'base', productId: 'MARZIPAN', grams: 500 }] });
    const { user } = await open(cake, { foodcost: fakeFoodcostSource({ products: [SPONGE, unpriced], ingredients: [FLOUR], prices: FLOUR_PRICES }) });
    const cost = await openCost(user);
    expect(cost.getByText('?')).toBeInTheDocument();
    expect(cost.getByText('Cost incomplete: Marzipan has no price yet on its Food cost card. The real cost is higher.')).toBeInTheDocument();
    expect(cost.queryByText(/no longer exist/)).not.toBeInTheDocument();
    expect(cost.queryByText(/^d+(.d+)?%$/)).not.toBeInTheDocument();
  });

  it('a line with no grams (no reference grams, nothing typed) makes the cost incomplete and says so', async () => {
    const cake = cakeDoc('c1', 'Plain', { ref: null, lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }] });
    const { user } = await open(cake, { cakes: fakeCakesSource({ cakes: [cake], reference: null }) });
    const cost = await openCost(user);
    expect(cost.getByText('1 line without grams: type the grams or fill in the standard cake in Settings.')).toBeInTheDocument();
    expect(cost.getByText('?')).toBeInTheDocument();
  });

  it('says «1 disc» and «out of 1 slice» in the singular', async () => {
    const { user } = await open(cakeDoc('c1', 'Mini', { diameterCm: 22, discs: 1, slices: 1, ref: REFERENCE }));
    expect(await screen.findByRole('img', { name: /^Section drawing of the cake: 1 tier, 1 disc per tier/ })).toBeInTheDocument();
    expect((await openCost(user)).getByText('Per slice, out of 1 slice')).toBeInTheDocument();
  });

  it('the food cost word is on screen, not for a screen reader only', async () => {
    const { user } = await open();
    expect((await openCost(user)).getByText('On target').className).not.toMatch(/srOnly/);
  });

  it('a card that no longer exists in Food cost is NOT «without a price»: it has its own line, and the row says so', async () => {
    const { user } = await open(incompleteCake('c1', 'Cassata'));
    const cost = await openCost(user);
    expect(cost.getByText('1 card of this cake no longer exists in Food cost: remove it from the part.')).toBeInTheDocument();
    expect(cost.queryByText(/Cost incomplete/)).not.toBeInTheDocument();
    expect(cost.queryByText(/This card no longer exists/)).not.toBeInTheDocument();
    // The step holding it says so too (one step is open at a time, so the cost step closes).
    await user.click(screen.getByRole('button', { name: /^Base/ }));
    expect(screen.getByText('This card no longer exists')).toBeInTheDocument();
  });

  it('says «cards … exist» in the plural, and both lines when a card has no price and another is gone', async () => {
    const unpriced = product('MARZIPAN', {
      name: 'Marzipan', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null,
      components: [{ kind: 'ingredient', ingredientId: 'nothing', qty: 1000, unit: 'g' }],
    });
    const cake = cakeDoc('c1', 'Cassata', {
      lines: [
        { tier: 0, part: 'base', productId: 'MARZIPAN', grams: 500 },
        { tier: 0, part: 'filling', productId: 'GHOST', grams: 500 },
        { tier: 0, part: 'soak', productId: 'GHOST2', grams: 500 },
      ],
    });
    const { user } = await open(cake, { foodcost: fakeFoodcostSource({ products: [SPONGE, unpriced], ingredients: [FLOUR], prices: FLOUR_PRICES }) });
    const cost = await openCost(user);
    expect(cost.getByText('Cost incomplete: Marzipan has no price yet on its Food cost card. The real cost is higher.')).toBeInTheDocument();
    expect(cost.getByText('2 cards of this cake no longer exist in Food cost: remove them from the part.')).toBeInTheDocument();
  });

  it('with no VAT chosen the food cost is «—» and says what to do', async () => {
    const { user } = await open(cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE, vatRate: null }));
    const cost = await openCost(user);
    expect(cost.getByText('—')).toBeInTheDocument();
    expect(cost.getByText('Choose the VAT rate')).toBeInTheDocument();
  });

  it('a new cake has no VAT chosen, no price and no cost to speak of', async () => {
    const { user } = renderCakes('/cakes/new', { cakes: fakeCakesSource({ cakes: [], reference: storedReference() }), foodcost: foodcost() });
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    await openCost(user);
    expect(screen.getByRole('combobox', { name: 'VAT rate' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: /^Price of the whole cake/ })).toHaveValue('');
    expect(screen.getByText('Add a card to a part to see the cost.')).toBeInTheDocument();
  });
});

describe('the price', () => {
  it('«Use this price» puts the price that hits the target in the box', async () => {
    const { user } = await open();
    await openCost(user);
    const box = screen.getByRole('textbox', { name: PRICE });
    expect(box).toHaveValue('12');
    // £2.00 of materials at a 30% target with 20% VAT: £8.00.
    await user.click(screen.getByRole('button', { name: 'Use this price' }));
    expect(box).toHaveValue('8');
    expect(within(screen.getByRole('group', { name: COST })).getAllByText('30.00%').length).toBeGreaterThan(0);
  });

  it('a price that is not a number stops Save, marks the box and names it', async () => {
    const { user, foodcost: written } = await open();
    await openCost(user);
    const box = screen.getByRole('textbox', { name: PRICE });
    await user.clear(box);
    await user.type(box, 'abc');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText(/^Check «Selling price including VAT»/)).toBeInTheDocument();
    expect(written.saved).toHaveLength(0);
  });

  it('a price above 100,000 (the rules ceiling) stops Save before it asks, marks the box and names it', async () => {
    const { user, foodcost: written } = await open();
    await openCost(user);
    const box = screen.getByRole('textbox', { name: PRICE });
    await user.clear(box);
    await user.type(box, '100001');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText(/^Check «Selling price including VAT»/)).toBeInTheDocument();
    expect(written.saved).toHaveLength(0);
  });

  it('the price, the VAT and the target travel with the cake (the category is Food cost’s «Cakes» group, never a choice here)', async () => {
    const { user, foodcost: written } = await open();
    await openCost(user);
    const box = screen.getByRole('textbox', { name: PRICE });
    await user.clear(box);
    await user.type(box, '14,5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'VAT rate' }), '5');
    await user.clear(screen.getByRole('textbox', { name: 'Food cost target (%)' }));
    await user.type(screen.getByRole('textbox', { name: 'Food cost target (%)' }), '28');
    expect(screen.queryByRole('combobox', { name: 'Category' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(written.saved).toHaveLength(1); });
    const write = written.saved[0];
    expect((write?.companion as { data: unknown }).data).toMatchObject({ sellingPrice: 14.5, vatRate: 5, foodCostTarget: 28 });
    expect(write?.data).toMatchObject({ sellingPrice: 14.5, vatRate: 5, foodCostTarget: 28 });
  });
});

describe('the cost card', () => {
  it('folds again by its title, and its folded line says the raw materials', async () => {
    const { user } = await open();
    const step = screen.getByRole('button', { name: COST });
    expect(step).toHaveAttribute('aria-expanded', 'false');
    expect(step).toHaveTextContent('£2.00 raw materials');
    await openCost(user);
    expect(step).toHaveAttribute('aria-expanded', 'true');
    await user.click(step);
    expect(step).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: PRICE })).not.toBeInTheDocument();
  });

  it('comes after the five parts, in a card of its own', async () => {
    await open();
    expect(screen.queryByText('Then, once the cake is composed')).not.toBeInTheDocument();
    const titles = ['Base', 'Soak', 'Filling', 'Coating', 'Decoration', 'Cost and price'];
    const steps = screen.getAllByRole('button', { name: /^(Base|Soak|Filling|Coating|Decoration|Cost and price)/ });
    expect(steps.map(button => titles.find(title => within(button).queryByText(title) !== null))).toEqual(titles);
  });

  it('a price that Save refuses opens the card again, even when it was folded, and the box takes the focus', async () => {
    const { user, foodcost: written } = await open();
    await openCost(user);
    const typed = screen.getByRole('textbox', { name: PRICE });
    await user.clear(typed);
    await user.type(typed, 'abc');
    await user.click(screen.getByRole('button', { name: COST }));
    expect(screen.queryByRole('textbox', { name: PRICE })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    const box = await screen.findByRole('textbox', { name: PRICE });
    await waitFor(() => { expect(box).toHaveFocus(); });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(written.saved).toHaveLength(0);
  });
});

describe('the measures', () => {
  const box = (name: string | RegExp) => screen.getByRole('textbox', { name });
  const type = async (user: Awaited<ReturnType<typeof open>>['user'], name: string | RegExp, text: string) => {
    await user.clear(box(name));
    if (text !== '') await user.type(box(name), text);
    await user.tab();
  };

  it('sits in one block with the name, the diameter («cm» inside its box), the tiers, the discs and the discs’ height, and nothing else', async () => {
    const { user } = await open();
    await openMeasures(user);
    const measures = within(card('Measures'));
    expect(measures.getByRole('textbox', { name: 'Name' })).toHaveValue('Sacher');
    expect(measures.getByRole('textbox', { name: 'Diameter in centimetres' })).toHaveValue('22');
    // «cm» sits inside the diameter's box and the disc height's.
    expect(measures.getAllByText('cm')).toHaveLength(2);
    expect(measures.getByRole('textbox', { name: 'Tiers' })).toHaveValue('1');
    expect(measures.getByRole('textbox', { name: 'Discs' })).toHaveValue('2');
    expect(measures.getByRole('textbox', { name: 'Height of one disc in centimetres' })).toHaveValue('3');
    expect(measures.queryByText('Slices')).not.toBeInTheDocument();
    expect(measures.queryByText('Assembly')).not.toBeInTheDocument();
  });

  it('takes each measure when the person leaves the box, and clamps it to what the cake can be', async () => {
    const { user } = await open();
    await openMeasures(user);
    await type(user, 'Diameter in centimetres', '24');
    expect(box('Diameter in centimetres')).toHaveValue('24');
    await type(user, 'Discs', '4');
    expect(box('Discs')).toHaveValue('4');
    await type(user, 'Discs', '9');
    expect(box('Discs')).toHaveValue('5');
    await type(user, 'Diameter in centimetres', '99');
    expect(box('Diameter in centimetres')).toHaveValue('40');
  });

  it('does not clamp while the person is still typing («2» on the way to «26»)', async () => {
    const { user } = await open();
    await openMeasures(user);
    await user.clear(box('Diameter in centimetres'));
    await user.type(box('Diameter in centimetres'), '2');
    expect(box('Diameter in centimetres')).toHaveValue('2');
    await user.type(box('Diameter in centimetres'), '6{Enter}');
    expect(box('Diameter in centimetres')).toHaveValue('26');
  });

  it('an empty or junk box goes back to the value the cake has', async () => {
    const { user } = await open();
    await openMeasures(user);
    await type(user, 'Tiers', '');
    expect(box('Tiers')).toHaveValue('1');
    await type(user, 'Discs', 'abc');
    expect(box('Discs')).toHaveValue('2');
  });

  it('the slices and the assembly time sit in the cost step, beside what they change', async () => {
    const { user } = await open();
    await openMeasures(user);
    expect(within(card('Measures')).queryByText('Slices')).not.toBeInTheDocument();
    const cost = await openCost(user);
    await user.click(cost.getByRole('button', { name: 'One slice more' }));
    expect(cost.getByText('9', { selector: 'output' })).toBeInTheDocument();
    expect(cost.getByText('0 min')).toBeInTheDocument();
    await user.click(cost.getByRole('button', { name: 'Five minutes more' }));
    expect(cost.getByText('5 min')).toBeInTheDocument();
    await user.click(cost.getByRole('button', { name: 'Five minutes fewer' }));
    expect(cost.getByText('0 min')).toBeInTheDocument();
    expect(cost.getByRole('button', { name: 'Five minutes fewer' })).toBeDisabled();
  });

  it('the steppers of the cost step are as big as a thumb: 56px buttons, named', async () => {
    const { user } = await open();
    const cost = await openCost(user);
    expect(cost.getByRole('button', { name: 'One slice fewer' }).className).toMatch(/stepButton/);
  });

  it('a tier more is refused when it would be under 10 cm, and the note says why on its own line', async () => {
    const { user } = await open(cakeDoc('c1', 'Small', { diameterCm: 20, tiers: 1, discs: 2, ref: REFERENCE }));
    await openMeasures(user);
    const measures = within(card('Measures'));
    expect(measures.queryByText(/Another tier would be/)).not.toBeInTheDocument();
    await type(user, 'Tiers', '2');
    expect(box('Tiers')).toHaveValue('2');
    expect(measures.getByText('Another tier would be 8 cm: the smallest must be at least 10 cm. Widen the diameter to add it.')).toBeInTheDocument();
    await type(user, 'Tiers', '3');
    expect(box('Tiers')).toHaveValue('2');
    // Widening the diameter lifts the block, and the tab bar now offers the tiers.
    await type(user, 'Diameter in centimetres', '26');
    expect(measures.queryByText(/Another tier would be/)).not.toBeInTheDocument();
    await type(user, 'Tiers', '3');
    expect(box('Tiers')).toHaveValue('3');
    expect(screen.getByRole('group', { name: 'Tier' })).toBeInTheDocument();
  });

  it('the tiers cannot go below 1', async () => {
    const { user } = await open();
    await openMeasures(user);
    await type(user, 'Tiers', '0');
    expect(box('Tiers')).toHaveValue('1');
  });
});

describe('in Italian', () => {
  it('says the measures, the cost and the tier note in Italian', async () => {
    const { user } = await open(cakeDoc('c1', 'Torta', { diameterCm: 20, tiers: 2, discs: 2, ref: REFERENCE, assemblyMinutes: 20 }), { lang: 'it', foodcost: foodcost({ labourCostPerHour: 18 }) });
    await openMeasures(user);
    await user.click(screen.getByRole('button', { name: /^Costo e prezzo/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'Misure' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Dischi' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Diametro in centimetri' })).toBeInTheDocument();
    expect(screen.getByText('Materie prime')).toBeInTheDocument();
    expect(screen.getByText('A fetta, su 8 fette')).toBeInTheDocument();
    expect(await screen.findByText('Costo totale', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('materie + lavoro')).toBeInTheDocument();
    expect(screen.getByText('Un altro piano verrebbe 8 cm: il più piccolo deve essere almeno 10 cm. Allarga il diametro per aggiungerlo.')).toBeInTheDocument();
  });
});
