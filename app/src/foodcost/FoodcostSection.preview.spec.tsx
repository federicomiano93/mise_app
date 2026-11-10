import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { editorSource } from '../testing/foodcostEditorFixtures';
import { bareProduct, LOAD, MANAGER, product, renderFoodcost, split } from '../testing/renderFoodcost';

// The search over the list and the preview of a product (current app e81a2617, 39f192ac; tests/foodcost-preview-screen.test.mjs,
// item 24 of docs/mise2-port-owed.md). The arithmetic is shared/src/foodcost-model.spec.ts (productPreview, nameMatches); these pin what
// the SCREEN does with it: on a phone a tap shows the figures in a dialog, from 1000px the card opens beside the list, every
// figure through fc-number (two decimals, the venue's layout), unknown is a dash.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;

const SALT_LINE = { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' };
const FLOUR_LINE = { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' };

// A flour at £2.00 a kilo in a batch of ten: £0.20 a piece. £1.20 with 20% VAT is £1.00 net; a 25% target.
const GREEN = product('Green');
const CAFFE = product('Cornetto al Caffè', { sellingPrice: 0.5, vatRate: 0 });
const CREMA = product('Cornetto crema', { sellingPrice: 1, vatRate: 0 });
const BRIOCHE = product('Brioche', { sellingPrice: 2, vatRate: 0 });

const search = () => screen.getByRole('searchbox', { name: 'Search products' });
const rowCount = () => within(screen.getByRole('main')).queryAllByRole('listitem').length;
const preview = () => screen.getByRole('dialog');
const figure = (label: string): HTMLElement => {
  const row = within(preview()).getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
  return row.querySelector('dd') as HTMLElement;
};

async function loaded(path = '/food-cost', fake = editorSource([GREEN]), options = {}) {
  const view = renderFoodcost(path, { source: fake, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return { ...view, fake };
}

describe('the search over the list', () => {
  it('narrows the rows by name, whatever the accents and the capitals, and keeps the worst food cost first', async () => {
    const { user } = await loaded('/food-cost', editorSource([BRIOCHE, CREMA, CAFFE, GREEN]));
    // Cheapest price = worst food cost: the caffe (40%) before the crema (20%).
    await user.type(search(), '  CORNETTO ');
    expect(within(screen.getByRole('main')).getAllByRole('listitem').map(row => row.textContent)).toEqual([
      expect.stringContaining('Cornetto al Caffè'), expect.stringContaining('Cornetto crema'),
    ]);
    await user.clear(search());
    await user.type(search(), 'caffe');
    expect(within(screen.getByRole('main')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Cornetto al Caffè/ })).toBeInTheDocument();
  });

  it('says so, in a region that was there before, when no name holds the text, and brings the rows back when it is cleared', async () => {
    const { user } = await loaded('/food-cost', editorSource([BRIOCHE, GREEN]));
    const region = screen.getAllByRole('status').find(node => node.parentElement?.className.includes('column')) as HTMLElement;
    expect(region).toBeEmptyDOMElement();
    await user.type(search(), ' zzz ');
    expect(within(screen.getByRole('main')).queryAllByRole('listitem')).toHaveLength(0);
    expect(region).toHaveTextContent('No product name contains “zzz”.');
    await user.clear(search());
    expect(region).toBeEmptyDOMElement();
    expect(within(screen.getByRole('main')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('is not drawn while there is nothing to search', async () => {
    renderFoodcost('/food-cost', { source: editorSource([]) });
    await screen.findByText('No products yet', undefined, LOAD);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('is the same box, with the same text, after a data update lands while somebody types', async () => {
    const { user, fake } = await loaded('/food-cost', editorSource([BRIOCHE, GREEN]));
    const box = search();
    await user.type(box, 'bri');
    await act(async () => { fake.push(); });
    expect(search()).toBe(box);
    expect(box).toHaveValue('bri');
    expect(rowCount()).toBe(1);
    expect(screen.getByRole('button', { name: /^Brioche/ })).toBeInTheDocument();
  });

  it('keeps the search when a product is opened on a phone and Back comes to the list', async () => {
    const { user } = await loaded('/food-cost', editorSource([BRIOCHE, GREEN]));
    await user.type(search(), 'bri');
    await user.click(screen.getByRole('button', { name: /^Brioche/ }));
    await user.click(await screen.findByRole('button', { name: 'Open the card' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    expect(search()).toHaveValue('bri');
    expect(rowCount()).toBe(1);
    expect(screen.getByRole('button', { name: /^Brioche/ })).toBeInTheDocument();
  });

  it('has a label and a placeholder in Italian for an Italian phone', async () => {
    await loaded('/food-cost', editorSource([GREEN]), ITALY);
    expect(screen.getByRole('searchbox', { name: 'Cerca un prodotto' })).toHaveAttribute('placeholder', 'Cerca un prodotto');
  });
});

describe('on a phone, a tap on a product shows its preview', () => {
  it('opens a dialog named by the product, with his eight figures, two decimals, and no card yet', async () => {
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Green' }, LOAD);
    expect(router.state.location.pathname).toBe('/food-cost');
    expect(within(dialog).getByText('Summary per piece')).toBeInTheDocument();
    expect(figure('Selling price (VAT incl.)')).toHaveTextContent('£1.20');
    expect(figure('Raw materials')).toHaveTextContent('£0.20');
    expect(figure('Packaging')).toHaveTextContent('None');
    expect(figure('Total cost')).toHaveTextContent('£0.20');
    expect(figure('Food cost')).toHaveTextContent('20.00% · target 25.00%');
    expect(figure('Food cost')).toHaveTextContent('On target');
    expect(figure('Margin (price without VAT)')).toHaveTextContent('£0.80');
    expect(figure('Ideal price, VAT incl.')).toHaveTextContent('£0.96');
    expect(figure('Ideal price, without VAT')).toHaveTextContent('£0.80');
    expect(within(dialog).getByText('For a 25.00% food cost.')).toBeInTheDocument();
    // An employee's tablet is sent no hourly rate: no labour row at all.
    expect(within(dialog).queryByText('Labour')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Still missing:')).not.toBeInTheDocument();
  });

  it('«Open the card» closes it and opens the product', async () => {
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await user.click(await screen.findByRole('button', { name: 'Open the card' }, LOAD));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(await screen.findByRole('heading', { level: 2, name: 'Green' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Green' })).not.toBeInTheDocument();
  });

  it('«Close» goes back to the list with the focus on the row that opened it', async () => {
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await user.click(await screen.findByRole('button', { name: 'Close' }, LOAD));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/food-cost');
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Green/ })).toHaveFocus(); });
  });

  it('Escape closes it too, the focus back on the row', async () => {
    const { user } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await screen.findByRole('dialog', undefined, LOAD);
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Green/ })).toHaveFocus(); });
  });

  it('opens at its top: no button takes the focus, only the dialog itself', async () => {
    const { user } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).not.toBe('BUTTON');
  });

  it('calls a product with no name «Untitled product»', async () => {
    const { user } = await loaded('/food-cost', editorSource([bareProduct('Nameless', { name: '' })]));
    await user.click(screen.getByRole('button', { name: /^Untitled product/ }));
    expect(await screen.findByRole('dialog', { name: 'Untitled product' }, LOAD)).toBeInTheDocument();
  });

  it('follows the figures while it is open: a price that arrives moves them', async () => {
    const { user, fake } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await screen.findByRole('dialog', undefined, LOAD);
    expect(figure('Raw materials')).toHaveTextContent('£0.20');
    fake.prices.set('flour', { priceUnit: 'kg', pricePerUnit: 4 });
    await act(async () => { fake.push(); });
    await waitFor(() => { expect(figure('Raw materials')).toHaveTextContent('£0.40'); });
  });

  it('closes by itself, saying «Product deleted.», when the product is deleted elsewhere while it is open', async () => {
    const { user, fake } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await screen.findByRole('dialog', undefined, LOAD);
    fake.products.delete('Green');
    await act(async () => { fake.push(); });
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(await screen.findByText('Product deleted.')).toBeInTheDocument();
  });

  it('is over when the tablet is turned to the split: the list and the card sit side by side, no dialog', async () => {
    let wide = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return wide && query === '(min-width: 1000px)'; },
      media: query,
      addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
      removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
    }));
    const { user } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await screen.findByRole('dialog', undefined, LOAD);
    await act(async () => { wide = true; listeners.forEach(listener => { listener(); }); });
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
  });
});

describe('from 1000px the card opens beside the list, with no dialog', () => {
  it('goes straight to the product', async () => {
    split();
    const { user, router } = await loaded();
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(await screen.findByRole('heading', { level: 2, name: 'Green' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('unknown is a dash, never a zero, and what is missing is named', () => {
  it('a product that cannot be costed has dashes and the checklist', async () => {
    const { user } = await loaded('/food-cost', editorSource([bareProduct('Bare')]));
    await user.click(screen.getByRole('button', { name: /^Bare/ }));
    await screen.findByRole('dialog', { name: 'Bare' }, LOAD);
    for (const label of ['Selling price (VAT incl.)', 'Raw materials', 'Total cost', 'Food cost', 'Margin (price without VAT)', 'Ideal price, VAT incl.', 'Ideal price, without VAT']) {
      expect(figure(label), label).toHaveTextContent('—');
      expect(figure(label), label).not.toHaveTextContent('0');
    }
    expect(within(preview()).getByText('Summary')).toBeInTheDocument();
    expect(within(preview()).getByText('Still missing:')).toBeInTheDocument();
    expect(within(preview()).getByText('Add at least one recipe or ingredient to this product')).toBeInTheDocument();
    expect(within(preview()).getByText('Enter a food cost target')).toBeInTheDocument();
  });

  it('no target: the food cost still reads, the ideal prices do not, and the target is asked for', async () => {
    const { user } = await loaded('/food-cost', editorSource([product('Free', { foodCostTarget: null })]));
    await user.click(screen.getByRole('button', { name: /^Free/ }));
    await screen.findByRole('dialog', { name: 'Free' }, LOAD);
    expect(figure('Food cost')).toHaveTextContent('20.00% · no target');
    expect(figure('Ideal price, VAT incl.')).toHaveTextContent('—');
    expect(figure('Ideal price, without VAT')).toHaveTextContent('—');
    expect(within(preview()).getByText('Enter a food cost target')).toBeInTheDocument();
    expect(within(preview()).queryByText(/^For a /)).not.toBeInTheDocument();
  });

  it('no VAT: no shelf price, but the net price it must earn is still told', async () => {
    const { user } = await loaded('/food-cost', editorSource([product('NoVat', { vatRate: null })]));
    await user.click(screen.getByRole('button', { name: /^NoVat/ }));
    await screen.findByRole('dialog', { name: 'NoVat' }, LOAD);
    expect(figure('Ideal price, VAT incl.')).toHaveTextContent('—');
    expect(figure('Ideal price, without VAT')).toHaveTextContent('£0.80');
  });

  it('⚠️ a packaging line with no price per piece is NOT free: a dash, and the line to fix is named', async () => {
    const wrapped = product('Wrapped', { packaging: [{ ingredientId: 'ribbon', qtyPcs: 1 }] });
    const { user } = await loaded('/food-cost', editorSource([wrapped]));
    await user.click(screen.getByRole('button', { name: /^Wrapped/ }));
    await screen.findByRole('dialog', { name: 'Wrapped' }, LOAD);
    expect(figure('Packaging')).toHaveTextContent('—');
    expect(figure('Packaging')).not.toHaveTextContent('£0.00');
    expect(within(preview()).getByText('Give every packaging item a price per piece')).toBeInTheDocument();
    expect(within(preview()).getByText('Part of this product is not priced yet, so it really costs more than this.')).toBeInTheDocument();
  });

  it('a priced box is shown apart from the materials, and the total holds both', async () => {
    const boxed = product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 2 }] });
    const { user } = await loaded('/food-cost', editorSource([boxed]));
    await user.click(screen.getByRole('button', { name: /^Boxed/ }));
    await screen.findByRole('dialog', { name: 'Boxed' }, LOAD);
    expect(figure('Raw materials')).toHaveTextContent('£0.20');
    expect(figure('Packaging')).toHaveTextContent('£0.50');
    expect(figure('Total cost')).toHaveTextContent('£0.70');
  });

  it('a partly priced product says its figures are too low', async () => {
    const salty = product('Salty', { components: [FLOUR_LINE, SALT_LINE] });
    const { user } = await loaded('/food-cost', editorSource([salty]));
    await user.click(screen.getByRole('button', { name: /^Salty/ }));
    await screen.findByRole('dialog', { name: 'Salty' }, LOAD);
    expect(within(preview()).getByText('Part of this product is not priced yet, so it really costs more than this.')).toBeInTheDocument();
  });
});

describe('whoever runs the place also sees the work', () => {
  it('draws the labour row, and says the margin is before labour', async () => {
    const worked = product('Worked', { labourMinutes: 60, labourPeople: 1 });
    const fake = editorSource([worked], { settings: { labourCostPerHour: 10 } });
    const { user } = await loaded('/food-cost', fake, { session: MANAGER });
    await user.click(screen.getByRole('button', { name: /^Worked/ }));
    await screen.findByRole('dialog', { name: 'Worked' }, LOAD);
    // £10 over ten pieces.
    await waitFor(() => { expect(figure('Labour')).toHaveTextContent('£1.00'); });
    expect(figure('Total cost')).toHaveTextContent('£1.20');
    expect(figure('Margin (without VAT, before labour)')).toHaveTextContent('£0.80');
    // The food cost is the ingredients' share only.
    expect(figure('Food cost')).toHaveTextContent('20.00% · target 25.00%');
  });
});

describe('a venue in Italy', () => {
  it('writes the figures in euros with two decimals and the comma, and every label in Italian', async () => {
    const { user } = await loaded('/food-cost', editorSource([GREEN]), ITALY);
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Green' }, LOAD);
    expect(within(dialog).getByText('Riepilogo al pezzo')).toBeInTheDocument();
    expect(figure('Prezzo di vendita (IVA inclusa)')).toHaveTextContent('1,20 €');
    expect(figure('Materie prime')).toHaveTextContent('0,20 €');
    expect(figure('Imballaggio')).toHaveTextContent('Nessuno');
    expect(figure('Costo totale')).toHaveTextContent('0,20 €');
    expect(figure('Food cost')).toHaveTextContent('20,00% · obiettivo 25,00%');
    expect(figure('Margine (prezzo senza IVA)')).toHaveTextContent('0,80 €');
    expect(figure('Prezzo ideale, IVA inclusa')).toHaveTextContent('0,96 €');
    expect(figure('Prezzo ideale, senza IVA')).toHaveTextContent('0,80 €');
    expect(within(dialog).getByText('Per un food cost del 25,00%.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apri la scheda' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
  });

  it('asks for a target and a packaging price in Italian', async () => {
    const wrapped = product('Wrapped', { foodCostTarget: null, packaging: [{ ingredientId: 'ribbon', qtyPcs: 1 }] });
    const { user } = await loaded('/food-cost', editorSource([wrapped]), ITALY);
    await user.click(screen.getByRole('button', { name: /^Wrapped/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Wrapped' }, LOAD);
    expect(within(dialog).getByText('Manca ancora:')).toBeInTheDocument();
    expect(within(dialog).getByText('Dai un prezzo al pezzo a ogni imballaggio')).toBeInTheDocument();
    expect(within(dialog).getByText('Scrivi un obiettivo di food cost')).toBeInTheDocument();
  });
});

describe('the top of the card gets the one figure it lacked: the ideal price without VAT', () => {
  it('sits in the suggested-price box under the price with VAT, in the venue’s layout', async () => {
    renderFoodcost('/food-cost/product/Green', { source: editorSource([GREEN]) });
    const box = await screen.findByRole('group', { name: 'Suggested price' }, LOAD);
    expect(box).toHaveTextContent('£0.96');
    expect(within(box).getByText('Ideal price, without VAT').parentElement).toHaveTextContent('£0.80');
  });

  it('is told even before a VAT rate is chosen', async () => {
    renderFoodcost('/food-cost/product/NoVat', { source: editorSource([product('NoVat', { vatRate: null })]), ...ITALY });
    const box = await screen.findByRole('group', { name: 'Prezzo consigliato' }, LOAD);
    expect(box).toHaveTextContent('Scegli l’aliquota IVA');
    expect(within(box).getByText('Prezzo ideale, senza IVA').parentElement).toHaveTextContent('0,80 €');
  });

  it('is not drawn while there is no target to hit', async () => {
    renderFoodcost('/food-cost/product/Free', { source: editorSource([product('Free', { foodCostTarget: null })]) });
    const box = await screen.findByRole('group', { name: 'Suggested price' }, LOAD);
    expect(within(box).queryByText('Ideal price, without VAT')).not.toBeInTheDocument();
  });
});
