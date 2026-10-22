import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { pricePatch } from '@mise/shared/price-model';
import type { PriceInput } from '@mise/shared/price-model';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», step 3e-3: the price on the ingredient card, through the real screen and the fake source — who sees
// it, what an untouched Save writes, typing a price, the VAT, the basis taps, a format that moves, a refused box, the wait for
// the price (C28), an old price shape and the history.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const THEN = '2026-09-01T08:00:00.000Z';
const priced = (input: Partial<PriceInput>) => ({ ...pricePatch(input as PriceInput, THEN) });
const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills Ltd' })];
const FLOUR = item('i-flour', { name: 'Flour', supplierId: 's-alp', weight: '', unit: 'kg', category: 'Bakery' });
const SUGAR = item('i-sugar', {
  name: 'Sugar', supplierId: 's-alp', weight: '2.5kg', unit: 'case', packUnit: 'bag', category: 'Bakery',
});
const OLD = item('i-old', { name: 'Old one', supplierId: 's-alp', weight: '6x1kg', category: 'Bakery' });

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({
  suppliers: SUPPLIERS,
  ingredients: [FLOUR, SUGAR, OLD],
  prices: {
    'i-flour': priced({ priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 }),
    // A stored case of 4 × 2.5 kg at 20: the keys as the database holds them.
    'i-sugar': {
      ...priced({ priceUnit: 'kg', pricePerUnit: 2 }),
      casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
    },
    'i-old': priced({ priceUnit: 'kg', pricePerUnit: 3, vatRate: 10 }),
  },
  history: {
    'i-flour': [
      { id: 'h1', pricePerUnit: 1.8, priceUnit: 'kg', recordedAt: '2026-06-01T08:00:00.000Z', source: 'manual' },
      { id: 'h2', pricePerUnit: 1.9, priceUnit: 'kg', recordedAt: '2026-08-01T08:00:00.000Z', source: 'invoice', packLabel: 'Farina 25kg' },
    ],
  },
});

async function open(path: string, source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  const region = within(await screen.findByRole('region', { name: /^(Edit|New) (ingredient|packaging)$/ }, LOAD));
  return { ...view, source, region };
}
type Region = Awaited<ReturnType<typeof open>>['region'];
const rate = (region: Region) => region.getByRole('textbox', { name: /^Price per kg/ });
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });

async function saveAndConfirm(view: { user: Awaited<ReturnType<typeof open>>['user']; region: Region }) {
  await view.user.click(view.region.getByRole('button', { name: 'Save' }));
  await view.user.click(within(await dialogOf('Save ingredient?')).getByRole('button', { name: 'Save' }));
}
const lastSave = (source: FakeSuppliersSource) => {
  const write = source.writes.filter(w => w.op === 'ingredient-save').at(-1);
  if (!write || write.op !== 'ingredient-save') throw new Error('no save');
  return write;
};

describe('who sees the price (C4)', () => {
  it('⚠️ the section is ABSENT for an employee, and for an owner of a venue with Food cost off', async () => {
    const employee = await open('/suppliers/ingredient/i-flour', seeded(), { session: { canManage: false, role: 'employee' } });
    expect(employee.region.queryByRole('combobox', { name: 'How it is bought' })).not.toBeInTheDocument();
    expect(employee.region.queryByText('Price history')).not.toBeInTheDocument();
    expect(employee.region.queryByText('Prices are net of VAT.')).not.toBeInTheDocument();
  });

  it('absent when the venue has Food cost off', async () => {
    const { region } = await open('/suppliers/ingredient/i-flour', seeded(), { session: { location: { sections: { foodcost: false } } } });
    expect(region.queryByRole('combobox', { name: 'How it is bought' })).not.toBeInTheDocument();
    expect(region.queryByText('Price history')).not.toBeInTheDocument();
  });

  it('a price writer sees it, filled from the stored price', async () => {
    const { region } = await open('/suppliers/ingredient/i-flour');
    expect(region.getByRole('combobox', { name: 'How it is bought' })).toHaveValue('kg');
    expect(rate(region)).toHaveValue('2');
    expect(region.getByText('Prices are net of VAT.')).toBeInTheDocument();
    expect(region.getByRole('combobox', { name: 'VAT' })).toHaveValue('4');
  });
});

describe('Save and the money', () => {
  it('⚠️ an untouched Save of a priced item writes NO price', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes.some(w => w.op === 'ingredient-save')).toBe(true); });
    expect(lastSave(view.source).price).toBeNull();
    expect(view.source.prices.get('i-flour')?.priceUpdatedAt).toBe(THEN);
  });

  it('typing a price writes it with ONE history entry', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.clear(rate(view.region));
    await view.user.type(rate(view.region), '2.5');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes.some(w => w.op === 'ingredient-save')).toBe(true); });
    const write = lastSave(view.source);
    expect(write.price?.doc.pricePerUnit).toBe(2.5);
    expect(view.source.history.get('i-flour')).toHaveLength(3);
    expect(write.price?.history).toMatchObject({ pricePerUnit: 2.5 });
  });

  it('a VAT-only change writes the rate and no history', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    const vat = view.region.getByRole('combobox', { name: 'VAT' });
    const other = [...vat.querySelectorAll('option')].map(o => o.value).find(v => v !== '' && v !== '4')!;
    await view.user.selectOptions(vat, other);
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes.some(w => w.op === 'ingredient-save')).toBe(true); });
    const write = lastSave(view.source);
    expect(write.price?.doc.vatRate).toBe(Number(other));
    expect(write.price?.history).toBeNull();
    expect(view.source.history.get('i-flour')).toHaveLength(2);
  });

  it('a new item prices itself and Save sends the price', async () => {
    const view = await open('/suppliers/ingredient/new');
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in the message' }), 'Butter');
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'How it is bought' }), 'kg');
    await view.user.type(rate(view.region), '8');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes.some(w => w.op === 'ingredient-save')).toBe(true); });
    const write = lastSave(view.source);
    expect(write.price?.doc).toMatchObject({ priceUnit: 'kg', pricePerUnit: 8 });
    expect(write.data.unit).toBe('kg');
  });
});

describe('a refused price box (C86)', () => {
  it('⚠️ an unreadable price is marked, said, takes the focus, and writes nothing', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.clear(rate(view.region));
    await view.user.type(rate(view.region), '1.234,5');
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    const box = rate(view.region);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveFocus();
    const message = view.region.getByText('Write just a number above zero, like 7.20.');
    expect(box.getAttribute('aria-describedby')).toContain(message.id);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(view.source.writes).toEqual([]);
    await view.user.type(box, '1');
    expect(box).not.toHaveAttribute('aria-invalid');
  });
});

describe('the basis and the format', () => {
  async function sugar() {
    const view = await open('/suppliers/ingredient/i-sugar');
    return view;
  }

  it('the segments are a labelled group of toggle buttons; a tap converts a typed figure', async () => {
    const view = await sugar();
    const group = view.region.getByRole('group', { name: /^(Case|Pack) price/ });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(buttons.filter(b => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    const box = view.region.getByRole('textbox', { name: /^(Case|Pack) price/ });
    await view.user.clear(box);
    await view.user.type(box, '20');
    const perKg = within(group).getByRole('button', { name: 'per kg' });
    await view.user.click(perKg);
    expect(perKg).toHaveAttribute('aria-pressed', 'true');
    expect(view.region.getByRole('textbox', { name: /^Price per kg/ })).toHaveValue('2');
  });

  it('⚠️ a tap that cannot convert does nothing: the number and the segment stay', async () => {
    const view = await sugar();
    const count = view.region.getByRole('textbox', { name: 'How many in the case' });
    const group = () => view.region.getByRole('group', { name: /^(Case|Pack) price/ });
    const box = view.region.getByRole('textbox', { name: /^(Case|Pack) price/ });
    await view.user.clear(box);
    await view.user.type(box, '20');
    await view.user.clear(count);
    const pressed = () => within(group()).getAllByRole('button').find(b => b.getAttribute('aria-pressed') === 'true')!.textContent;
    const before = pressed();
    const other = within(group()).getAllByRole('button').find(b => b.getAttribute('aria-pressed') === 'false')!;
    await view.user.click(other);
    expect(pressed()).toBe(before);
    expect(view.region.getByRole('textbox', { name: /^(Case|Pack) price/ })).toHaveValue('20');
  });

  it('a format that moves empties the box with the old price as its placeholder; Recalculate fills it', async () => {
    const view = await sugar();
    const count = view.region.getByRole('textbox', { name: 'How many in the case' });
    await view.user.clear(count);
    await view.user.type(count, '5');
    const box = view.region.getByRole('textbox', { name: /^(Case|Pack) price/ });
    expect(box).toHaveValue('');
    expect(box).toHaveAttribute('placeholder', expect.stringMatching(/\d/));
    expect(view.region.getByText(/The format has changed since the last price/)).toBeInTheDocument();
    await view.user.click(view.region.getByRole('button', { name: 'Recalculate' }));
    expect((box as HTMLInputElement).value).toMatch(/\d/);
    expect(box).toHaveFocus();
    expect(view.region.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
  });
});

describe('the price must be known before the card opens (C28)', () => {
  it('⚠️ waits for the price, reads it, then opens with it', async () => {
    const source = seeded();
    source.pricesFromCache = true;
    const view = await open('/suppliers/ingredient/i-flour', source);
    expect(source.priceReads).toEqual(['i-flour']);
    expect(rate(view.region)).toHaveValue('2');
  });

  it('⚠️ a failed read opens NOTHING: the «could not be opened» panel with Back', async () => {
    const source = seeded();
    source.pricesFromCache = true;
    source.refusePriceRead = true;
    renderSuppliers('/suppliers/ingredient/i-flour', { source });
    expect(await screen.findByText('The ingredient card could not be opened. Please try again.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Edit ingredient' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Back' }).length).toBeGreaterThan(0);
  });

  it('no read when the server already answered the prices', async () => {
    const source = seeded();
    await open('/suppliers/ingredient/i-flour', source);
    expect(source.priceReads).toEqual([]);
  });
});

describe('an old price shape (T4)', () => {
  it('opens read-only for a price writer, with the sentence, and Save sends no price', async () => {
    const source = seeded();
    source.prices.set('i-old', priced({ priceUnit: 'kg', pricePerUnit: 3, vatRate: 10 }));
    const view = await open('/suppliers/ingredient/i-old', source);
    expect(view.region.queryByRole('combobox', { name: 'How it is bought' })).not.toBeInTheDocument();
    expect(view.region.getByText(/This price was saved in an older format/)).toBeInTheDocument();
    expect(view.region.getByText('VAT: 10%')).toBeInTheDocument();
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    await saveAndConfirm(view);
    await waitFor(() => { expect(source.writes.some(w => w.op === 'ingredient-save')).toBe(true); });
    expect(lastSave(source).price).toBeNull();
    expect(lastSave(source).data.brand).toBe('X');
  });
});

describe('the price history', () => {
  it('shows nothing until asked; the button says it is loading, then the rows come', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    expect(view.source.historyReads).toEqual([]);
    await view.user.click(view.region.getByRole('button', { name: 'Show them' }));
    expect(await view.region.findByText('invoice')).toBeInTheDocument();
    expect(view.region.getByText('Farina 25kg')).toBeInTheDocument();
    expect(view.region.queryByRole('button', { name: 'Show them' })).not.toBeInTheDocument();
    expect(view.source.historyReads).toEqual(['i-flour']);
  });

  it('an empty history says so', async () => {
    const view = await open('/suppliers/ingredient/i-sugar');
    await view.user.click(view.region.getByRole('button', { name: 'Show them' }));
    expect(await view.region.findByText('No price recorded yet.')).toBeInTheDocument();
  });

  it('⚠️ a failed read brings the button back and says so', async () => {
    const source = seeded();
    source.refuseHistory = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await open('/suppliers/ingredient/i-flour', source);
    await view.user.click(view.region.getByRole('button', { name: 'Show them' }));
    expect(await dialogOf('Could not load the price history for “Flour”. Check your network and try again.')).toBeInTheDocument();
    await view.user.click(within(await dialogOf('Could not load the price history for “Flour”. Check your network and try again.')).getByRole('button', { name: 'OK' }));
    expect(view.region.getByRole('button', { name: 'Show them' })).toBeEnabled();
  });

  it('is not offered on a new item', async () => {
    const { region } = await open('/suppliers/ingredient/new');
    expect(region.queryByText('Price history')).not.toBeInTheDocument();
  });
});
