import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { it as italian } from '../i18n/it';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import {
  closedMonthDoc, freezeClock, ingredient, monthDoc, renderStocktake,
} from '../testing/renderStocktake';

// One product: the answer at the top and its three states, the three boxes and where they save,
// the pack weight box, and Back. The pack note's every sentence is in productValue.spec.ts; here
// it is read on the screen. Money follows the venue's country, quantities the interface language.

beforeAll(async () => { await import('./StocktakeSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };
// The save is sent 700ms after the last change; this is the real clock.
const SAVED = { timeout: 4000 };

const EMPLOYEE = {
  canManage: false,
  isOwner: false,
  role: 'staff' as const,
  location: { country: 'GB', staffShownCards: { inventory: true } },
};
const IT_VENUE = { location: { country: 'IT' } };
const GB_VENUE = { location: { country: 'GB' } };

const EGGS_CASE = { casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.4 };
const STRAW_CASE = { casePrice: 3.49, caseCount: 2000, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.001745 };

const INGREDIENTS = [
  // 25 kg a sack at 0.80 a kilo: one sack is worth 20.
  ingredient('flour', { name: 'Farina 00', shortName: 'Farina', weight: '25kg', unit: 'sacco', category: 'Dispensa' }),
  // No price, and no unit: the answer is in «packs».
  ingredient('sugar', { name: 'Zucchero', weight: '2.5kg', unit: '', category: 'Dispensa' }),
  // Priced by the kilo, but the pack text says nothing about a weight.
  ingredient('cocoa', { name: 'Cacao', weight: 'sacco', unit: 'sacco', category: 'Dispensa' }),
  ingredient('box', { name: 'Scatola', unit: 'pz', category: 'Imballi' }),
  ingredient('eggs', { name: 'Uova', unit: 'pz', category: 'Frigo' }),
  ingredient('straw', { name: 'Cannuccia', unit: 'pz', category: 'Imballi' }),
  ingredient('plain', { name: 'Sale', weight: '', unit: 'kg', category: 'Dispensa' }),
];

const PRICES = {
  flour: { priceUnit: 'kg', pricePerUnit: 0.8 },
  cocoa: { priceUnit: 'kg', pricePerUnit: 5 },
  box: { priceUnit: 'pcs', pricePerUnit: 0.15 },
  eggs: EGGS_CASE,
  straw: STRAW_CASE,
  plain: { priceUnit: 'kg', pricePerUnit: 2 },
};

function source(months = [monthDoc('2026-10')], prices: Record<string, Record<string, unknown>> = PRICES) {
  return fakeStocktakeSource({ months, ingredients: INGREDIENTS, prices });
}

type Options = Parameters<typeof renderStocktake>[1];

const region = (name: string) => screen.findByRole('region', { name }, LOAD);
const inRegion = (name: string) => within(screen.getByRole('region', { name }));

async function open(id: string, name: string, fake = source(), options: Options = {}, month = '2026-10') {
  const view = renderStocktake(`/stocktake/${month}/product/${id}`, { source: fake, ...options });
  await region(name);
  return { ...view, fake };
}

// The three boxes of the product screen, by their visible labels.
const openingBox = () => screen.getByRole('textbox', { name: 'How many there were when the month opened' });
const purchasedBox = () => screen.getByRole('textbox', { name: 'How many you bought during the month' });
const closingBox = () => screen.getByRole('textbox', { name: 'How many there are now' });
const packBox = () => screen.getByRole('textbox', { name: 'How many kg one pack is' });
const enabled = (box: () => HTMLElement) => waitFor(() => { expect(box()).toBeEnabled(); }, LOAD);

// The card holding «Used this month», with its state.
const answerOf = (name: string) => inRegion(name).getByText('Used this month').parentElement as HTMLElement;

describe('one product: the title', () => {
  it('names the product the way the list does, with the month under it', async () => {
    await open('flour', 'Farina 25kg');
    expect(screen.getByRole('heading', { level: 2, name: 'Farina 25kg' })).toBeInTheDocument();
    expect(inRegion('Farina 25kg').getByText('October 2026')).toBeInTheDocument();
  });

  it('says «Product with no name» for a product that has neither name nor pack text', async () => {
    const fake = fakeStocktakeSource({
      months: [closedMonthDoc('2026-09', { names: { gone: '' }, closing: { gone: 1 } })],
      ingredients: [ingredient('x', { name: 'Anything' })],
    });
    await open('gone', 'Product with no name', fake, {}, '2026-09');
    expect(screen.getByRole('heading', { level: 2, name: 'Product with no name' })).toBeInTheDocument();
  });
});

describe('one product: the answer', () => {
  it('is «—» with the way to fix it when nothing was counted', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', { opening: { flour: 30 } })]));
    const answer = answerOf('Farina 25kg');
    expect(answer).toHaveAttribute('data-state', 'unknown');
    expect(within(answer).getByText('—')).toBeInTheDocument();
    expect(within(answer).getByText('Count what is left and this answers itself.')).toBeInTheDocument();
    expect(within(answer).queryByText(/Had /)).not.toBeInTheDocument();
    expect(answer.textContent).not.toMatch(/£/);
  });

  it('is «—» with the way to fix it when there is no opening figure', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', { closing: { flour: 8 } })]));
    const answer = answerOf('Farina 25kg');
    expect(answer).toHaveAttribute('data-state', 'unknown');
    expect(within(answer).getByText('Say how many there were when the month opened and this answers itself.')).toBeInTheDocument();
  });

  it('shows the number with its unit, how it was made, and what it cost', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 30 }, purchased: { flour: 5 }, closing: { flour: 8 } })]);
    await open('flour', 'Farina 25kg', fake, { session: GB_VENUE });
    const answer = answerOf('Farina 25kg');
    expect(answer).toHaveAttribute('data-state', 'known');
    expect(within(answer).getByText('27 sacco')).toBeInTheDocument();
    expect(within(answer).getByText('Had 30 · bought 5 · left 8')).toBeInTheDocument();
    // 27 sacks at 0.80 × 25 kg.
    expect(within(answer).getByText('£540.00')).toBeInTheDocument();
    expect(within(answer).queryByText(/more here than you started/)).not.toBeInTheDocument();
  });

  it('counts a purchase nobody typed as none bought', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', { opening: { flour: 30 }, closing: { flour: 8 } })]));
    const answer = answerOf('Farina 25kg');
    expect(within(answer).getByText('22 sacco')).toBeInTheDocument();
    expect(within(answer).getByText('Had 30 · bought 0 · left 8')).toBeInTheDocument();
  });

  // ⚠️ SHOWN, NEVER CLAMPED: more left than could possibly be there means a number is wrong.
  it('shows a negative answer as it is, with the warning', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 5 }, closing: { flour: 8 } })]);
    await open('flour', 'Farina 25kg', fake);
    const answer = answerOf('Farina 25kg');
    expect(answer).toHaveAttribute('data-state', 'negative');
    expect(within(answer).getByText('-3 sacco')).toBeInTheDocument();
    expect(within(answer).getByText(
      'There is more here than you started with plus everything you bought. One of the three numbers is wrong.',
    )).toBeInTheDocument();
    expect(within(answer).getByText('£-60.00')).toBeInTheDocument();
  });

  it('says «packs» when the product has no unit', async () => {
    await open('sugar', 'Zucchero 2.5kg', source([monthDoc('2026-10', { opening: { sugar: 4 }, closing: { sugar: 1 } })]));
    expect(within(answerOf('Zucchero 2.5kg')).getByText('3 packs')).toBeInTheDocument();
  });

  it('writes a quantity in the interface language: a decimal comma in Italian, whatever the venue', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 30 }, closing: { flour: 2.5 } })]);
    await open('flour', 'Farina 25kg', fake, { lang: 'it', session: GB_VENUE });
    const answer = screen.getByText(italian['stock.usedThisMonth']).parentElement as HTMLElement;
    expect(within(answer).getByText('27,5 sacco')).toBeInTheDocument();
    // The money follows the venue (Britain), not the language.
    expect(within(answer).getByText('£550.00')).toBeInTheDocument();
  });
});

describe('one product: the money follows the venue\'s country', () => {
  const counted = () => source([monthDoc('2026-10', { opening: { flour: 30 }, closing: { flour: 8.5 } })]);

  it('is in pounds for a British venue', async () => {
    await open('flour', 'Farina 25kg', counted(), { session: GB_VENUE });
    expect(within(answerOf('Farina 25kg')).getByText('£430.00')).toBeInTheDocument();
  });

  it('is in euros, in the Italian layout, for an Italian venue — whatever the language', async () => {
    await open('flour', 'Farina 25kg', counted(), { session: IT_VENUE, lang: 'en' });
    const answer = answerOf('Farina 25kg');
    // (Testing Library folds the layout's no-break space into a plain one before it compares.)
    expect(within(answer).getByText('430,00 €')).toBeInTheDocument();
    // The quantity keeps the interface language's layout.
    expect(within(answer).getByText('21.5 sacco')).toBeInTheDocument();
  });

  it('falls back to the pound when the venue has no country', async () => {
    await open('flour', 'Farina 25kg', counted(), { session: { location: {} } });
    expect(within(answerOf('Farina 25kg')).getByText('£430.00')).toBeInTheDocument();
  });
});

describe('one product: why a count has no money beside it', () => {
  const counted = (id: string) => [monthDoc('2026-10', { opening: { [id]: 10 }, closing: { [id]: 4 } })];

  it('says «no price entered» for a product with no price', async () => {
    await open('sugar', 'Zucchero 2.5kg', source(counted('sugar')));
    expect(within(answerOf('Zucchero 2.5kg')).getByText('no price entered')).toBeInTheDocument();
  });

  it('says «pack weight unknown» for a priced product whose pack weight cannot be read', async () => {
    await open('cocoa', 'Cacao sacco', source(counted('cocoa')));
    expect(within(answerOf('Cacao sacco')).getByText('pack weight unknown')).toBeInTheDocument();
  });

  it('says what was not recorded, on a closed month with no frozen price', async () => {
    const fake = source([closedMonthDoc('2026-09', {
      names: { flour: 'Farina 25kg' }, opening: { flour: 10 }, closing: { flour: 4 },
    })]);
    await open('flour', 'Farina 25kg', fake, {}, '2026-09');
    expect(within(answerOf('Farina 25kg')).getByText('no price recorded when the month closed')).toBeInTheDocument();
  });

  it('values a closed month at what it froze, never at today\'s price', async () => {
    const fake = source([closedMonthDoc('2026-09', {
      names: { flour: 'Farina 25kg' }, opening: { flour: 10 }, closing: { flour: 4 }, unitPrice: { flour: 12 },
    })]);
    await open('flour', 'Farina 25kg', fake, {}, '2026-09');
    // 6 sacks at the frozen 12, not at today's 20.
    expect(within(answerOf('Farina 25kg')).getByText('£72.00')).toBeInTheDocument();
  });
});

describe('one product: the three boxes', () => {
  it('has a visible label and a hint under each, which describes the box', async () => {
    await open('flour', 'Farina 25kg');
    const region = inRegion('Farina 25kg');
    for (const [label, hint] of [
      ['How many there were when the month opened', 'Written once. From next month the app carries it forward from what was left.'],
      ['How many you bought during the month', 'Left empty it counts as none bought.'],
      ['How many there are now', 'Half a pack is 0.5.'],
    ] as const) {
      const box = region.getByRole('textbox', { name: label });
      expect(box).toHaveAccessibleDescription(hint);
      // A real <label>, so a tap on the words reaches the box.
      expect(region.getByText(label).tagName).toBe('LABEL');
      expect(region.getByText(hint)).toBeInTheDocument();
    }
    expect(region.getByText('A box left empty means “not counted yet”, never zero.')).toBeInTheDocument();
  });

  it('shows what the month holds in each', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', {
      opening: { flour: 30 }, purchased: { flour: 5.5 }, closing: { flour: 8 },
    })]));
    expect(openingBox()).toHaveValue('30');
    expect(purchasedBox()).toHaveValue('5.5');
    expect(closingBox()).toHaveValue('8');
  });

  // ⚠️ Purchased is the one field whose absence means zero: an empty box, never a 0 nobody typed.
  it('shows purchased empty when nobody has typed it, and a zero that was typed', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', { opening: { flour: 30 }, closing: { flour: 8 } })]));
    expect(purchasedBox()).toHaveValue('');
    expect(openingBox()).toHaveValue('30');
  });

  it('keeps a zero in purchased, which is a real answer', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', { purchased: { flour: 0 } })]));
    expect(purchasedBox()).toHaveValue('0');
  });

  it('saves each box into its own map, as one write', async () => {
    const { user, fake } = await open('flour', 'Farina 25kg');
    await enabled(openingBox);
    await user.type(openingBox(), '30');
    await user.type(purchasedBox(), '5');
    await user.type(closingBox(), '8');
    await user.tab();

    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    const patch = fake.saved[0]?.patch;
    expect(patch?.opening).toEqual({ flour: 30 });
    expect(patch?.purchased).toEqual({ flour: 5 });
    expect(patch?.closing).toEqual({ flour: 8 });
    expect(patch?.packKg).toBeUndefined();
    // The answer is worked out at once, from the numbers just typed.
    expect(within(answerOf('Farina 25kg')).getByText('27 sacco')).toBeInTheDocument();
  });

  it('reads a comma as the decimal point', async () => {
    const { user, fake } = await open('flour', 'Farina 25kg');
    await enabled(openingBox);
    await user.type(openingBox(), '2,5');
    await user.tab();
    expect(openingBox()).toHaveValue('2.5');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.opening).toEqual({ flour: 2.5 });
  });

  it('clears a box that was emptied, in the same write', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 30 }, purchased: { flour: 5 } })]);
    const { user } = await open('flour', 'Farina 25kg', fake);
    await enabled(purchasedBox);
    await user.clear(purchasedBox());
    await user.tab();
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.clear).toEqual({ purchased: { flour: true } });
    expect(fake.months.get('2026-10')?.purchased).toEqual({});
  });

  it('never shows a thousands separator, whatever the language', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', { opening: { flour: 1234.5 } })]), { lang: 'it' });
    expect(screen.getByRole('textbox', { name: italian['stock.openingCount'] })).toHaveValue('1234,5');
  });
});

describe('one product: the boxes follow the live month', () => {
  it('shows another phone\'s count in a box that does not have the focus', async () => {
    const { fake } = await open('flour', 'Farina 25kg');
    await enabled(closingBox);
    fake.months.set('2026-10', monthDoc('2026-10', { opening: { flour: 12 }, closing: { flour: 7 } }));
    fake.push();
    await waitFor(() => { expect(closingBox()).toHaveValue('7'); });
    expect(openingBox()).toHaveValue('12');
    expect(within(answerOf('Farina 25kg')).getByText('5 sacco')).toBeInTheDocument();
  });

  it('never writes into the box being typed into', async () => {
    const { user, fake } = await open('flour', 'Farina 25kg');
    await enabled(openingBox);
    await user.type(openingBox(), '3,');

    fake.months.set('2026-10', monthDoc('2026-10', { opening: { flour: 99 }, closing: { flour: 7 } }));
    fake.push();
    // The box not being typed into follows the month…
    await waitFor(() => { expect(closingBox()).toHaveValue('7'); });
    // …and the one with the focus keeps the half-typed text and the caret.
    expect(openingBox()).toHaveValue('3,');
    expect(openingBox()).toHaveFocus();
  });

  it('does not overwrite a colleague\'s count with a number nobody typed', async () => {
    const { user, fake } = await open('flour', 'Farina 25kg');
    await enabled(openingBox);
    await user.click(openingBox());
    fake.months.set('2026-10', monthDoc('2026-10', { opening: { flour: 99 } }));
    fake.push();
    await user.tab();
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
    expect(fake.months.get('2026-10')?.opening).toEqual({ flour: 99 });
  });
});

describe('one product: when the boxes can be typed into', () => {
  it('shuts every box on a closed month, which still shows its figures', async () => {
    const fake = source([closedMonthDoc('2026-09', {
      names: { flour: 'Farina 25kg' }, opening: { flour: 30 }, purchased: { flour: 2 }, closing: { flour: 8 },
    })]);
    await open('flour', 'Farina 25kg', fake, {}, '2026-09');
    await waitFor(() => { expect(openingBox()).toBeDisabled(); }, LOAD);
    expect(purchasedBox()).toBeDisabled();
    expect(closingBox()).toBeDisabled();
    expect(openingBox()).toHaveValue('30');
    expect(closingBox()).toHaveValue('8');
  });

  it('shuts them until the month has answered once, and opens them when it does', async () => {
    const fake = source();
    fake.hold();
    renderStocktake('/stocktake/2026-10/product/flour', { source: fake });
    await region('Farina 25kg');
    expect(openingBox()).toBeDisabled();
    expect(closingBox()).toBeDisabled();

    act(() => { fake.release(); });
    await enabled(openingBox);
    expect(closingBox()).toBeEnabled();
  });

  it('shuts under somebody\'s fingers when the month is closed on another phone', async () => {
    const { fake } = await open('flour', 'Farina 25kg');
    await enabled(openingBox);
    fake.months.set('2026-10', closedMonthDoc('2026-10', { names: { flour: 'Farina 25kg' } }));
    fake.push();
    await waitFor(() => { expect(openingBox()).toBeDisabled(); });
    expect(packBox()).toBeDisabled();
  });
});

describe('one product: the weight of a pack', () => {
  it('is offered with the weight read from the pack text as its placeholder', async () => {
    await open('flour', 'Farina 25kg');
    expect(packBox()).toHaveValue('');
    expect(packBox()).toHaveAttribute('placeholder', '25');
  });

  it('writes the placeholder the interface language\'s way', async () => {
    await open('sugar', 'Zucchero 2.5kg', source(), { lang: 'it' });
    expect(screen.getByRole('textbox', { name: italian['stock.packKgLabel'] })).toHaveAttribute('placeholder', '2,5');
  });

  it('has no placeholder when the pack text cannot be read', async () => {
    await open('cocoa', 'Cacao sacco');
    expect(packBox()).not.toHaveAttribute('placeholder');
  });

  it('shows the weight somebody typed, with no thousands separator', async () => {
    await open('flour', 'Farina 25kg', source([monthDoc('2026-10', { packKg: { flour: 1234.5 } })]));
    expect(packBox()).toHaveValue('1234.5');
  });

  it('saves the typed weight into packKg, and the note and the cost follow it', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 10 }, closing: { flour: 8 } })]);
    const { user } = await open('flour', 'Farina 25kg', fake);
    expect(inRegion('Farina 25kg').getByText('One pack is read as 25 kg, and costs about £20.00.')).toBeInTheDocument();
    await enabled(packBox);
    await user.type(packBox(), '20');
    await user.tab();

    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.packKg).toEqual({ flour: 20 });
    expect(inRegion('Farina 25kg').getByText('One pack is read as 20 kg, and costs about £16.00.')).toBeInTheDocument();
    // 2 sacks at 16.
    expect(within(answerOf('Farina 25kg')).getByText('£32.00')).toBeInTheDocument();
    expect(packBox()).toHaveAccessibleDescription('One pack is read as 20 kg, and costs about £16.00.');
  });

  it('is left out for a product priced by the piece, whose note stands alone', async () => {
    await open('box', 'Scatola');
    expect(screen.queryByRole('textbox', { name: 'How many kg one pack is' })).not.toBeInTheDocument();
    expect(inRegion('Scatola').getByText('Priced by the piece, about £0.15 each — no weight needed.')).toBeInTheDocument();
  });

  it('is left out for a product priced by the case, whose note stands alone', async () => {
    await open('eggs', 'Uova');
    expect(screen.queryByRole('textbox', { name: 'How many kg one pack is' })).not.toBeInTheDocument();
    expect(inRegion('Uova').getByText('Priced by the case: £0.40 per pz')).toBeInTheDocument();
  });

  it('has no placeholder on a closed month, and says what was frozen', async () => {
    const fake = source([closedMonthDoc('2026-09', { names: { flour: 'Farina 25kg' }, unitPrice: { flour: 20 } })]);
    await open('flour', 'Farina 25kg', fake, {}, '2026-09');
    expect(packBox()).not.toHaveAttribute('placeholder');
    expect(packBox()).toBeDisabled();
    expect(inRegion('Farina 25kg').getByText('One of these was worth about £20.00 when the month was closed.')).toBeInTheDocument();
  });
});

describe('one product: the pack note', () => {
  const note = (name: string) => inRegion(name);

  it('says one pack is read as its kilos, with the cost, in the venue\'s layout', async () => {
    await open('flour', 'Farina 25kg', source(), { session: IT_VENUE });
    expect(note('Farina 25kg').getByText('One pack is read as 25 kg, and costs about 20,00 €.')).toBeInTheDocument();
  });

  it('says only the kilos when there is no price', async () => {
    await open('sugar', 'Zucchero 2.5kg');
    expect(note('Zucchero 2.5kg').getByText('One pack is read as 2.5 kg.')).toBeInTheDocument();
  });

  it('quotes the pack text it cannot read', async () => {
    await open('cocoa', 'Cacao sacco');
    expect(note('Cacao sacco').getByText('No weight can be read from “sacco”. Write the kilos in and this product gets a cost.')).toBeInTheDocument();
  });

  it('says there is no pack size when there is no pack text', async () => {
    await open('plain', 'Sale');
    expect(note('Sale').getByText('This product has no pack size. Write the kilos in and it gets a cost.')).toBeInTheDocument();
  });

  it('says a product priced by the piece has no price yet when it has none', async () => {
    await open('box', 'Scatola', source([monthDoc('2026-10')], { box: { priceUnit: 'pcs', pricePerUnit: null } }));
    expect(note('Scatola').getByText('Priced by the piece, but no price has been entered.')).toBeInTheDocument();
  });

  // ⚠️ One straw out of 2000 is 0.17 pence: «£0.00» would read as free.
  it('never shows a tiny rate as 0.00', async () => {
    await open('straw', 'Cannuccia');
    expect(note('Cannuccia').getByText('Priced by the case: £0.001745 per pz')).toBeInTheDocument();
    expect(note('Cannuccia').queryByText(/£0\.00 /)).not.toBeInTheDocument();
  });

  it('says nothing was recorded about the cost of a closed month that froze no price', async () => {
    const fake = source([closedMonthDoc('2026-09', { names: { flour: 'Farina 25kg' } })]);
    await open('flour', 'Farina 25kg', fake, {}, '2026-09');
    expect(note('Farina 25kg').getByText(/^Nothing was recorded about what this cost when the month was closed/)).toBeInTheDocument();
  });

  it('speaks Italian', async () => {
    await open('flour', 'Farina 25kg', source(), { lang: 'it', session: IT_VENUE });
    expect(screen.getByText('Una confezione risulta di 25 kg e costa circa 20,00 €.')).toBeInTheDocument();
  });
});

describe('one product: an employee', () => {
  const counted = () => source([monthDoc('2026-10', { opening: { flour: 30 }, closing: { flour: 8 } })]);

  it('sees the answer and the three boxes, and no money anywhere', async () => {
    await open('flour', 'Farina 25kg', counted(), { session: EMPLOYEE });
    const answer = answerOf('Farina 25kg');
    expect(within(answer).getByText('22 sacco')).toBeInTheDocument();
    expect(within(answer).getByText('Had 30 · bought 0 · left 8')).toBeInTheDocument();
    expect(openingBox()).toBeInTheDocument();
    expect(closingBox()).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[£€]/);
    expect(document.body.textContent).not.toMatch(/no price entered|pack weight unknown|One pack is read as|Priced by/);
  });

  it('has no pack weight box, and no pack note even for a product priced by the piece or the case', async () => {
    await open('flour', 'Farina 25kg', counted(), { session: EMPLOYEE });
    expect(screen.queryByRole('textbox', { name: 'How many kg one pack is' })).not.toBeInTheDocument();
    expect(screen.queryByText(/One pack is read as/)).not.toBeInTheDocument();
  });

  it.each([['box', 'Scatola'], ['eggs', 'Uova']])('shows no note for %s', async (id, name) => {
    await open(id, name, counted(), { session: EMPLOYEE });
    expect(screen.queryByText(/Priced by/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[£€]/);
  });

  it('can count, as the rules allow', async () => {
    const { user, fake } = await open('flour', 'Farina 25kg', counted(), { session: EMPLOYEE });
    await enabled(purchasedBox);
    await user.type(purchasedBox(), '4');
    await user.tab();
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.purchased).toEqual({ flour: 4 });
  });

  it('is told, in place of the product, that a month the rules refuse cannot be opened here', async () => {
    const fake = source();
    fake.refuse.watchMonth = true;
    renderStocktake('/stocktake/2026-09/product/flour', { source: fake, session: EMPLOYEE });
    // The list says it too (its own column), so it is found where the product would be.
    const sentence = 'This month cannot be opened here: it is closed, or the Stocktake is no longer shown to employees. Owners and managers still see it.';
    await waitFor(() => { expect(inRegion('September 2026').getByText(sentence)).toBeInTheDocument(); }, LOAD);
    expect(screen.queryByRole('textbox', { name: 'How many there are now' })).not.toBeInTheDocument();
  });
});

describe('one product: an address that names no product of the month', () => {
  it('goes back to the month\'s list by replacing the address', async () => {
    const { router } = renderStocktake('/stocktake/2026-10/product/nothing-here', { source: source() });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-10'); }, LOAD);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findAllByRole('heading', { level: 3 }, LOAD)).not.toHaveLength(0);
  });

  it('does not send a product of a closed month away because it was deleted since', async () => {
    const fake = source([closedMonthDoc('2026-09', { names: { deleted: 'Old flour 5kg' }, opening: { deleted: 5 }, closing: { deleted: 1 } })]);
    const { router } = await open('deleted', 'Old flour 5kg', fake, {}, '2026-09');
    expect(router.state.location.pathname).toBe('/stocktake/2026-09/product/deleted');
    expect(within(answerOf('Old flour 5kg')).getByText('4 packs')).toBeInTheDocument();
  });

  // ⚠️ UNTIL THE MONTH HAS ANSWERED, THE LIST OF PRODUCTS IS THE LIVE ONE, not the closed month's
  // frozen one: a product that is only in the frozen list must not be sent away for being missing.
  it('says «Loading…» and sends nobody away until the month has answered', async () => {
    const fake = source([closedMonthDoc('2026-09', { names: { deleted: 'Old flour 5kg' }, opening: { deleted: 5 }, closing: { deleted: 1 } })]);
    fake.hold();
    const { router } = renderStocktake('/stocktake/2026-09/product/deleted', { source: fake });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    expect(router.state.location.pathname).toBe('/stocktake/2026-09/product/deleted');

    act(() => { fake.release(); });
    await region('Old flour 5kg');
    expect(router.state.location.pathname).toBe('/stocktake/2026-09/product/deleted');
  });

  it('opens a product whose id has a slash and a space in it', async () => {
    const fake = fakeStocktakeSource({
      months: [monthDoc('2026-10')],
      ingredients: [ingredient('a/b c', { name: 'Odd' })],
    });
    await open('a%2Fb%20c', 'Odd', fake);
    expect(inRegion('Odd').getByText('Used this month')).toBeInTheDocument();
  });
});

describe('one product: Back and the focus', () => {
  const openButton = (name: string) => screen.getByRole('button', { name: `Open ${name}` });

  it('opened from the list: puts the focus on its title, and Back steps up and hands the focus to the row', async () => {
    const { router, user } = renderStocktake('/stocktake/2026-10', { source: source() });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    await user.click(openButton('Farina 25kg'));
    const title = await screen.findByRole('heading', { level: 2, name: 'Farina 25kg' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/product/flour');
    expect(router.state.historyAction).toBe('PUSH');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-10'); });
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => { expect(openButton('Farina 25kg')).toHaveFocus(); });
  });

  it('opened by its address: Back replaces it with the list, with the focus on the row', async () => {
    const { router, user } = await open('flour', 'Farina 25kg');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/stocktake/2026-10'); });
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => { expect(openButton('Farina 25kg')).toHaveFocus(); });
  });

  it('leaves the focus alone when the screen is opened by its address', async () => {
    await open('flour', 'Farina 25kg');
    expect(screen.getByRole('heading', { level: 2, name: 'Farina 25kg' })).not.toHaveFocus();
  });

  it('keeps what was typed when Back returns to the list', async () => {
    const fake = source();
    const { user } = renderStocktake('/stocktake/2026-10', { source: fake });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    await user.click(openButton('Farina 25kg'));
    await enabled(closingBox);
    await user.type(closingBox(), '6');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('textbox', { name: 'How many of Farina 25kg are left' })).toHaveValue('6');
  });
});

describe('one product: on the tablet\'s split', () => {
  function split() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1000px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  it('opens on the right beside the list, and picking another product leaves the focus on the row', async () => {
    split();
    const { router, user } = renderStocktake('/stocktake/2026-10', { source: source() });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Open Zucchero 2.5kg' }));
    await region('Zucchero 2.5kg');
    expect(screen.getByRole('button', { name: 'Open Farina 25kg' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Farina 25kg' }));
    await region('Farina 25kg');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByRole('button', { name: 'Open Farina 25kg' })).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Zucchero 2.5kg' })).not.toBeInTheDocument();
  });

  it('shows the answer of the new product, not the old one\'s, and its own boxes', async () => {
    split();
    const fake = source([monthDoc('2026-10', { opening: { flour: 30, sugar: 9 }, closing: { flour: 8 } })]);
    const { user } = renderStocktake('/stocktake/2026-10/product/flour', { source: fake });
    await region('Farina 25kg');
    await user.click(screen.getByRole('button', { name: 'Open Zucchero 2.5kg' }));
    await region('Zucchero 2.5kg');
    expect(openingBox()).toHaveValue('9');
    expect(closingBox()).toHaveValue('');
    expect(answerOf('Zucchero 2.5kg')).toHaveAttribute('data-state', 'unknown');
  });
});
