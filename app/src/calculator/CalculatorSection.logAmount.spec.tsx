import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { NOW, logOf, sheetOf, versionOf } from '../testing/logFixtures';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// Item 39 of docs/mise2-port-owed.md (current app b00983dc, 4b235f3d): a dough confirmed «from a total» says how much it
// is in the Dough history, instead of «No products entered.». The pure rule (doughAmountLine) is in
// shared/src/log-dough-amount.spec.ts, run against the current app's own function.
//
// ⚠️ jsdom applies no media query, so the list stays in the page behind a log it has opened (a phone hides it with CSS):
// the list card's own line is always there, and what the OPENED screen adds is counted on top of it.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));

const fromTotal = logOf('t', {
  dough: 'Focaccia',
  versions: [versionOf({ items: [], text: '', sheet: sheetOf('Focaccia', { total_g: 1650 }) })],
});
const ordersAndTotal = logOf('b', {
  dough: 'Brioche',
  recipeId: 'brioche',
  versions: [versionOf({ sheet: sheetOf('Brioche', { total_g: 2400, typed_g: 400 }) })],
});

async function open(path: string, logs: ReturnType<typeof logOf>[], lang: 'en' | 'it' = 'en') {
  const source = fakeCalculatorSource({ config: configOf({ logRetentionHours: 24 }), logs });
  const view = renderCalculator(path, { source, lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  return { ...view, source };
}

describe('the list card', () => {
  it('⚠️ says the total of a «from a total» dough, never «No products entered.»', async () => {
    await open('/calculator/log', [fromTotal]);
    expect(await main().findByText('Total dough: 1,650 g', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByText('No products entered.')).not.toBeInTheDocument();
  });

  it('says it in Italian, with the dot in the thousands', async () => {
    await open('/calculator/log', [fromTotal], 'it');
    expect(await main().findByText('Impasto totale: 1.650 g', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByText('Nessun prodotto inserito.')).not.toBeInTheDocument();
  });

  it('an «orders + total» dough shows the grams typed on top of its products', async () => {
    await open('/calculator/log', [ordersAndTotal]);
    expect(await main().findByText('+ 400 g typed by hand', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByText(/^Total dough: /)).not.toBeInTheDocument();
  });
});

describe('the opened dough', () => {
  it('⚠️ shows its total ONCE, on the sheet card — the order block adds no second «Total dough: …» line', async () => {
    await open('/calculator/log/t', [fromTotal]);
    await main().findAllByText('Total dough: 1,650 g', undefined, LOAD);
    // One line: the list card behind it. The opened screen's own order block adds none, and no «No products entered.».
    expect(main().getAllByText('Total dough: 1,650 g')).toHaveLength(1);
    expect(main().queryByText('No products entered.')).not.toBeInTheDocument();
    // The sheet card says it in its own words.
    expect(main().getAllByText('Total dough').length).toBeGreaterThan(0);
  });

  it('still shows the grams typed on top of the products of an «orders + total» dough', async () => {
    await open('/calculator/log/b', [ordersAndTotal]);
    // The list card behind it, and the opened screen's own order block.
    expect(await main().findAllByText('+ 400 g typed by hand', undefined, LOAD)).toHaveLength(2);
  });
});
