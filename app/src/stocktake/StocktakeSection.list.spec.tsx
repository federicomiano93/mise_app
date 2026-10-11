import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import {
  closedMonthDoc, freezeClock, ingredient, monthDoc, renderStocktake,
} from '../testing/renderStocktake';

// The counting list: what is on it, how it is grouped and summed up, the search and «Still to
// count». The boxes and the saving are in StocktakeSection.count.spec.tsx.

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

const INGREDIENTS = [
  ingredient('flour', { name: 'Farina 00', shortName: 'Farina', weight: '25kg', category: 'Dispensa', unit: 'kg' }),
  ingredient('sugar', { name: 'Zucchero', category: 'Dispensa', unit: '' }),
  ingredient('butter', { name: 'Burro', category: 'Frigo', unit: 'kg', brand: 'Président' }),
  ingredient('yeast', { name: 'Lievito', category: '' }),
  ingredient('salt', { name: 'Sale', category: 'Other' }),
  // Not listed: no longer in use, and with no name at all.
  ingredient('gone', { name: 'Old stock', active: false, category: 'Dispensa' }),
  ingredient('blank', { name: '   ' }),
];

function source(months = [monthDoc('2026-10')], ingredients = INGREDIENTS) {
  return fakeStocktakeSource({ months, ingredients });
}

const headings = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
const names = () => screen.getAllByRole('button', { name: /^Open / }).map(button => button.getAttribute('aria-label'));
const openButton = (name: string) => screen.getByRole('button', { name: `Open ${name}` });
const rowOf = (name: string) => openButton(name).closest('li') as HTMLElement;
const boxOf = (name: string) => screen.getByRole('textbox', { name: `How many of ${name} are left` });
const search = () => screen.getByRole('searchbox', { name: 'Search a product' });
const todo = (pressed: boolean) => screen.getByRole('button', { name: 'Still to count', pressed });

async function loaded(path = '/stocktake/2026-10', fake = source()) {
  const view = renderStocktake(path, { source: fake });
  await screen.findAllByRole('heading', { level: 3 }, LOAD);
  return { ...view, fake };
}

describe('the counting list: what is on it', () => {
  it('lists the active, named products, grouped by category with no category last', async () => {
    await loaded();
    expect(headings()).toEqual(['Dispensa', 'Frigo', 'No category']);
    expect(names()).toEqual([
      'Open Farina 25kg', 'Open Zucchero',
      'Open Burro',
      'Open Lievito', 'Open Sale',
    ]);
  });

  it('puts «Other» and an empty category in the same group', async () => {
    await loaded();
    const group = screen.getByRole('group', { name: 'No category' });
    expect(within(group).getAllByRole('button', { name: /^Open / })).toHaveLength(2);
  });

  it('puts every row inside the group of its heading, in a list', async () => {
    await loaded();
    const dispensa = within(screen.getByRole('group', { name: 'Dispensa' }));
    expect(dispensa.getAllByRole('listitem')).toHaveLength(2);
    expect(dispensa.getByRole('button', { name: 'Open Farina 25kg' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('orders the groups and the rows by the interface language\'s alphabet', async () => {
    const fake = source([monthDoc('2026-10')], [
      ingredient('a', { name: 'Zeta', category: 'Éclair' }),
      ingredient('b', { name: 'Ambra', category: 'Éclair' }),
      ingredient('c', { name: 'Mela', category: 'Zucchero' }),
      ingredient('d', { name: 'Nespola', category: 'Farina' }),
    ]);
    await loaded('/stocktake/2026-10', fake);
    expect(headings()).toEqual(['Éclair', 'Farina', 'Zucchero']);
    expect(names()).toEqual(['Open Ambra', 'Open Zeta', 'Open Nespola', 'Open Mela']);
  });

  it('shows the unit of a product, and «packs» when it has none', async () => {
    await loaded();
    expect(within(rowOf('Burro')).getByText('kg')).toBeInTheDocument();
    expect(within(rowOf('Zucchero')).getByText('packs')).toBeInTheDocument();
  });

  it('says «Product with no name» for a frozen row that has none', async () => {
    const fake = source([closedMonthDoc('2026-09', { names: { ghost: '' }, closing: { ghost: 2 } })]);
    await loaded('/stocktake/2026-09', fake);
    expect(openButton('Product with no name')).toBeInTheDocument();
  });

  it('files a product under the category that arrives late', async () => {
    const { fake } = await loaded();
    expect(within(screen.getByRole('group', { name: 'No category' })).getByRole('button', { name: 'Open Lievito' })).toBeInTheDocument();

    fake.ingredients.set('yeast', ingredient('yeast', { name: 'Lievito', category: 'Frigo' }));
    fake.push();

    await waitFor(() => {
      expect(within(screen.getByRole('group', { name: 'Frigo' })).getByRole('button', { name: 'Open Lievito' })).toBeInTheDocument();
    });
    expect(within(screen.getByRole('group', { name: 'No category' })).queryByRole('button', { name: 'Open Lievito' })).not.toBeInTheDocument();
  });
});

describe('the counting list: what it says under each name', () => {
  const months = [monthDoc('2026-10', {
    opening: { flour: 10, sugar: 4.5, butter: 1234.5 },
    purchased: { flour: 2 },
    closing: { flour: 8, butter: 1000, yeast: 3 },
  })];

  it('says what there was, what was bought and what was used, for a row with both ends', async () => {
    await loaded('/stocktake/2026-10', source(months));
    expect(within(rowOf('Farina 25kg')).getByText('Had 10 · bought 2 · used 4')).toBeInTheDocument();
    // A thousand has its separator on a row to be read.
    expect(within(rowOf('Burro')).getByText('Had 1,234.5 · bought 0 · used 234.5')).toBeInTheDocument();
  });

  it('says «No opening figure yet» for a counted row with no opening', async () => {
    await loaded('/stocktake/2026-10', source(months));
    expect(within(rowOf('Lievito')).getByText('No opening figure yet')).toBeInTheDocument();
  });

  it('says «Not counted yet» for a row with no count, marked as to-do, even when it has an opening', async () => {
    await loaded('/stocktake/2026-10', source(months));
    const sub = within(rowOf('Zucchero')).getByText('Not counted yet');
    expect(sub).toHaveAttribute('data-todo', 'true');
    expect(within(rowOf('Farina 25kg')).getByText(/^Had/)).toHaveAttribute('data-todo', 'false');
  });

  it('writes the numbers the Italian way in Italian', async () => {
    const fake = source([monthDoc('2026-10', { opening: { butter: 12345.5 }, closing: { butter: 3.5 } })]);
    renderStocktake('/stocktake/2026-10', { source: fake, lang: 'it' });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    const row = screen.getByRole('button', { name: 'Apri Burro' }).closest('li') as HTMLElement;
    expect(within(row).getByText('Avevi 12.345,5 · comprati 0 · consumo 12.342')).toBeInTheDocument();
  });
});

describe('the counting list: the summary', () => {
  it('counts the boxes filled, of the products there are', async () => {
    const fake = source([monthDoc('2026-10', { closing: { flour: 8, yeast: 0 } })]);
    await loaded('/stocktake/2026-10', fake);
    expect(screen.getByText('Counted')).toBeInTheDocument();
    // A zero is a real answer; the inactive and the unnamed are not products.
    expect(screen.getByText('2 of 5')).toBeInTheDocument();
    expect(screen.getByText('A box left empty means “not counted yet”, never zero.')).toBeInTheDocument();
  });

  it('is 0 of 0 for a venue with no products, which is not finished', async () => {
    renderStocktake('/stocktake/2026-10', { source: source([monthDoc('2026-10')], []) });
    expect(await screen.findByText('0 of 0', undefined, LOAD)).toBeInTheDocument();
  });

  it('says a month is closed in the note, and offers no fill-in on it', async () => {
    const fake = source([closedMonthDoc('2026-09', { names: { flour: 'Farina 25kg' }, closing: { flour: 1 } })]);
    await loaded('/stocktake/2026-09', fake);
    expect(await screen.findByText('This month is closed: its figures no longer change.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/not counted yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carry forward' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'From the orders' })).not.toBeInTheDocument();
  });

  it('offers the two fill-in actions on an open month', async () => {
    await loaded();
    expect(screen.getByRole('button', { name: 'Carry forward' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'From the orders' })).toBeInTheDocument();
  });

  it('lists a closed month from what was frozen into it, under its frozen names', async () => {
    const fake = source([closedMonthDoc('2026-09', {
      names: { flour: 'Farina 00 25kg', gone: 'Old stock 1kg' },
      closing: { flour: 3 },
    })]);
    await loaded('/stocktake/2026-09', fake);
    expect(names()).toEqual(['Open Farina 00 25kg', 'Open Old stock 1kg']);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });
});

describe('the counting list: loading and empty', () => {
  it('says «Loading…» until the ingredients have answered, not «No products yet»', async () => {
    const fake = source();
    vi.mocked(fake.watchIngredients).mockImplementation(() => () => undefined);
    renderStocktake('/stocktake/2026-10', { source: fake });

    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    // The summary does not claim «0 of 0» while the products are not known.
    expect(screen.queryByText('0 of 0')).not.toBeInTheDocument();
  });

  it('stops saying «Loading…» when the ingredients fail, instead of for ever', async () => {
    const fake = source();
    vi.mocked(fake.watchIngredients).mockImplementation((_onChange, onError) => {
      queueMicrotask(() => { onError(new Error('permission-denied')); });
      return () => undefined;
    });
    renderStocktake('/stocktake/2026-10', { source: fake });
    expect(await screen.findByText('No products yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('says «No products yet» for a venue with none, with no button to add one', async () => {
    renderStocktake('/stocktake/2026-10', { source: source([monthDoc('2026-10')], []) });
    expect(await screen.findByText('No products yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('They come from Ingredients & suppliers.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
  });

  it('draws the ingredients that arrive after the first paint', async () => {
    const fake = source([monthDoc('2026-10')], []);
    renderStocktake('/stocktake/2026-10', { source: fake });
    await screen.findByText('No products yet', undefined, LOAD);

    fake.ingredients.set('flour', INGREDIENTS[0] ?? ingredient('flour'));
    fake.push();

    expect(await screen.findByRole('button', { name: 'Open Farina 25kg' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
  });
});

describe('the counting list: search', () => {
  it('is a labelled search box', async () => {
    await loaded();
    expect(search()).toHaveAttribute('placeholder', 'Search a product');
    expect(search()).toHaveAttribute('autocomplete', 'off');
  });

  it.each([
    ['name', 'zucc'],
    ['short name', 'farina'],
    ['the invoice name', 'farina 00'],
    ['brand', 'preside'],
    ['category', 'friGO'],
  ])('finds a product by its %s', async (_field, query) => {
    const { user } = await loaded();
    await user.type(search(), query);
    expect(names()).toHaveLength(1);
  });

  it('folds accents and case in what is typed and in what is stored', async () => {
    const { user } = await loaded();
    await user.type(search(), 'PRESIDENT');
    expect(names()).toEqual(['Open Burro']);
  });

  it('folds accents typed in the search', async () => {
    const fake = source([monthDoc('2026-10')], [ingredient('p', { name: 'Pero' })]);
    const { user } = await loaded('/stocktake/2026-10', fake);
    await user.type(search(), 'però');
    expect(names()).toEqual(['Open Pero']);
  });

  it('drops the groups that have nothing left in them', async () => {
    const { user } = await loaded();
    await user.type(search(), 'burro');
    expect(headings()).toEqual(['Frigo']);
  });

  it('says «Nothing matches.» when nothing does', async () => {
    const { user } = await loaded();
    await user.type(search(), 'zzz');
    expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('comes back to the whole list when it is cleared', async () => {
    const { user } = await loaded();
    await user.type(search(), 'zzz');
    await user.clear(search());
    expect(names()).toHaveLength(5);
  });

  it('does not change the summary: it counts the products, not the ones found', async () => {
    const { user } = await loaded();
    await user.type(search(), 'burro');
    expect(screen.getByText('0 of 5')).toBeInTheDocument();
  });
});

describe('the counting list: «Still to count»', () => {
  const months = [monthDoc('2026-10', { closing: { flour: 8, butter: 2 } })];

  it('is a toggle, pressed or not', async () => {
    const { user } = await loaded('/stocktake/2026-10', source(months));
    expect(todo(false)).toBeInTheDocument();
    await user.click(todo(false));
    expect(todo(true)).toBeInTheDocument();
    await user.click(todo(true));
    expect(todo(false)).toBeInTheDocument();
  });

  it('shows only the products nobody has counted', async () => {
    const { user } = await loaded('/stocktake/2026-10', source(months));
    expect(names()).toHaveLength(5);
    await user.click(todo(false));
    expect(names()).toEqual(['Open Zucchero', 'Open Lievito', 'Open Sale']);
    expect(headings()).toEqual(['Dispensa', 'No category']);
  });

  it('works together with the search', async () => {
    const { user } = await loaded('/stocktake/2026-10', source(months));
    await user.click(todo(false));
    await user.type(search(), 'l');
    expect(names()).toEqual(['Open Lievito', 'Open Sale']);
  });

  it('says «Nothing matches.» when everything is counted', async () => {
    const all = [monthDoc('2026-10', { closing: { flour: 1, sugar: 1, butter: 1, yeast: 1, salt: 1 } })];
    const { user } = await loaded('/stocktake/2026-10', source(all));
    await user.click(todo(false));
    expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
  });

  // ⚠️ A ROW COUNTED WHILE THE TOGGLE IS ON STAYS: it must never disappear from under the finger
  // that is reaching for the next box.
  it('keeps a row that has just been counted, marked counted, until the next press', async () => {
    const { user } = await loaded('/stocktake/2026-10', source(months));
    await user.click(todo(false));
    const row = rowOf('Zucchero');
    await waitFor(() => { expect(boxOf('Zucchero')).toBeEnabled(); });

    await user.type(boxOf('Zucchero'), '3');
    await user.tab();

    expect(names()).toEqual(['Open Zucchero', 'Open Lievito', 'Open Sale']);
    expect(rowOf('Zucchero')).toBe(row);
    expect(within(row).getByText('No opening figure yet')).toBeInTheDocument();
    expect(screen.getByText('3 of 5')).toBeInTheDocument();

    // The next press lets it go.
    await user.click(todo(true));
    await user.click(todo(false));
    expect(names()).toEqual(['Open Lievito', 'Open Sale']);
  });

  it('keeps a counted row until the search changes, and then lets it go', async () => {
    const { user } = await loaded('/stocktake/2026-10', source(months));
    await user.click(todo(false));
    await waitFor(() => { expect(boxOf('Zucchero')).toBeEnabled(); });
    await user.type(boxOf('Zucchero'), '3');
    await user.tab();
    expect(names()).toContain('Open Zucchero');

    await user.type(search(), 'e');
    expect(names()).not.toContain('Open Zucchero');
    expect(names()).toEqual(['Open Lievito', 'Open Sale']);
  });

  it('shows a product that arrives later uncounted, and keeps it when it is counted', async () => {
    const { user, fake } = await loaded('/stocktake/2026-10', source(months));
    await user.click(todo(false));

    fake.ingredients.set('cocoa', ingredient('cocoa', { name: 'Cacao', category: 'Dispensa' }));
    fake.push();
    await screen.findByRole('button', { name: 'Open Cacao' }, LOAD);

    await waitFor(() => { expect(boxOf('Cacao')).toBeEnabled(); });
    await user.type(boxOf('Cacao'), '1');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Open Cacao' })).toBeInTheDocument();
  });

  it('does not show a product that arrives already counted', async () => {
    const { user, fake } = await loaded('/stocktake/2026-10', source(months));
    await user.click(todo(false));

    fake.ingredients.set('cocoa', ingredient('cocoa', { name: 'Cacao', category: 'Dispensa' }));
    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: 8, butter: 2, cocoa: 5 } }));
    fake.push();

    await waitFor(() => { expect(screen.getByText('3 of 6')).toBeInTheDocument(); });
    expect(screen.queryByRole('button', { name: 'Open Cacao' })).not.toBeInTheDocument();
  });

  it('shows a row again when its count is cleared while the toggle is on', async () => {
    const { user, fake } = await loaded('/stocktake/2026-10', source(months));
    await user.click(todo(false));
    expect(screen.queryByRole('button', { name: 'Open Burro' })).not.toBeInTheDocument();

    // A colleague takes Burro's count back: an emptied box is «not counted», never zero.
    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: 8 } }));
    fake.push();

    expect(await screen.findByRole('button', { name: 'Open Burro' }, LOAD)).toBeInTheDocument();
  });
});

describe('the counting list: a count never rebuilds the list', () => {
  it('keeps every row and every box in place when a count is typed, and when the month changes under it', async () => {
    const { user, fake } = await loaded();
    await waitFor(() => { expect(boxOf('Burro')).toBeEnabled(); });
    const before = {
      row: rowOf('Burro'), open: openButton('Burro'), box: boxOf('Burro'), other: boxOf('Lievito'),
    };

    await user.type(boxOf('Burro'), '4');
    await user.tab();
    // Another phone counts the flour: the snapshot comes in, and the unsent count is laid back on it.
    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: 1 } }));
    fake.push();
    await waitFor(() => { expect(screen.getByText('2 of 5')).toBeInTheDocument(); });

    expect(rowOf('Burro')).toBe(before.row);
    expect(openButton('Burro')).toBe(before.open);
    expect(boxOf('Burro')).toBe(before.box);
    expect(boxOf('Lievito')).toBe(before.other);
  });
});

describe('the counting list: opening a product', () => {
  it('opens the product of the row at its own address, one level down, and Back returns to the list', async () => {
    const { router, user } = await loaded();
    await user.click(openButton('Burro'));

    expect(router.state.location.pathname).toBe('/stocktake/2026-10/product/butter');
    expect(router.state.historyAction).toBe('PUSH');

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10');
    expect(await screen.findByRole('heading', { level: 3, name: 'Frigo' })).toBeInTheDocument();
  });

  it('encodes a product id with a slash in it into one segment', async () => {
    const fake = source([monthDoc('2026-10')], [ingredient('a/b c', { name: 'Odd' })]);
    const { router, user } = await loaded('/stocktake/2026-10', fake);
    await user.click(openButton('Odd'));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/product/a%2Fb%20c');
  });

  it('marks the row of the product that is open, and no other', async () => {
    await loaded('/stocktake/2026-10/product/butter');
    expect(openButton('Burro')).toHaveAttribute('aria-current', 'true');
    expect(openButton('Lievito')).not.toHaveAttribute('aria-current');
  });

  it('goes back to the list of the month by replacing an address opened by hand', async () => {
    const { router, user } = await loaded('/stocktake/2026-09/product/butter');
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/stocktake/2026-09');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  // The stylesheet hides the list behind a product on a phone; it does not unmount it. So the rows
  // are the same elements when Back returns, and a number half-typed is not lost.
  it('keeps the list mounted behind a product, so Back returns to the very same rows', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(boxOf('Burro')).toBeEnabled(); });
    const box = boxOf('Burro');
    await user.type(box, '7');
    await user.tab();
    await user.click(openButton('Lievito'));
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(boxOf('Burro')).toBe(box);
    expect(box).toHaveValue('7');
  });
});

describe('the counting list on the tablet\'s split', () => {
  function split() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1000px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  it('says what to do on the right while nothing is chosen', async () => {
    await loaded();
    expect(screen.getByText('Tap a product to see its figures.')).toBeInTheDocument();
  });

  it('does not say it once a product is open', async () => {
    await loaded('/stocktake/2026-10/product/butter');
    expect(screen.queryByText('Tap a product to see its figures.')).not.toBeInTheDocument();
  });

  it('opens the first product by pushing, and the next by replacing, so Back still goes to the list', async () => {
    split();
    const { router, user } = await loaded();
    await user.click(openButton('Burro'));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/product/butter');
    expect(router.state.historyAction).toBe('PUSH');

    await user.click(openButton('Lievito'));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/product/yeast');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(openButton('Lievito')).toHaveAttribute('aria-current', 'true');
    expect(openButton('Burro')).not.toHaveAttribute('aria-current');

    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10');
  });

  it('replaces from a product opened by its address, and Back then goes to the list by replacing', async () => {
    split();
    const { router, user } = await loaded('/stocktake/2026-10/product/butter');
    await user.click(openButton('Lievito'));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/product/yeast');
    expect(router.state.historyAction).toBe('REPLACE');
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10');
  });
});

describe('the counting list in Italian', () => {
  it('speaks Italian: the summary, the filters, the groups, the rows and the units', async () => {
    const fake = source([monthDoc('2026-10', { closing: { flour: 2 } })]);
    renderStocktake('/stocktake/2026-10', { source: fake, lang: 'it' });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);

    expect(screen.getByText('Contati')).toBeInTheDocument();
    expect(screen.getByText('1 su 5')).toBeInTheDocument();
    expect(screen.getByText('Una casella lasciata vuota vuol dire «non ancora contato», mai zero.')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Cerca un prodotto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ancora da contare', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Porta avanti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dagli ordini' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Senza categoria' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apri Burro' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Quanti ne restano di Burro' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Apri Zucchero' }).closest('li') as HTMLElement).getByText('conf.')).toBeInTheDocument();
    expect(screen.getAllByText('Non ancora contato').length).toBeGreaterThan(0);
    expect(screen.getByText('Tocca un prodotto per vederne i numeri.')).toBeInTheDocument();
  });

  it('says «Nessun risultato.» and the empty state in Italian', async () => {
    const empty = source([monthDoc('2026-10')], []);
    renderStocktake('/stocktake/2026-10', { source: empty, lang: 'it' });
    expect(await screen.findByText('Ancora nessun prodotto', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Arrivano da «Ingredienti e fornitori».')).toBeInTheDocument();
  });
});
