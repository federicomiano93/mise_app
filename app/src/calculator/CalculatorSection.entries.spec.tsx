import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import {
  BRIOCHE, CLIENTS, FOCACCIA, LOAD, SOURDOUGH, configOf, onlyFocaccia, renderCalculator,
} from '../testing/renderCalculator';

// What the entries of a tab are, by the recipe's logic, and how each box behaves and is remembered. The keys
// are the CURRENT app's (same origin, it reads them back): the names and the stored text are asserted, not
// just that "something" was saved.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);

beforeEach(() => {
  window.localStorage.clear();
  // The recipe is shown once confirmed: these specs read what it says, so the tabs start confirmed.
  for (const rid of ['focaccia', 'brioche', 'sourdough']) window.localStorage.setItem(`revealed-${rid}`, '1');
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const stored = (key: string) => window.localStorage.getItem(key);

async function open(path: string, config: Record<string, unknown> = configOf(), lang: 'en' | 'it' = 'en') {
  const view = renderCalculator(path, { source: fakeCalculatorSource({ config }), lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  await waitFor(() => { expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); }, LOAD);
  return view;
}

const card = (client: string) => within(main().getByRole('region', { name: client }));

describe('the orders of an orders recipe', () => {
  it('draws a card per client in address-book order, a row per active product', async () => {
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(main().getAllByRole('region').map(region => region.getAttribute('aria-label') ?? region.querySelector('h3')?.textContent))
      .toEqual(['Cafe Roma', 'Bar Sole']);
    expect(card('Cafe Roma').getAllByRole('listitem').map(row => row.querySelector('label')?.textContent)).toEqual([
      'Focaccia tray (500g)',
      'Focaccia slab (800g)',
    ]);
  });

  it('names a product and its weight on the left, the box and «pz» on the right; a kg row has no weight', async () => {
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Bar Sole' }, LOAD);
    const rows = card('Bar Sole').getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Focaccia tray (500g)');
    expect(rows[0]).toHaveTextContent('pz');
    expect(rows[1]).toHaveTextContent('Cheese by the kilo');
    expect(rows[1]).not.toHaveTextContent('(1000g)');
    expect(rows[1]).toHaveTextContent('kg');
  });

  it('leaves a paused product out entirely', async () => {
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(screen.queryByText(/Paused loaf/)).not.toBeInTheDocument();
  });

  it('gives the same product ordered by two clients two independent boxes', async () => {
    const { user } = await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    const roma = card('Cafe Roma').getByLabelText('Focaccia tray (500g)');
    const sole = card('Bar Sole').getByLabelText('Focaccia tray (500g)');
    await user.type(roma, '3');
    expect(roma).toHaveValue(3);
    expect(sole).toHaveValue(0);
    expect(stored('qty-roma::tray')).toBe('3');
    expect(stored('qty-sole::tray')).toBeNull();
  });

  it('says quietly that the tab has no products, when it has none', async () => {
    await open('/calculator/focaccia', onlyFocaccia({ clients: [] }));
    expect(await screen.findByText(/No products in this tab yet/, undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('region')).not.toBeInTheDocument();
  });

  it('says the same when every product of the recipe is paused', async () => {
    const clients = CLIENTS.map(client => ({ ...client, products: client.products.map(p => ({ ...p, active: false })) }));
    await open('/calculator/focaccia', onlyFocaccia({ clients }));
    expect(await screen.findByText(/No products in this tab yet/, undefined, LOAD)).toBeInTheDocument();
  });

  it('keeps to the products of its own recipe, and leaves out a client with none', async () => {
    await open('/calculator/brioche', configOf({ recipes: [FOCACCIA, { ...BRIOCHE, logic: 'orders' }] }));
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(card('Cafe Roma').getAllByRole('listitem')).toHaveLength(1);
    expect(card('Cafe Roma').getByLabelText('Brioche roll (60g)')).toBeInTheDocument();
    expect(main().queryByRole('region', { name: 'Bar Sole' })).not.toBeInTheDocument();
  });
});

describe('the quantity widgets', () => {
  it('is a numeric box for a number product, a decimal one in half kilos for a kg product', async () => {
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Bar Sole' }, LOAD);
    const piece = card('Bar Sole').getByLabelText('Focaccia tray (500g)');
    expect(piece).toHaveAttribute('type', 'number');
    expect(piece).toHaveAttribute('inputmode', 'numeric');
    expect(piece).toHaveAttribute('min', '0');
    const kilos = card('Bar Sole').getByLabelText('Cheese by the kilo');
    expect(kilos).toHaveAttribute('inputmode', 'decimal');
    expect(kilos).toHaveAttribute('step', '0.5');
  });

  it('is a select of 0, 20, 40, 60, 80, 100 for a dropdown product', async () => {
    const { user } = await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    const select = card('Cafe Roma').getByLabelText('Focaccia slab (800g)');
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['0', '20', '40', '60', '80', '100']);
    await user.selectOptions(select, '40');
    expect(select).toHaveValue('40');
    expect(stored('qty-roma::slab')).toBe('40');
    expect(stored('touched-focaccia')).toBe(String(NOW));
  });

  it('shows a number the tab already keeps that is not one of the choices, rather than a lie', async () => {
    window.localStorage.setItem('qty-roma::slab', '30');
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(card('Cafe Roma').getByLabelText('Focaccia slab (800g)')).toHaveValue('30');
  });

  it('empties a 0 when it is tapped, ready to type into', async () => {
    const { user } = await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    const box = card('Cafe Roma').getByLabelText('Focaccia tray (500g)');
    expect(box).toHaveValue(0);
    await user.click(box);
    expect(box).toHaveValue(null);
    await user.keyboard('12');
    expect(box).toHaveValue(12);
    expect(stored('qty-roma::tray')).toBe('12');
  });

  it('selects a number that is not 0 when it is tapped, so the next digit replaces it', async () => {
    window.localStorage.setItem('qty-roma::tray', '7');
    const { user } = await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    const box = card('Cafe Roma').getByLabelText<HTMLInputElement>('Focaccia tray (500g)');
    expect(box).toHaveValue(7);
    // jsdom keeps no selection in a number box, so the call itself is what is watched.
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    await user.click(box);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.contexts[0]).toBe(box);
    expect(box).toHaveValue(7);
  });

  it('puts a 0 back when it is left empty, and keeps it', async () => {
    window.localStorage.setItem('qty-roma::tray', '7');
    const { user } = await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    const box = card('Cafe Roma').getByLabelText('Focaccia tray (500g)');
    await user.clear(box);
    expect(stored('qty-roma::tray')).toBe('');
    await user.tab();
    expect(box).toHaveValue(0);
    expect(stored('qty-roma::tray')).toBe('0');
  });

  it('does not count a box left empty after a tap as a use of the tab', async () => {
    const { user } = await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(card('Cafe Roma').getByLabelText('Focaccia tray (500g)'));
    await user.tab();
    expect(stored('touched-focaccia')).toBeNull();
  });

  it('restores every box from the current app\'s keys, as the text the box shows', async () => {
    window.localStorage.setItem('qty-roma::tray', '4');
    window.localStorage.setItem('qty-sole::cheese', '2.5');
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(card('Cafe Roma').getByLabelText('Focaccia tray (500g)')).toHaveValue(4);
    expect(card('Bar Sole').getByLabelText('Cheese by the kilo')).toHaveValue(2.5);
  });
});

describe('the leavening knob', () => {
  it('is labelled with the leavening ingredient\'s own name and starts at the recipe\'s default %', async () => {
    await open('/calculator/focaccia');
    const knob = await main().findByLabelText('Yeast %', undefined, LOAD);
    expect(knob).toHaveValue(0.5);
  });

  it.each([
    [0.65, { min: '0.1', max: '3', step: '0.05' }],
    [4, { min: '0.1', max: '6', step: '0.1' }],
    [18, { min: '5', max: '40', step: '1' }],
  ])('has a range that follows the default %% (%s)', async (pct, range) => {
    await open('/calculator/focaccia', onlyFocaccia({ recipes: [{ ...FOCACCIA, leaveningDefaultPct: pct, baselinePct: pct }] }));
    const knob = await main().findByLabelText('Yeast %', undefined, LOAD);
    expect(knob).toHaveAttribute('min', range.min);
    expect(knob).toHaveAttribute('max', range.max);
    expect(knob).toHaveAttribute('step', range.step);
  });

  it('is saved per phone in param-<recipe> as typed, and the tab is stamped as used', async () => {
    const { user } = await open('/calculator/focaccia');
    const knob = await main().findByLabelText('Yeast %', undefined, LOAD);
    await user.clear(knob);
    await user.type(knob, '0.8');
    expect(stored('param-focaccia')).toBe('0.8');
    expect(stored('touched-focaccia')).toBe(String(NOW));
  });

  it('comes back from the saved value', async () => {
    window.localStorage.setItem('param-focaccia', '0.8');
    await open('/calculator/focaccia');
    expect(await main().findByLabelText('Yeast %', undefined, LOAD)).toHaveValue(0.8);
  });

  it('goes back to the recipe\'s default when left empty, and keeps it', async () => {
    const { user } = await open('/calculator/focaccia');
    const knob = await main().findByLabelText('Yeast %', undefined, LOAD);
    await user.clear(knob);
    await user.tab();
    expect(knob).toHaveValue(0.5);
    expect(stored('param-focaccia')).toBe('0.5');
  });

  it('is hidden when the recipe does not show it', async () => {
    await open('/calculator/focaccia', onlyFocaccia({ recipes: [{ ...FOCACCIA, showLeavening: false }] }));
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(main().queryByLabelText('Yeast %')).not.toBeInTheDocument();
  });

  it('is never drawn for a recipe that is not an orders recipe, whatever the flag', async () => {
    await open('/calculator/sourdough', configOf({
      recipes: [{ ...SOURDOUGH, leaveningKey: 'water', leaveningDefaultPct: 5, baselinePct: 5, showLeavening: true }],
    }));
    await main().findByLabelText('Number of trays', undefined, LOAD);
    expect(main().queryByLabelText(/%$/)).not.toBeInTheDocument();
  });
});

describe('the total, the trays and the extra dough, by logic', () => {
  it('an orders recipe has orders and extra dough, no total and no trays', async () => {
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(main().getByRole('heading', { level: 2, name: 'Orders' })).toBeInTheDocument();
    expect(main().getByLabelText('Extra dough')).toBeInTheDocument();
    expect(main().queryByLabelText('Total dough (g)')).not.toBeInTheDocument();
    expect(main().queryByLabelText('Number of trays')).not.toBeInTheDocument();
  });

  it('a total recipe has only the total', async () => {
    await open('/calculator/brioche');
    await main().findByLabelText('Total dough (g)', undefined, LOAD);
    expect(main().queryByRole('heading', { level: 2, name: 'Orders' })).not.toBeInTheDocument();
    expect(main().queryByLabelText('Extra dough')).not.toBeInTheDocument();
    expect(main().queryByLabelText('Number of trays')).not.toBeInTheDocument();
  });

  it('a «both» recipe has the knob, the total, the orders and the extra', async () => {
    await open('/calculator/focaccia', onlyFocaccia({ recipes: [{ ...FOCACCIA, logic: 'both' }] }));
    await main().findByLabelText('Total dough (g)', undefined, LOAD);
    for (const label of ['Yeast %', 'Extra dough']) expect(main().getByLabelText(label)).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 2, name: 'Orders' })).toBeInTheDocument();
  });

  it('a trays recipe has the trays, a «traysTotal» one the trays and the total', async () => {
    await open('/calculator/sourdough');
    await main().findByLabelText('Number of trays', undefined, LOAD);
    expect(main().queryByLabelText('Total dough (g)')).not.toBeInTheDocument();
  });

  it('a traysTotal recipe has both', async () => {
    await open('/calculator/sourdough', configOf({ recipes: [{ ...SOURDOUGH, logic: 'traysTotal' }] }));
    await main().findByLabelText('Number of trays', undefined, LOAD);
    expect(main().getByLabelText('Total dough (g)')).toBeInTheDocument();
  });

  it('keeps the total in total-<recipe>, as typed', async () => {
    const { user } = await open('/calculator/brioche');
    const box = await main().findByLabelText('Total dough (g)', undefined, LOAD);
    await user.click(box);
    await user.keyboard('2500');
    expect(stored('total-brioche')).toBe('2500');
    expect(stored('touched-brioche')).toBe(String(NOW));
  });
});

describe('the extra dough', () => {
  it('defaults to kilos and keeps the amount and the unit in extra-<recipe> and extra-unit-<recipe>', async () => {
    const { user } = await open('/calculator/focaccia');
    const unit = await main().findByLabelText('Extra dough unit', undefined, LOAD);
    expect(unit).toHaveValue('kg');
    await user.click(main().getByLabelText('Extra dough'));
    await user.keyboard('1.5');
    expect(stored('extra-focaccia')).toBe('1.5');
    await user.selectOptions(unit, 'g');
    expect(stored('extra-unit-focaccia')).toBe('g');
    expect(stored('touched-focaccia')).toBe(String(NOW));
  });

  it('is hidden for a recipe whose extra dough is switched off', async () => {
    await open('/calculator/focaccia', onlyFocaccia({ extraDough: { focaccia: false } }));
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(main().queryByLabelText('Extra dough')).not.toBeInTheDocument();
  });

  it('is capped at 500 kg: a mistyped 1000 kg makes 500 kg of dough', async () => {
    const { user } = await open('/calculator/focaccia', onlyFocaccia({ clients: [] }));
    await user.click(await main().findByLabelText('Extra dough', undefined, LOAD));
    await user.keyboard('1000');
    expect(main().getByText('500,000 g raw')).toBeInTheDocument();
  });
});

describe('the trays', () => {
  it('says what the trays make, beside the label, linked to the box and polite', async () => {
    const { user } = await open('/calculator/sourdough');
    const box = await main().findByLabelText('Number of trays', undefined, LOAD);
    const says = main().getByText('= 0 g');
    expect(says).toHaveAttribute('aria-live', 'polite');
    expect(box.getAttribute('aria-describedby')).toBe(says.id);
    // The field's name does not carry the grams: it would change on every keystroke.
    expect(box).toHaveAccessibleName('Number of trays');
    await user.click(box);
    await user.keyboard('5');
    expect(main().getByText('= 6,000 g')).toBeInTheDocument();
    expect(stored('trays-sourdough')).toBe('5');
    expect(stored('touched-sourdough')).toBe(String(NOW));
  });

  it('uses the recipe\'s tray weight, and reads a stored one under 50 g as 1000', async () => {
    window.localStorage.setItem('trays-sourdough', '2');
    await open('/calculator/sourdough', configOf({ recipes: [{ ...SOURDOUGH, trayWeight: 1.2 }] }));
    expect(await main().findByText('= 2,000 g', undefined, LOAD)).toBeInTheDocument();
  });

  it('replaces a fraction by the whole number the maths used when the box is left', async () => {
    const { user } = await open('/calculator/sourdough');
    const box = await main().findByLabelText('Number of trays', undefined, LOAD);
    await user.click(box);
    await user.keyboard('2.7');
    // While typing, the box is left alone.
    expect(box).toHaveValue(2.7);
    expect(main().getByText('= 2,400 g')).toBeInTheDocument();
    await user.tab();
    expect(box).toHaveValue(2);
    expect(stored('trays-sourdough')).toBe('2');
  });

  it('replaces it on Enter too', async () => {
    const { user } = await open('/calculator/sourdough');
    const box = await main().findByLabelText('Number of trays', undefined, LOAD);
    await user.click(box);
    await user.keyboard('3.9{Enter}');
    expect(box).toHaveValue(3);
    expect(stored('trays-sourdough')).toBe('3');
  });

  it('shows a stored fraction as the whole number the maths uses', async () => {
    window.localStorage.setItem('trays-sourdough', '2.5');
    await open('/calculator/sourdough');
    expect(await main().findByLabelText('Number of trays', undefined, LOAD)).toHaveValue(2);
  });

  it('groups the thousands in Italian too', async () => {
    window.localStorage.setItem('trays-sourdough', '5');
    await open('/calculator/sourdough', configOf(), 'it');
    expect((await screen.findAllByText('= 6.000 g', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(await main().findByLabelText('Numero di teglie')).toHaveValue(5);
  });
});

describe('what the boxes decide', () => {
  it('makes brioche from the typed total only', async () => {
    const { user } = await open('/calculator/brioche');
    await user.click(await main().findByLabelText('Total dough (g)', undefined, LOAD));
    await user.keyboard('1000');
    expect(main().getByText('1,000 g raw')).toBeInTheDocument();
  });

  it('adds the orders and the extra dough on an orders recipe', async () => {
    const { user } = await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(card('Cafe Roma').getByLabelText('Focaccia tray (500g)'));
    await user.keyboard('4');
    await user.click(card('Bar Sole').getByLabelText('Cheese by the kilo'));
    await user.keyboard('1.5');
    await user.click(main().getByLabelText('Extra dough'));
    await user.keyboard('0.5');
    // 4 x 500 g + 1.5 x 1000 g + 0.5 kg.
    expect(main().getByText('4,000 g raw')).toBeInTheDocument();
  });
});
