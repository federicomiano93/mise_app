import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// The ingredient card's format and price basis as menus: a NEW card opens with the format empty and Save is refused until it
// is chosen; the basis menu waits for it; an existing item opens as it was and an untouched Save adds no format key.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const FLOUR = item('i-flour', {
  name: 'Flour 00', supplierId: 's-alp', weight: '25 kg', category: 'Bakery', unit: 'kg', pricePerUnit: 3, priceUnit: 'kg',
});
const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: [supplier('s-alp', { name: 'Alpine Mills Ltd' })], ingredients: [FLOUR] });

async function open(path: string) {
  const source = seeded();
  const view = renderSuppliers(path, { source });
  const region = within(await screen.findByRole('region', { name: /^(Edit|New) ingredient$/ }, LOAD));
  return { ...view, source, region };
}
const formatMenu = (region: Awaited<ReturnType<typeof open>>['region']) => region.getByRole('combobox', { name: 'Comes as' });
const basisMenu = (region: Awaited<ReturnType<typeof open>>['region']) => region.getByRole('combobox', { name: 'The price is' });
const optionNames = (menu: HTMLElement) => within(menu).getAllByRole('option').map(option => option.textContent);

describe('a new card, format not chosen', () => {
  it('⚠️ Save asks nothing, marks the menu, focuses it and says why', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/new');
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 'Salt');
    expect(formatMenu(region)).toHaveValue('');
    await user.click(region.getByRole('button', { name: 'Save' }));
    const menu = formatMenu(region);
    expect(menu).toHaveAttribute('aria-invalid', 'true');
    expect(menu).toHaveFocus();
    expect(region.getByText('Choose whether it comes as a single pack or a case')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.writes).toEqual([]);
  });

  it('choosing Single pack clears the message and Save goes on to its question', async () => {
    const { region, user } = await open('/suppliers/ingredient/new');
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 'Salt');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.selectOptions(formatMenu(region), 'single');
    expect(formatMenu(region)).toHaveValue('single');
    expect(formatMenu(region)).not.toHaveAttribute('aria-invalid');
    expect(region.queryByText('Choose whether it comes as a single pack or a case')).not.toBeInTheDocument();
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alertdialog', { name: 'Save ingredient?' })).toBeInTheDocument();
  });

  it('the basis menu is disabled with its hint until a format is chosen, then offers the options of that format', async () => {
    const { region, user } = await open('/suppliers/ingredient/new');
    await user.type(region.getByRole('textbox', { name: 'Weight amount' }), '5');
    expect(basisMenu(region)).toBeDisabled();
    expect(region.getByText('Choose the format first: what the price refers to depends on it')).toBeInTheDocument();
    await user.selectOptions(formatMenu(region), 'single');
    expect(basisMenu(region)).toBeEnabled();
    expect(optionNames(basisMenu(region))).toEqual(['per pack', 'per kg']);
    expect(region.queryByText('Choose the format first: what the price refers to depends on it')).not.toBeInTheDocument();
    await user.selectOptions(formatMenu(region), 'carton');
    expect(optionNames(basisMenu(region))).toEqual(['per case', 'per pack', 'per kg']);
  });
});

describe('an existing item', () => {
  it('opens with its format, a basis menu that works, and an untouched Save writes no format key', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-flour');
    expect(formatMenu(region)).toHaveValue('single');
    expect(basisMenu(region)).toBeEnabled();
    await user.type(region.getByRole('textbox', { name: 'Brand' }), 'X');
    await user.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save ingredient?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    const data = (source.writes[0] as { data: Record<string, unknown> }).data;
    for (const key of ['unit', 'packUnit', 'packCount']) expect(key in data, key).toBe(false);
  });
});
