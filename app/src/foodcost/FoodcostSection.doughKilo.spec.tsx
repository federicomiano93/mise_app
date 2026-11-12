import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { editorSource, intoForm, PACKAGING_PRICES } from '../testing/foodcostEditorFixtures';
import { FLOUR_PRICES, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// The cost of 1 kg is the DOUGH only (Federico, 11 Nov 2026, «Solo l'impasto»; docs/parity/foodcost.md, «Cost of 1 kg = dough only»).
// POST-SWITCH: the current app counts the packaging in its «Cost per 1 kg». Here the three places that show the kilo — the summary's
// kilo row (card and phone dialog), the «Baking» result line, «Cost breakdown» — show the SAME dough-only figure, for a product WITH
// packaging; the packaging stays per piece, in «Details» and in its own section. The arithmetic is shared/src/per-kg-model.spec.ts.
//
// Federico's own example: a kilo of flour (2,00 €), a box at 0,30 € on each of the 10 pieces, 900 g out of the oven. With the
// packaging the kilo read (2,00 + 3,00) ÷ 0,9 = 5,56 €; the dough only, 2,00 ÷ 0,9 = 2,22 €.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;
const SALT_LINE = { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' };

const source = (fields: Record<string, unknown> = {}) => editorSource(
  [product('Bun', { packaging: [{ ingredientId: 'box', qtyPcs: 1 }], cookedGrams: 900, model: 3, ...fields })],
  { prices: { ...FLOUR_PRICES, ...PACKAGING_PRICES, box: { priceUnit: 'pcs', pricePerUnit: 0.3 } } },
);

const summary = (scope: HTMLElement = document.body) => within(scope).getByRole('group', { name: /^(Summary|Riepilogo)/ });
const kiloRow = (scope: HTMLElement) => within(scope).getByText(/^(1 kg di cotto costa|1 kg cooked costs|1 kg costa \(nessun calo\)|1 kg costs \(no oven loss\))$/).closest('div') as HTMLElement;
const breakdown = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('section[aria-label="Cost breakdown"], section[aria-label="Dettaglio costi"]');
  if (!found) throw new Error('no «Cost breakdown» section');
  return found;
};
const breakdownTotal = () => within(breakdown()).getByText(/^(Total for 1 kg|Totale per 1 kg)$/).parentElement as HTMLElement;
const figure = (label: string, scope: HTMLElement) => within(scope).getByText(label, { selector: 'dt' }).closest('div') as HTMLElement;

describe('the cost of 1 kg is the dough only, the same figure in all three places', () => {
  it('read view: the summary\'s kilo row and «Dettaglio costi» say 2,22 €, no packaging row; «Dettagli» keeps the packaging per piece', async () => {
    const { user } = renderFoodcost('/food-cost/product/Bun', { source: source(), ...ITALY });
    await screen.findByRole('button', { name: 'Modifica il prodotto' }, LOAD);
    expect(kiloRow(summary())).toHaveTextContent('1 kg di cotto costa2,22 €');
    expect(kiloRow(summary())).not.toHaveTextContent('5,56');
    expect(kiloRow(summary())).not.toHaveTextContent('più di');

    await user.click(within(summary()).getByRole('button', { name: 'Dettagli' }));
    expect(figure('Imballaggio', summary())).toHaveTextContent('0,30 €');

    await user.click(within(breakdown()).getByRole('button', { name: 'Dettaglio costi' }));
    expect(breakdownTotal()).toHaveTextContent('2,22 €');
    expect(within(breakdown()).queryByText('Box')).not.toBeInTheDocument();
    // One row, the flour of «Made of»: 1 kg of it in 900 g cooked is 1,11 kg in a kilo, 2,22 €.
    const rows = within(breakdown()).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(/^Flour2,22\s€1,11 kg · 2,00\s€ \/ kg$/);
  });

  it('form: the «Cottura» line, the summary and «Dettaglio costi» say the same 2,22 €', async () => {
    const view = renderFoodcost('/food-cost/product/Bun', { source: source(), ...ITALY });
    await intoForm(view.user);
    const baking = screen.getByRole('region', { name: 'Cottura' });
    expect(within(baking).getByText(/^Calo/).closest('p, div') as HTMLElement).toHaveTextContent('Calo 10,00% · 1 kg di cotto costa 2,22 €');
    expect(kiloRow(summary())).toHaveTextContent('2,22 €');
    await view.user.click(within(breakdown()).getByRole('button', { name: 'Dettaglio costi' }));
    expect(breakdownTotal()).toHaveTextContent('2,22 €');
    expect(within(breakdown()).queryByText('Box')).not.toBeInTheDocument();
  });

  it('the phone\'s preview dialog says 2,22 € too', async () => {
    const { user } = renderFoodcost('/food-cost', { source: source(), ...ITALY });
    await user.click(await screen.findByRole('button', { name: /^Bun/ }, LOAD));
    const dialog = await screen.findByRole('dialog', { name: 'Bun' }, LOAD);
    expect(kiloRow(dialog)).toHaveTextContent('2,22 €');
    expect(kiloRow(dialog)).not.toHaveTextContent('più di');
  });

  it('in English, without a cooked weight: «1 kg costs (no oven loss) £2.00», the dough only', async () => {
    const { user } = renderFoodcost('/food-cost/product/Bun', { source: source({ cookedGrams: undefined }) });
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(kiloRow(summary())).toHaveTextContent('1 kg costs (no oven loss)£2.00');
    await user.click(within(breakdown()).getByRole('button', { name: 'Cost breakdown' }));
    expect(breakdownTotal()).toHaveTextContent('£2.00');
  });
});

describe('only a line of «Made of» makes the kilo «more than»', () => {
  it('a packaging item with no price per piece leaves the kilo exact, while the summary\'s cost says «more than»', async () => {
    // The ribbon is bought by the kilo: the packaging has no cost per piece, so the piece's cost is partial — the dough is not.
    const view = renderFoodcost('/food-cost/product/Bun', { source: source({ packaging: [{ ingredientId: 'ribbon', qtyPcs: 1 }] }), ...ITALY });
    await intoForm(view.user);
    expect(figure('Costo', summary())).toHaveTextContent('più di');
    expect(kiloRow(summary())).toHaveTextContent('2,22 €');
    expect(kiloRow(summary())).not.toHaveTextContent('più di');
    const baking = screen.getByRole('region', { name: 'Cottura' });
    expect(within(baking).getByText(/^Calo/).closest('p, div') as HTMLElement).not.toHaveTextContent('più di');
    await view.user.click(within(breakdown()).getByRole('button', { name: 'Dettaglio costi' }));
    expect(within(breakdown()).queryByText(/non è ancora esatto/)).not.toBeInTheDocument();
    expect(within(breakdown()).queryByText('Ribbon')).not.toBeInTheDocument();
  });

  it('a line of «Made of» with no cost still says «più di» in all three places', async () => {
    const view = renderFoodcost('/food-cost/product/Bun', {
      source: source({ components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }, SALT_LINE] }),
      ...ITALY,
    });
    await intoForm(view.user);
    // 2,00 € of flour over 900 g cooked: more than 2,22 €, whatever the salt costs.
    expect(kiloRow(summary())).toHaveTextContent('più di 2,22 €');
    const baking = screen.getByRole('region', { name: 'Cottura' });
    expect(within(baking).getByText(/^Calo/).closest('p, div') as HTMLElement).toHaveTextContent('1 kg di cotto costa più di 2,22 €');
    await view.user.click(within(breakdown()).getByRole('button', { name: 'Dettaglio costi' }));
    expect(breakdownTotal()).toHaveTextContent('2,22 €');
    expect(within(breakdown()).getByText('Alcune righe non sono conteggiate: il costo di 1 kg non è ancora esatto.')).toBeInTheDocument();
  });
});
