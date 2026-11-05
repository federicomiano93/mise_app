import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import {
  BRIOCHE, LOAD, SOURDOUGH, configOf, onlyFocaccia, renderCalculator,
} from '../testing/renderCalculator';

// The scaled recipe of a tab: when it is shown, what it says, that its rounded grams add up EXACTLY, the
// divisor and the crate boxes, and the four ways a linked recipe can fail to be read.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

// These specs are about the recipe, so every tab is already confirmed (the current app's own key): when it is
// shown at all is in CalculatorSection.confirm.spec.tsx.
beforeEach(() => {
  window.localStorage.clear();
  for (const rid of ['focaccia', 'brioche', 'sourdough', 'linked']) window.localStorage.setItem(`revealed-${rid}`, '1');
});

afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));

async function open(path: string, config: Record<string, unknown> = configOf(), lang: 'en' | 'it' = 'en') {
  const view = renderCalculator(path, { source: fakeCalculatorSource({ config }), lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  await waitFor(() => { expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); }, LOAD);
  return view;
}

// The card of the recipe: its heading names it.
const resultCard = (title: string) => within(main().getByRole('region', { name: title }));
const gramsOf = (card: ReturnType<typeof resultCard>) =>
  card.getAllByRole('listitem').map(row => Number((row.lastElementChild?.textContent ?? '').replace(/[^0-9]/g, '')));

async function type(user: Awaited<ReturnType<typeof open>>['user'], box: HTMLElement, text: string) {
  await user.click(box);
  await user.keyboard(text);
}

describe('when the recipe is shown', () => {
  it('is hidden when there is nothing to make', async () => {
    await open('/calculator/focaccia');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(main().queryByRole('region', { name: 'Focaccia dough' })).not.toBeInTheDocument();
    expect(main().queryByText(/g raw/)).not.toBeInTheDocument();
  });

  it('appears as soon as there is something to make, and goes again when it is taken away', async () => {
    const { user } = await open('/calculator/brioche');
    const box = await main().findByLabelText('Total dough (g)', undefined, LOAD);
    await type(user, box, '800');
    expect(main().getByRole('region', { name: 'Brioche dough' })).toBeInTheDocument();
    await user.clear(box);
    expect(main().queryByRole('region', { name: 'Brioche dough' })).not.toBeInTheDocument();
  });

  it('is hidden for a negative number: dough is never subtracted', async () => {
    const { user } = await open('/calculator/brioche');
    await type(user, await main().findByLabelText('Total dough (g)', undefined, LOAD), '-50');
    expect(main().queryByRole('region', { name: 'Brioche dough' })).not.toBeInTheDocument();
  });
});

describe('what the recipe says', () => {
  it('names the dough, the raw weight, every ingredient and the total', async () => {
    const { user } = await open('/calculator/brioche');
    await type(user, await main().findByLabelText('Total dough (g)', undefined, LOAD), '2000');
    const card = resultCard('Brioche dough');
    expect(main().getByRole('heading', { level: 2, name: 'Brioche dough' })).toBeInTheDocument();
    expect(card.getByText('2,000 g raw')).toBeInTheDocument();
    expect(card.getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour1,000 g', 'Butter500 g', 'Eggs500 g']);
    expect(card.getByText('Total dough').nextSibling).toHaveTextContent('2,000 g');
  });

  it('adds the rounded grams up to the target EXACTLY, whatever the rounding', async () => {
    const { user } = await open('/calculator/focaccia', onlyFocaccia({ clients: [] }));
    const extra = await main().findByLabelText('Extra dough', undefined, LOAD);
    for (const grams of [1000, 1234, 777, 4321, 99999]) {
      await user.clear(extra);
      await user.selectOptions(main().getByLabelText('Extra dough unit'), 'g');
      await type(user, extra, String(grams));
      const rows = gramsOf(resultCard('Focaccia dough'));
      expect(rows.reduce((a, b) => a + b, 0), `${grams} g`).toBe(grams);
    }
  });

  it('moves the yeast with the knob and still adds up to the target', async () => {
    const { user } = await open('/calculator/focaccia', onlyFocaccia({ clients: [] }));
    await type(user, await main().findByLabelText('Extra dough', undefined, LOAD), '1');
    await user.selectOptions(main().getByLabelText('Extra dough unit'), 'g');
    await user.clear(main().getByLabelText('Extra dough'));
    await type(user, main().getByLabelText('Extra dough'), '1000');
    const resting = resultCard('Focaccia dough').getAllByRole('listitem').map(row => row.textContent);
    expect(resting).toEqual(['Flour579 g', 'Water406 g', 'Salt12 g', 'Yeast3 g']);

    const knob = main().getByLabelText('Yeast %');
    await user.clear(knob);
    await user.type(knob, '1');
    const rows = resultCard('Focaccia dough').getAllByRole('listitem').map(row => row.textContent);
    // The yeast doubles to 1%; the whole recipe is scaled back to 1000 g (the residual goes to the flour).
    expect(rows).toEqual(['Flour577 g', 'Water405 g', 'Salt12 g', 'Yeast6 g']);
  });

  it('does not let a trays recipe\'s leavening move, whatever the recipe says', async () => {
    const { user } = await open('/calculator/sourdough', configOf({
      recipes: [{ ...SOURDOUGH, leaveningKey: 'water', leaveningDefaultPct: 10, baselinePct: 10, showLeavening: true }],
    }));
    await type(user, await main().findByLabelText('Number of trays', undefined, LOAD), '1');
    // 1 tray of 1200 g, pro rata 600 : 400.
    expect(resultCard('Sourdough dough').getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour720 g', 'Water480 g']);
  });

  it('works out the trays and the typed total together', async () => {
    const { user } = await open('/calculator/sourdough', configOf({ recipes: [{ ...SOURDOUGH, logic: 'traysTotal' }] }));
    await type(user, await main().findByLabelText('Number of trays', undefined, LOAD), '2');
    await type(user, main().getByLabelText('Total dough (g)'), '600');
    // 2 x 1200 g + 600 g.
    expect(resultCard('Sourdough dough').getByText('3,000 g raw')).toBeInTheDocument();
  });

  it('says the header and the weight in Italian', async () => {
    window.localStorage.setItem('total-brioche', '1500');
    await open('/calculator/brioche', configOf(), 'it');
    const card = await screen.findByRole('region', { name: 'Impasto Brioche' }, LOAD);
    expect(within(card).getByText('1.500 g crudi')).toBeInTheDocument();
    expect(within(card).getByText('Impasto totale')).toBeInTheDocument();
  });
});

describe('the divisor', () => {
  const config = () => onlyFocaccia({ divisorIncluded: { focaccia: ['tray'] } });

  async function typeOrders(user: Awaited<ReturnType<typeof open>>['user'], roma: string, sole: string) {
    const cards = await main().findAllByRole('region', undefined, LOAD);
    const roma_ = within(cards.find(c => c.textContent?.includes('Cafe Roma'))!);
    const sole_ = within(cards.find(c => c.textContent?.includes('Bar Sole'))!);
    await type(user, roma_.getByLabelText('Focaccia tray (500g)'), roma);
    await type(user, sole_.getByLabelText('Focaccia tray (500g)'), sole);
  }

  it('is not there while none of the ticked products has a quantity', async () => {
    const { user } = await open('/calculator/focaccia', config());
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await type(user, main().getByLabelText('Extra dough'), '2');
    expect(main().queryByLabelText('Number of crates')).not.toBeInTheDocument();
  });

  it('adds the ticked product up across every client that orders it, and splits it by the crates picked', async () => {
    const { user } = await open('/calculator/focaccia', config());
    await typeOrders(user, '4', '2');
    // An extra kilo is in the dough but not in the divisor, which splits only what was ticked.
    await user.selectOptions(main().getByLabelText('Extra dough unit'), 'g');
    await type(user, main().getByLabelText('Extra dough'), '1000');
    const card = resultCard('Focaccia dough');
    expect(card.getByText('4,000 g raw')).toBeInTheDocument();
    const crates = card.getByLabelText('Number of crates');
    expect(card.getAllByText('Focaccia tray').length).toBeGreaterThan(0);
    expect(card.getByText('3,000 g')).toBeInTheDocument();
    expect(within(crates).getAllByRole('option').map(o => o.textContent)).toEqual(['0', '1', '2', '3', '4']);
    // 0 crates: nothing to split into.
    expect(card.getByText('0 g')).toBeInTheDocument();
    await user.selectOptions(crates, '2');
    expect(card.getByText('1,500 g')).toBeInTheDocument();
  });

  it('is not locked by anything', async () => {
    const { user } = await open('/calculator/focaccia', config());
    await typeOrders(user, '1', '1');
    expect(resultCard('Focaccia dough').getByLabelText('Number of crates')).toBeEnabled();
  });
});

describe('the crate boxes', () => {
  it('count the crates an order fills, to one decimal, and say what each holds', async () => {
    const { user } = await open('/calculator/focaccia');
    const roma = await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await type(user, within(roma).getByLabelText('Focaccia tray (500g)'), '25');
    const card = resultCard('Focaccia dough');
    // 25 pieces in boxes of 10; 10 x 500 g in each box.
    expect(card.getByText('Focaccia tray')).toBeInTheDocument();
    expect(card.getByText('2.5 box')).toBeInTheDocument();
    expect(card.getByText('5,000g each box')).toBeInTheDocument();
  });

  it('are drawn only for a product that opted in and has a quantity', async () => {
    const { user } = await open('/calculator/focaccia');
    const sole = await main().findByRole('region', { name: 'Bar Sole' }, LOAD);
    await type(user, within(sole).getByLabelText('Focaccia tray (500g)'), '25');
    expect(resultCard('Focaccia dough').queryByText(/each box/)).not.toBeInTheDocument();
  });

  it('read in Italian', async () => {
    window.localStorage.setItem('qty-roma::tray', '25');
    await open('/calculator/focaccia', configOf(), 'it');
    const card = await screen.findByRole('region', { name: 'Impasto Focaccia' }, LOAD);
    expect(within(card).getByText('2,5 casse')).toBeInTheDocument();
    expect(within(card).getByText('5.000 g per cassa')).toBeInTheDocument();
  });
});

describe('a recipe taken from the catalogue', () => {
  const LINKED = {
    ...BRIOCHE, id: 'linked', name: 'Linked', catalogueId: 'cat-1', ingredients: [],
  };
  const CATALOGUE = (rows: unknown[]) => ({
    id: 'cat-1', name: 'From the catalogue', ingredients: rows,
  });
  const GOOD = [
    { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
    // (Sugar was written in kilos here once, and the Calculator read 250 kg as 250 g: kilos are worth ×1000 now, see calculator-recipe-source.spec.ts.)
    { rid: 'r-sugar', label: 'Sugar', grams: 250, unit: 'g' },
  ];

  async function openLinked(rows: unknown[] | null, hold = false) {
    window.localStorage.setItem('total-linked', '1000');
    const config = configOf({ recipes: [LINKED], clients: [] });
    window.localStorage.setItem('calculator-config', JSON.stringify(config));
    const source = fakeCalculatorSource({ config, recipes: rows === null ? [] : [CATALOGUE(rows)] });
    if (hold) source.hold();
    const view = renderCalculator('/calculator/linked', { source });
    await screen.findByRole('heading', { level: 1 }, LOAD);
    return { ...view, source };
  }

  it('calculates from the catalogue\'s rows, not from the tab\'s leftover copy', async () => {
    await openLinked(GOOD);
    const card = await screen.findByRole('region', { name: 'Linked dough' }, LOAD);
    await within(card).findByText('Flour', undefined, LOAD);
    expect(within(card).getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour800 g', 'Sugar200 g']);
  });

  it('says «still loading», with no number, while the recipe has not arrived — a different sentence from «gone»', async () => {
    await openLinked(GOOD, true);
    const card = await screen.findByRole('region', { name: 'Linked dough' }, LOAD);
    expect(within(card).getByText(/still loading from the catalogue/)).toBeInTheDocument();
    expect(within(card).queryByText(/cannot be read/)).not.toBeInTheDocument();
    expect(within(card).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(card).queryByText(/g raw/)).not.toBeInTheDocument();
  });

  it('says it once it has arrived: the numbers replace the sentence', async () => {
    const { source } = await openLinked(GOOD, true);
    const card = await screen.findByRole('region', { name: 'Linked dough' }, LOAD);
    expect(within(card).getByText(/still loading/)).toBeInTheDocument();
    act(() => { source.release(); });
    await within(card).findByText('Flour', undefined, LOAD);
    expect(within(card).queryByText(/still loading/)).not.toBeInTheDocument();
  });

  it('says it cannot be read, with no number, when the recipe is gone', async () => {
    await openLinked(null);
    const card = await screen.findByRole('region', { name: 'Linked dough' }, LOAD);
    expect(await within(card).findByText(/cannot be read from the catalogue right now/, undefined, LOAD)).toBeInTheDocument();
    expect(within(card).queryByText(/still loading/)).not.toBeInTheDocument();
    expect(within(card).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(card).queryByText(/g raw/)).not.toBeInTheDocument();
  });

  it('says so when it has no ingredients, and bakes nothing', async () => {
    await openLinked([]);
    const card = await screen.findByRole('region', { name: 'Linked dough' }, LOAD);
    expect(await within(card).findByText('That catalogue recipe has no ingredients yet.', undefined, LOAD)).toBeInTheDocument();
    expect(within(card).queryByText(/Total dough/)).not.toBeInTheDocument();
  });

  it('NAMES the row that has no weight, and bakes nothing', async () => {
    await openLinked([...GOOD, { rid: 'r-pinch', label: 'Pinch of salt', grams: 0, unit: 'pinch' }]);
    const card = await screen.findByRole('region', { name: 'Linked dough' }, LOAD);
    expect(await within(card).findByText(/“Pinch of salt” has no weight/, undefined, LOAD)).toBeInTheDocument();
    expect(within(card).queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('says the unweighable row in Italian too', async () => {
    window.localStorage.setItem('total-linked', '1000');
    const config = configOf({ recipes: [LINKED], clients: [] });
    const source = fakeCalculatorSource({
      config, recipes: [CATALOGUE([{ rid: 'r-x', label: 'Sale q.b.', grams: 0, unit: 'q.b.' }])],
    });
    renderCalculator('/calculator/linked', { source, lang: 'it' });
    expect(await screen.findByText(/“Sale q\.b\.” non ha un peso/, undefined, LOAD)).toBeInTheDocument();
  });

  it('shows no number at all for a tab with nothing to make, whatever the recipe', async () => {
    window.localStorage.setItem('calculator-config', JSON.stringify(configOf({ recipes: [LINKED], clients: [] })));
    const source = fakeCalculatorSource({ config: configOf({ recipes: [LINKED], clients: [] }), recipes: [] });
    renderCalculator('/calculator/linked', { source });
    await main().findByLabelText('Total dough (g)', undefined, LOAD);
    expect(main().queryByRole('region', { name: 'Linked dough' })).not.toBeInTheDocument();
  });
});
