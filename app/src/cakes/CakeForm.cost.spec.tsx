import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { REFERENCE, SPONGE, cakeDoc, incompleteCake, renderCakes, storedReference } from '../testing/renderCakes';
import { EMPLOYEE, FLOUR, FLOUR_PRICES, LOAD, product } from '../testing/renderFoodcost';

// A cake's measures, and what it costs and sells for: the steppers and their limits, the materials, the labour (only for somebody who
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
const PRICE = /^Price of the whole cake, VAT included/;

describe('the cost', () => {
  it('shows the raw materials, the slice and the food cost with its light and its word', async () => {
    await open();
    const cost = within(card('Cost and price'));
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
    await open(cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE, assemblyMinutes: 20 }), { foodcost: foodcost({ labourCostPerHour: 18 }) });
    const cost = within(card('Cost and price'));
    // 20 minutes at £18 an hour: £6.00 of assembly; the sponge carries none.
    expect(await cost.findByText('Labour', undefined, LOAD)).toBeInTheDocument();
    expect(cost.getByText('Labour').parentElement).toHaveTextContent('£6.00');
    expect(cost.getByText('Total cost').parentElement).toHaveTextContent('£8.00');
    expect(cost.getByText('Raw materials').parentElement).toHaveTextContent('£2.00');
    expect(cost.getByText('Per slice, out of 8 slices').parentElement).toHaveTextContent('£0.25 cost · £1.50 price');
    expect(cost.getByText('materials + labour: £1.00 a slice')).toBeInTheDocument();
    // The parts list shows the labour column too.
    expect(within(card(/^Parts of the cake/)).getAllByText('labour').length).toBeGreaterThan(0);
  });

  it('⚠️ shows no labour anywhere to an employee, who cannot read the rate', async () => {
    await open(cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE, assemblyMinutes: 20 }), { session: EMPLOYEE, foodcost: foodcost({ labourCostPerHour: 18 }) });
    const cost = within(card('Cost and price'));
    expect(cost.getByText('Raw materials').parentElement).toHaveTextContent('£2.00');
    expect(cost.queryByText('Labour')).not.toBeInTheDocument();
    expect(cost.queryByText('Total cost')).not.toBeInTheDocument();
    expect(cost.queryByText(/materials \+ labour/)).not.toBeInTheDocument();
    expect(within(card(/^Parts of the cake/)).queryByText('labour')).not.toBeInTheDocument();
    expect(within(card(/^Parts of the cake/)).queryByText('Labour')).not.toBeInTheDocument();
  });

  it('a card with no price makes the cost «incomplete»: «?», «+?», and the card named', async () => {
    const unpriced = product('MARZIPAN', {
      name: 'Marzipan', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null,
      components: [{ kind: 'ingredient', ingredientId: 'nothing', qty: 1000, unit: 'g' }],
    });
    const cake = cakeDoc('c1', 'Cassata', { lines: [{ tier: 0, part: 'base', productId: 'MARZIPAN', grams: 500 }] });
    await open(cake, { foodcost: fakeFoodcostSource({ products: [SPONGE, unpriced], ingredients: [FLOUR], prices: FLOUR_PRICES }) });
    const cost = within(card('Cost and price'));
    expect(cost.getByText('?')).toBeInTheDocument();
    expect(cost.getByText('Cost incomplete: Marzipan has no price yet on its Food cost card. The real cost is higher.')).toBeInTheDocument();
    expect(cost.queryByText(/no longer exist/)).not.toBeInTheDocument();
    expect(cost.queryByText(/^d+(.d+)?%$/)).not.toBeInTheDocument();
  });

  it('a card that no longer exists in Food cost is NOT «without a price»: it has its own line, and the row says so', async () => {
    await open(incompleteCake('c1', 'Cassata'));
    const cost = within(card('Cost and price'));
    expect(cost.getByText('1 card of this cake no longer exists in Food cost: remove it from the part.')).toBeInTheDocument();
    expect(cost.queryByText(/Cost incomplete/)).not.toBeInTheDocument();
    expect(cost.queryByText(/This card no longer exists/)).not.toBeInTheDocument();
    expect(within(card(/^Parts of the cake/)).getByText('This card no longer exists')).toBeInTheDocument();
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
    await open(cake, { foodcost: fakeFoodcostSource({ products: [SPONGE, unpriced], ingredients: [FLOUR], prices: FLOUR_PRICES }) });
    const cost = within(card('Cost and price'));
    expect(cost.getByText('Cost incomplete: Marzipan has no price yet on its Food cost card. The real cost is higher.')).toBeInTheDocument();
    expect(cost.getByText('2 cards of this cake no longer exist in Food cost: remove them from the part.')).toBeInTheDocument();
  });

  it('with no VAT chosen the food cost is «—» and says what to do', async () => {
    await open(cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE, vatRate: null }));
    const cost = within(card('Cost and price'));
    expect(cost.getByText('—')).toBeInTheDocument();
    expect(cost.getByText('Choose the VAT rate')).toBeInTheDocument();
  });

  it('a new cake has no VAT chosen, no price and no cost to speak of', async () => {
    renderCakes('/cakes/new', { cakes: fakeCakesSource({ cakes: [], reference: storedReference() }), foodcost: foodcost() });
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    expect(screen.getByRole('combobox', { name: 'VAT rate' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: /^Price of the whole cake/ })).toHaveValue('');
    expect(screen.getByText('Add a card to a part to see the cost.')).toBeInTheDocument();
  });
});

describe('the price', () => {
  it('«Use this price» puts the price that hits the target in the box', async () => {
    const { user } = await open();
    const box = screen.getByRole('textbox', { name: PRICE });
    expect(box).toHaveValue('12');
    // £2.00 of materials at a 30% target with 20% VAT: £8.00.
    await user.click(screen.getByRole('button', { name: 'Use this price' }));
    expect(box).toHaveValue('8');
    expect(within(card('Cost and price')).getAllByText('30.00%').length).toBeGreaterThan(0);
  });

  it('a price that is not a number stops Save, marks the box and names it', async () => {
    const { user, foodcost: written } = await open();
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

  it('the price, the VAT, the target and the category travel with the cake', async () => {
    const { user, foodcost: written } = await open();
    const box = screen.getByRole('textbox', { name: PRICE });
    await user.clear(box);
    await user.type(box, '14,5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'VAT rate' }), '5');
    await user.clear(screen.getByRole('textbox', { name: 'Food cost target (%)' }));
    await user.type(screen.getByRole('textbox', { name: 'Food cost target (%)' }), '28');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Celebration cakes');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(written.saved).toHaveLength(1); });
    const write = written.saved[0];
    expect((write?.companion as { data: unknown }).data).toMatchObject({ sellingPrice: 14.5, vatRate: 5, foodCostTarget: 28, categoryId: 'cat1' });
    expect(write?.data).toMatchObject({ sellingPrice: 14.5, vatRate: 5, foodCostTarget: 28, categoryId: 'cat1' });
  });
});

describe('the measures', () => {
  it('moves each measure by its step and shows the new value', async () => {
    const { user } = await open();
    const measures = within(card('Measures'));
    await user.click(measures.getByRole('button', { name: 'Diameter plus 2 cm' }));
    expect(measures.getByText('24 cm')).toBeInTheDocument();
    await user.click(measures.getByRole('button', { name: 'One disc more' }));
    expect(measures.getByText('3', { selector: 'output' })).toBeInTheDocument();
    await user.click(measures.getByRole('button', { name: 'One slice more' }));
    expect(measures.getByText('9', { selector: 'output' })).toBeInTheDocument();
    expect(measures.getByText('0 min')).toBeInTheDocument();
    await user.click(measures.getByRole('button', { name: 'Five minutes more' }));
    expect(measures.getByText('5 min')).toBeInTheDocument();
    await user.click(measures.getByRole('button', { name: 'Five minutes fewer' }));
    expect(measures.getByText('0 min')).toBeInTheDocument();
    expect(measures.getByRole('button', { name: 'Five minutes fewer' })).toBeDisabled();
  });

  it('the diameter stops at 40 cm and at what the tiers need', async () => {
    const { user } = await open(cakeDoc('c1', 'Big', { diameterCm: 38, discs: 2, ref: REFERENCE }));
    const measures = within(card('Measures'));
    await user.click(measures.getByRole('button', { name: 'Diameter plus 2 cm' }));
    expect(measures.getByText('40 cm')).toBeInTheDocument();
    expect(measures.getByRole('button', { name: 'Diameter plus 2 cm' })).toBeDisabled();
  });

  it('the steppers are as big as a thumb: 56px buttons, named', async () => {
    await open();
    const less = within(card('Measures')).getByRole('button', { name: 'Diameter minus 2 cm' });
    expect(less.className).toMatch(/stepButton/);
  });

  it('a tier more is blocked when it would be under 10 cm, and the note says why on its own line', async () => {
    const { user } = await open(cakeDoc('c1', 'Small', { diameterCm: 20, tiers: 1, discs: 2, ref: REFERENCE }));
    const measures = within(card('Measures'));
    await user.click(measures.getByRole('button', { name: 'One tier more' }));
    expect(measures.getByRole('button', { name: 'One tier fewer' })).toBeEnabled();
    const more = measures.getByRole('button', { name: 'One tier more' });
    expect(more).toBeDisabled();
    expect(measures.getByText('Another tier would be 8 cm: the smallest must be at least 10 cm. Widen the diameter to add it.')).toBeInTheDocument();
    // Widening the diameter lifts the block, and the tab bar now offers the tiers.
    await user.click(measures.getByRole('button', { name: 'Diameter plus 2 cm' }));
    await user.click(measures.getByRole('button', { name: 'Diameter plus 2 cm' }));
    expect(measures.getByRole('button', { name: 'One tier more' })).toBeEnabled();
    expect(screen.getByRole('group', { name: 'Tier' })).toBeInTheDocument();
  });

  it('the tiers cannot go below 1', async () => {
    await open();
    expect(within(card('Measures')).getByRole('button', { name: 'One tier fewer' })).toBeDisabled();
  });
});

describe('in Italian', () => {
  it('says the measures, the cost and the tier note in Italian', async () => {
    await open(cakeDoc('c1', 'Torta', { diameterCm: 20, tiers: 2, discs: 2, ref: REFERENCE, assemblyMinutes: 20 }), { lang: 'it', foodcost: foodcost({ labourCostPerHour: 18 }) });
    expect(screen.getByRole('heading', { level: 3, name: 'Misure' })).toBeInTheDocument();
    expect(screen.getByText('Materie prime')).toBeInTheDocument();
    expect(screen.getByText('A fetta, su 8 fette')).toBeInTheDocument();
    expect(await screen.findByText('Costo totale', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('materie + lavoro')).toBeInTheDocument();
    expect(screen.getByText('Un altro piano verrebbe 8 cm: il più piccolo deve essere almeno 10 cm. Allarga il diametro per aggiungerlo.')).toBeInTheDocument();
  });
});
