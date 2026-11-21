import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { REFERENCE, SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD, product } from '../testing/renderFoodcost';
import { NEED_HOST_ID, NEED_PRINTING_CLASS, closeNeedPrintHost } from './needPrintHost';

// «What you need»: the dialog opened from the cost card, worked out from the cake AS IT IS ON SCREEN (unsaved edits count, a cake not yet
// saved works), per semi-finished card or down to the ingredients, for 1 to 99 cakes, printed for the lab and offered as a PDF.
// Invented cards and amounts only.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  closeNeedPrintHost();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// 1000 g of the sponge (a kilo of flour in a kilo: £2.00) on the one tier.
const SACHER = cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE });
const MARZIPAN = product('MARZIPAN', {
  name: 'Marzipan', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null,
  components: [{ kind: 'ingredient', ingredientId: 'nothing', qty: 1000, unit: 'g' }],
});

const open = async (path = '/cakes/c1', cake = SACHER, products = [SPONGE]) => {
  const view = renderCakes(path, {
    cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }),
    foodcost: fakeFoodcostSource({ products, ingredients: [FLOUR], prices: FLOUR_PRICES }),
  });
  await screen.findByRole('heading', { level: 2, name: path === '/cakes/new' ? 'New cake' : String(cake.name) }, LOAD);
  return view;
};

const openNeeds = async (view: Awaited<ReturnType<typeof open>>) => {
  await view.user.click(await screen.findByRole('button', { name: 'Open “What you need”' }, LOAD));
  return screen.findByRole('dialog', { name: /^What you need/ });
};

describe('opening it', () => {
  it('is a button in the cost card, and the dialog is named after the cake and the count', async () => {
    const view = await open();
    const dialog = await openNeeds(view);
    expect(within(dialog).getByRole('heading', { name: 'What you need · Sacher × 1' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'By semi-finished', selected: true })).toBeInTheDocument();
  });

  it('⚠️ works from the WORKING copy: grams typed and not saved are in the table', async () => {
    const view = await open();
    const box = screen.getByRole('textbox', { name: 'Sponge: grams' });
    await view.user.clear(box);
    await view.user.type(box, '1500');
    const dialog = await openNeeds(view);
    const row = within(dialog).getByRole('row', { name: /^Sponge/ });
    expect(row).toHaveTextContent('1500 g');
    // Nothing was written: the saved cake still has its 1000 g.
    expect(view.foodcost.saved).toHaveLength(0);
  });

  it('works for a cake that is not saved yet, and says so when nothing is in it', async () => {
    const view = await open('/cakes/new');
    const dialog = await openNeeds(view);
    expect(within(dialog).getByText('Add a card to a part to see what you need.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Print' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  });
});

describe('the two tabs and the count', () => {
  it('per semi-finished: ready, loss and what to prepare, with the total', async () => {
    const dialog = await openNeeds(await open());
    const table = within(dialog).getByRole('table');
    expect(within(table).getByRole('row', { name: /^Sponge/ })).toHaveTextContent('1000 g—1000 g');
    expect(within(table).getByRole('row', { name: /^Total/ })).toHaveTextContent('1000 g1000 g');
    expect(within(dialog).getByText('Ready = what goes into the cake. To prepare = before the loss in the oven.')).toBeInTheDocument();
  });

  it('down to the ingredients: one row each, with the cards it comes from', async () => {
    const view = await open();
    const dialog = await openNeeds(view);
    await view.user.click(within(dialog).getByRole('tab', { name: 'Down to the ingredients' }));
    const row = within(dialog).getByRole('row', { name: /^Flour/ });
    expect(row).toHaveTextContent('Sponge');
    expect(row).toHaveTextContent('1.00 kg');
  });

  it('the number of cakes multiplies every figure, from 1 to 99', async () => {
    const view = await open();
    const dialog = await openNeeds(view);
    const less = within(dialog).getByRole('button', { name: 'One cake fewer' });
    const more = within(dialog).getByRole('button', { name: 'One cake more' });
    expect(less).toBeDisabled();
    await view.user.click(more);
    await view.user.click(more);
    expect(within(dialog).getByRole('heading', { name: 'What you need · Sacher × 3' })).toBeInTheDocument();
    expect(within(dialog).getByRole('row', { name: /^Sponge/ })).toHaveTextContent('3000 g');
    await view.user.click(within(dialog).getByRole('tab', { name: 'Down to the ingredients' }));
    expect(within(dialog).getByRole('row', { name: /^Flour/ })).toHaveTextContent('3.00 kg');
    await view.user.click(less);
    expect(within(dialog).getByRole('row', { name: /^Flour/ })).toHaveTextContent('2.00 kg');
  });

  it('the count stepper hands the focus to its other button when the pressed one reaches its limit', async () => {
    const view = await open();
    const dialog = await openNeeds(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'One cake more' }));
    await view.user.click(within(dialog).getByRole('button', { name: 'One cake fewer' }));
    expect(within(dialog).getByRole('button', { name: 'One cake fewer' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'One cake more' })).toHaveFocus();
  });

  it('says the total leaves out a row with no weight', async () => {
    const EMPTY = product('EMPTY', { name: 'Empty card', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null, components: [] });
    const cake = cakeDoc('c1', 'Sacher', {
      diameterCm: 22, discs: 2, ref: REFERENCE,
      lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 1000 }, { tier: 0, part: 'decoration', productId: 'EMPTY', grams: 100 }],
    });
    const view = await open('/cakes/c1', cake, [SPONGE, EMPTY]);
    const dialog = await openNeeds(view);
    expect(within(dialog).getByText('The total leaves out the rows with no weight.')).toBeInTheDocument();
  });

  it('does not say it when every row has a weight', async () => {
    const view = await open();
    const dialog = await openNeeds(view);
    expect(within(dialog).queryByText('The total leaves out the rows with no weight.')).not.toBeInTheDocument();
  });

  it('a card with no price is named as «not opened» on the ingredient tab, never silently left out', async () => {
    const cake = cakeDoc('c1', 'Cassata', {
      lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 500 }, { tier: 0, part: 'filling', productId: 'MARZIPAN', grams: 500 }],
    });
    const view = await open('/cakes/c1', cake, [SPONGE, MARZIPAN]);
    const dialog = await openNeeds(view);
    // It is still a semi-finished row to make…
    expect(within(dialog).getByRole('row', { name: /^Marzipan/ })).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Not opened/)).not.toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('tab', { name: 'Down to the ingredients' }));
    expect(within(dialog).getByText('Not opened: Marzipan — its card has no price yet')).toBeInTheDocument();
  });
});

describe('focus and the scrolling table', () => {
  it('Close gives the focus back to the button that opened it', async () => {
    const view = await open();
    const opener = await screen.findByRole('button', { name: 'Open “What you need”' }, LOAD);
    const dialog = await openNeeds(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(document.activeElement).toBe(opener); });
  });

  it('the scrolling table region can be reached by keyboard and is named', async () => {
    const view = await open();
    const dialog = await openNeeds(view);
    const region = within(dialog).getByRole('region', { name: 'By semi-finished' });
    expect(region).toHaveAttribute('tabindex', '0');
  });
});

describe('the PDF', () => {
  it('opens the export sheet above the dialog (the file itself is built lazily, on the person’s tap)', async () => {
    const view = await open();
    const dialog = await openNeeds(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Download PDF' }));
    expect(await screen.findByRole('dialog', { name: 'Export as' })).toBeInTheDocument();
  });
});

describe('print', () => {
  it('puts the sheet in its own host, switches the print class on <html> for as long as it lives, and restores it', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const view = await open();
    const dialog = await openNeeds(view);
    expect(document.documentElement.classList.contains(NEED_PRINTING_CLASS)).toBe(false);
    await view.user.click(within(dialog).getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    const host = document.getElementById(NEED_HOST_ID);
    expect(host).not.toBeNull();
    expect(document.documentElement.classList.contains(NEED_PRINTING_CLASS)).toBe(true);
    expect(host).toHaveTextContent('What you need · Sacher × 1');
    expect(host).toHaveTextContent('Sponge');
    expect(host).toHaveTextContent('1000 g');

    // Back in the page after the print screen: the first touch or key removes the host and the class.
    fireEvent(window, new Event('afterprint'));
    expect(document.getElementById(NEED_HOST_ID)).not.toBeNull();
    fireEvent(window, new Event('pointerdown'));
    await waitFor(() => { expect(document.getElementById(NEED_HOST_ID)).toBeNull(); });
    expect(document.documentElement.classList.contains(NEED_PRINTING_CLASS)).toBe(false);
  });

  it('prints the tab on screen: the ingredient list', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const view = await open();
    const dialog = await openNeeds(view);
    await view.user.click(within(dialog).getByRole('tab', { name: 'Down to the ingredients' }));
    await view.user.click(within(dialog).getByRole('button', { name: 'Print' }));
    const host = document.getElementById(NEED_HOST_ID);
    expect(host).toHaveTextContent('Flour');
    expect(host).toHaveTextContent('1.00 kg');
    expect(host).not.toHaveTextContent('To prepare');
  });
});
