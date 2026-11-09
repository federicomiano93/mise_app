import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// «What kind of pack?» on the ingredient card (Mise 2 only): the package word of a SINGLE pack, written as unit = packUnit = word. It is
// drawn only where choosing cannot move a price, and a word that is a unit (kg, pcs) is refused.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const FLOUR = item('i-flour', { name: 'Flour 00', supplierId: 's-alp', weight: '25 kg', category: 'Bakery', unit: 'kg' });
const CREAM = item('i-cream', { name: 'Cream', supplierId: 's-alp', weight: '1 l', category: 'Bakery', unit: '' });
const MILK = item('i-milk', { name: 'Milk', supplierId: 's-alp', weight: '1 l', category: 'Bakery', unit: 'bottle', packUnit: 'bottle' });
const RICE = item('i-rice', { name: 'Rice', supplierId: 's-alp', weight: '5 kg', category: 'Bakery', unit: '', packUnit: 'sack' });
// The prices live in their own documents.
const PRICES = {
  'i-flour': { priceUnit: 'kg', pricePerUnit: 3 },
  'i-cream': { priceUnit: 'l', pricePerUnit: 3 },
  'i-milk': { priceUnit: 'l', pricePerUnit: 1 },
  'i-rice': { priceUnit: 'kg', pricePerUnit: 5, casePrice: 100, caseCount: 4, caseItemUnit: 'pack', caseItemSize: 5 },
};
const EMPLOYEE: Record<string, unknown> = { session: { canManage: false, role: 'employee' } };

async function open(path: string, ingredients = [FLOUR, CREAM, MILK, RICE], options: Record<string, unknown> = {}) {
  const source: FakeSuppliersSource = fakeSuppliersSource({ suppliers: [supplier('s-alp', { name: 'Alpine Mills Ltd' })], ingredients, prices: PRICES });
  const view = renderSuppliers(path, { source, ...options });
  const region = within(await screen.findByRole('region', { name: /^(Edit|New) ingredient$/ }, LOAD));
  return { ...view, source, region };
}
type Region = Awaited<ReturnType<typeof open>>['region'];
const formatMenu = (region: Region) => region.getByRole('combobox', { name: 'Comes as' });
const typeMenu = (region: Region) => region.getByRole('combobox', { name: 'What kind of pack?' });
const noTypeMenu = (region: Region) => region.queryByRole('combobox', { name: 'What kind of pack?' });
const optionNames = (menu: HTMLElement) => within(menu).getAllByRole('option').map(option => option.textContent);
const lastWrite = (source: FakeSuppliersSource) => (source.writes[source.writes.length - 1] as { data: Record<string, unknown> }).data;

async function confirmSave(user: Awaited<ReturnType<typeof open>>['user']) {
  await user.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
  await user.click(within(await screen.findByRole('alertdialog', { name: 'Save ingredient?' })).getByRole('button', { name: 'Save' }));
}

describe('a new card', () => {
  it('draws the menu for a Single pack only: not before the format is chosen, not for a Case', async () => {
    const { region, user } = await open('/suppliers/ingredient/new');
    expect(noTypeMenu(region)).not.toBeInTheDocument();
    await user.selectOptions(formatMenu(region), 'single');
    expect(typeMenu(region)).toHaveValue('');
    await user.selectOptions(formatMenu(region), 'carton');
    expect(noTypeMenu(region)).not.toBeInTheDocument();
    await user.selectOptions(formatMenu(region), 'single');
    expect(typeMenu(region)).toBeInTheDocument();
  });

  it('offers the venue’s package words, the two added ones, and «+ New…»', async () => {
    const { region, user } = await open('/suppliers/ingredient/new');
    await user.selectOptions(formatMenu(region), 'single');
    const names = optionNames(typeMenu(region));
    expect(names[0]).toBe('— none —');
    expect(names).toEqual(expect.arrayContaining(['bottle', 'bucket', 'tin', 'bag', 'sack']));
    expect(names[names.length - 1]).toBe('+ New…');
    expect(names).not.toContain('kg');
  });

  it('⚠️ a type picked writes unit AND packUnit, and no unit selector is needed to order it', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/new');
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 'Cream');
    await user.selectOptions(formatMenu(region), 'single');
    await user.selectOptions(typeMenu(region), 'bottle');
    await confirmSave(user);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); });
    expect(lastWrite(source)).toMatchObject({ unit: 'bottle', packUnit: 'bottle' });
    expect(lastWrite(source)).not.toHaveProperty('packCount', expect.anything());
  });

  it('a new word through «+ New…» is saved, a blank box is refused, and a word that is a unit is refused', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/new');
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 'Wine');
    await user.selectOptions(formatMenu(region), 'single');
    await user.selectOptions(typeMenu(region), '+ New…');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
    expect(await region.findByText('Write the new package’s name')).toBeInTheDocument();
    const box = region.getByRole('textbox', { name: 'New package name' });
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(source.writes).toEqual([]);

    await user.type(box, 'kg');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
    expect(await region.findByText('Write the name of a package (e.g. bottle), not a unit such as kg or pcs')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.writes).toEqual([]);

    await user.clear(box);
    await user.type(box, 'demijohn');
    expect(region.queryByText('Write the name of a package (e.g. bottle), not a unit such as kg or pcs')).not.toBeInTheDocument();
    await confirmSave(user);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); });
    expect(lastWrite(source)).toMatchObject({ unit: 'demijohn', packUnit: 'demijohn' });
  });

  it('leaving the type on «— none —» writes no packUnit', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/new');
    await user.type(region.getByRole('textbox', { name: 'Name in the message' }), 'Salt');
    await user.selectOptions(formatMenu(region), 'single');
    await confirmSave(user);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); });
    expect(lastWrite(source)).not.toHaveProperty('packUnit');
  });
});

describe('an existing item', () => {
  it('ordered in kilos: no menu', async () => {
    const { region } = await open('/suppliers/ingredient/i-flour');
    expect(noTypeMenu(region)).not.toBeInTheDocument();
  });

  it('a price writer on an untyped item with no case of more than one: the menu is there, and writes both keys', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-cream');
    expect(typeMenu(region)).toHaveValue('');
    await user.selectOptions(typeMenu(region), 'bottle');
    await confirmSave(user);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); });
    expect(lastWrite(source)).toMatchObject({ unit: 'bottle', packUnit: 'bottle' });
  });

  it('⚠️ on a stored case of 4 there is no menu: choosing a type would move the price', async () => {
    const { region } = await open('/suppliers/ingredient/i-rice');
    expect(noTypeMenu(region)).not.toBeInTheDocument();
  });

  it('a typed item opens on its type, and an untouched Save writes no unit key', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-milk');
    expect(typeMenu(region)).toHaveValue('bottle');
    await user.type(region.getByRole('textbox', { name: 'Brand' }), 'X');
    await confirmSave(user);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); });
    for (const key of ['unit', 'packUnit']) expect(lastWrite(source), key).not.toHaveProperty(key);
  });

  it('a rename writes both keys', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-milk');
    await user.selectOptions(typeMenu(region), 'jar');
    await confirmSave(user);
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); });
    expect(lastWrite(source)).toMatchObject({ unit: 'jar', packUnit: 'jar' });
  });
});

describe('an employee', () => {
  it('has no menu on an untyped item', async () => {
    const { region } = await open('/suppliers/ingredient/i-cream', [FLOUR, CREAM, MILK, RICE], EMPLOYEE);
    expect(noTypeMenu(region)).not.toBeInTheDocument();
  });

  it('may rename a typed item, but is not offered «— none —»', async () => {
    const { region } = await open('/suppliers/ingredient/i-milk', [FLOUR, CREAM, MILK, RICE], EMPLOYEE);
    expect(typeMenu(region)).toHaveValue('bottle');
    expect(optionNames(typeMenu(region))).not.toContain('— none —');
  });
});
