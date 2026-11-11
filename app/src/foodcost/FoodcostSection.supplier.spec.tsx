import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { supplierLabel } from '@mise/shared/supplier-label';
import { BOX, editorSource, intoForm, recipe, SALT } from '../testing/foodcostEditorFixtures';
import { FLOUR, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// Step 4 of the Food cost plan (11 Nov 2026, POST-SWITCH): «Composto da deve essere molto intuitivo, e quando scegli un ingrediente
// deve dirti il fornitore». The chooser names an ingredient's supplier on a second line, and an ingredient line of «Made of» names
// it under its name. Never a recipe, never packaging, never a dash for an ingredient with none, and always through supplierLabel().

// The real supplierLabel, watched: the screens must name a supplier through it, never through `supplier.name`.
vi.mock('@mise/shared/supplier-label', async importOriginal => {
  const actual = await importOriginal<typeof import('@mise/shared/supplier-label')>();
  return { ...actual, supplierLabel: vi.fn(actual.supplierLabel) };
});

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(supplierLabel).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// A legal name and a short one: the screen must show the SHORT one (supplierLabel's rule).
const ROSSI = { id: 'rossi', name: 'Molino Rossi Società Agricola S.r.l.', shortName: 'Molino Rossi', active: true };
const BIANCHI = { id: 'bianchi', name: 'Bianchi Imballaggi', active: true };
const SWITCHED_OFF = { id: 'closed', name: 'Old Mill', active: false };

const flourFrom = { ...FLOUR, supplierId: 'rossi' };
const saltNone = { ...SALT };
const boxFrom = { ...BOX, supplierId: 'bianchi' };
const yeastNoSupplier = { id: 'yeast', name: 'Yeast', active: true, unit: 'kg', supplierId: 'no-supplier' };
const sugarUnknown = { id: 'sugar', name: 'Sugar', active: true, unit: 'kg', supplierId: 'gone' };
const ryeOff = { id: 'rye', name: 'Rye', active: false, unit: 'kg', supplierId: 'rossi' };
const oatsClosed = { id: 'oats', name: 'Oats', active: true, unit: 'kg', supplierId: 'closed' };
const trap = { id: 'trap', name: 'Trap', active: true, unit: 'kg', supplierId: 'constructor' };

const INGREDIENTS = [flourFrom, saltNone, boxFrom, yeastNoSupplier, sugarUnknown, ryeOff, oatsClosed, trap];

function source(extra: Parameters<typeof editorSource>[1] = {}) {
  return editorSource([
    product('Bread', {
      components: [
        { kind: 'ingredient', ingredientId: 'flour', qty: 500, unit: 'g' },
        { kind: 'ingredient', ingredientId: 'salt', qty: 10, unit: 'g' },
        { kind: 'recipe', recipeId: 'Dough', qtyKg: 0.2 },
      ],
      packaging: [{ ingredientId: 'box', qtyPcs: 1 }],
    }),
  ], {
    // A recipe carrying a stray supplierId: still never named.
    recipes: [recipe('Dough', { supplierId: 'rossi' })],
    ingredients: INGREDIENTS,
    suppliers: [ROSSI, BIANCHI, SWITCHED_OFF],
    ...extra,
  });
}

const madeOf = () => screen.getByRole('region', { name: /^(Made of|Composto da)$/ });
const packaging = () => screen.getByRole('region', { name: /^(Packaging|Imballaggio)$/ });
const chooser = () => screen.findByRole('dialog', undefined, LOAD);
const lineOf = (region: HTMLElement, name: string) =>
  within(region).getByRole('button', { name: new RegExp(`^(Change|Cambia): ${name}$`) }).closest('li') as HTMLElement;
const optionOf = (dialog: HTMLElement, name: string) =>
  within(dialog).getAllByRole('button').find(button => button.firstElementChild?.firstElementChild?.textContent === name) as HTMLElement;

async function openForm(fake: ReturnType<typeof source>, options = {}) {
  const view = renderFoodcost('/food-cost/product/Bread', { source: fake, ...options });
  await intoForm(view.user);
  return view;
}

async function openChooser(fake: ReturnType<typeof source>, options = {}) {
  const view = await openForm(fake, options);
  await view.user.click(within(madeOf()).getByRole('button', { name: /^(\+ Add recipe or ingredient|\+ Aggiungi ricetta o ingrediente)$/ }));
  return { ...view, dialog: await chooser() };
}

describe('the chooser names an ingredient’s supplier', () => {
  it('on a second line under the name, the SHORT name through supplierLabel(), and in the option’s spoken name', async () => {
    const { dialog } = await openChooser(source());
    await waitFor(() => { expect(optionOf(dialog, 'Flour')).toHaveTextContent('Molino Rossi'); });
    const flour = within(dialog).getByRole('button', { name: 'Flour, Molino Rossi' });
    // Under the name, inside the same option: the name first, then the supplier.
    const label = flour.firstElementChild as HTMLElement;
    expect(label.children).toHaveLength(2);
    expect(label.children[0]).toHaveTextContent(/^Flour$/);
    expect(label.children[1]).toHaveTextContent(/^, Molino Rossi$/);
    // Never the legal name, and the name came from supplierLabel().
    expect(dialog).not.toHaveTextContent('Società Agricola');
    expect(supplierLabel).toHaveBeenCalledWith(ROSSI);
  });

  it('a recipe names none, even with a stray supplierId', async () => {
    const { dialog } = await openChooser(source());
    await waitFor(() => { expect(optionOf(dialog, 'Flour')).toHaveTextContent('Molino Rossi'); });
    const dough = optionOf(dialog, 'Dough');
    expect((dough.firstElementChild as HTMLElement).children).toHaveLength(1);
    expect(dough).not.toHaveTextContent('Rossi');
  });

  it('an ingredient with no supplier, «no supplier», or one never heard of draws nothing — no dash, no empty line', async () => {
    const { dialog } = await openChooser(source());
    await waitFor(() => { expect(optionOf(dialog, 'Flour')).toHaveTextContent('Molino Rossi'); });
    for (const name of ['Salt', 'Yeast', 'Sugar', 'Trap']) {
      const label = optionOf(dialog, name).firstElementChild as HTMLElement;
      expect(label.children).toHaveLength(1);
    }
    expect(optionOf(dialog, 'Salt')).toHaveTextContent(/^Salt1 kg$/);
    expect(optionOf(dialog, 'Yeast')).toHaveTextContent(/^Yeast$/);
    expect(dialog).not.toHaveTextContent('—');
    // An id an object's own machinery answers to is not a supplier.
    expect(optionOf(dialog, 'Trap')).not.toHaveTextContent('Object');
  });

  it('an ingredient «not in use» still names its supplier, and so does one whose supplier is switched off', async () => {
    const { dialog } = await openChooser(source());
    await waitFor(() => { expect(optionOf(dialog, 'Oats')).toHaveTextContent('Old Mill'); });
    expect(optionOf(dialog, 'Rye')).toHaveTextContent('Molino Rossi');
    expect(optionOf(dialog, 'Oats')).toHaveAccessibleName('Oats, Old Mill');
  });

  it('packaging names none', async () => {
    const view = await openForm(source());
    await view.user.click(within(packaging()).getByRole('button', { name: /^(\+ Add packaging|\+ Aggiungi imballaggio)$/ }));
    const dialog = await chooser();
    expect(optionOf(dialog, 'Box')).toBeDefined();
    expect(dialog).not.toHaveTextContent('Bianchi');
  });

  it('never waits for the suppliers: the options are there before they arrive, and a failure leaves them without one', async () => {
    const fake = source();
    fake.holdSuppliers();
    const { dialog } = await openChooser(fake);
    expect(optionOf(dialog, 'Flour')).toHaveAccessibleName('Flour');
    fake.releaseSuppliers();
    await waitFor(() => { expect(optionOf(dialog, 'Flour')).toHaveAccessibleName('Flour, Molino Rossi'); });
  });

  it('a refused supplier read: every option still drawn, none named, nothing said', async () => {
    const fake = source();
    fake.holdSuppliers();
    const { dialog } = await openChooser(fake);
    fake.failSuppliers();
    expect(optionOf(dialog, 'Flour')).toHaveAccessibleName('Flour');
    expect(optionOf(dialog, 'Salt')).toBeDefined();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('in Italian too: the supplier is data, never translated', async () => {
    const { dialog } = await openChooser(source(), { lang: 'it', session: { language: 'it', location: { country: 'IT' } } });
    await waitFor(() => { expect(optionOf(dialog, 'Flour')).toHaveAccessibleName('Flour, Molino Rossi'); });
  });
});

describe('an ingredient line of «Made of» names its supplier under the name', () => {
  it('small text under the name, outside the name’s button, and spoken as the button’s description', async () => {
    await openForm(source());
    const flour = lineOf(madeOf(), 'Flour');
    const supplier = await within(flour).findByText('Molino Rossi', undefined, LOAD);
    expect(supplier.tagName).toBe('P');
    const name = within(flour).getByRole('button', { name: 'Change: Flour' });
    expect(name).toHaveAccessibleDescription('Molino Rossi');
    expect(name).not.toContainElement(supplier);
    // Between the name's row and the amount's row.
    expect(supplier.previousElementSibling).toContainElement(name);
    expect(supplier.nextElementSibling).toContainElement(within(flour).getByRole('textbox', { name: 'Quantity' }));
    expect(flour).not.toHaveTextContent('Società Agricola');
    expect(supplierLabel).toHaveBeenCalledWith(ROSSI);
  });

  it('nothing under a recipe line, a packaging line, or an ingredient with no supplier — and no empty description', async () => {
    await openForm(source());
    await within(lineOf(madeOf(), 'Flour')).findByText('Molino Rossi', undefined, LOAD);
    for (const line of [lineOf(madeOf(), 'Salt'), lineOf(madeOf(), 'Dough'), lineOf(packaging(), 'Box')]) {
      expect(line.querySelector('p:not([class*="note"])')).toBeNull();
      expect(within(line).getAllByRole('button')[0]).not.toHaveAttribute('aria-describedby');
    }
    expect(packaging()).not.toHaveTextContent('Bianchi');
  });

  it('the line is drawn before the suppliers arrive, and gains the name when they do', async () => {
    const fake = source();
    fake.holdSuppliers();
    await openForm(fake);
    const flour = lineOf(madeOf(), 'Flour');
    expect(within(flour).getByRole('textbox', { name: 'Quantity' })).toHaveValue('500');
    expect(within(flour).queryByText('Molino Rossi')).not.toBeInTheDocument();
    fake.releaseSuppliers();
    expect(await within(flour).findByText('Molino Rossi', undefined, LOAD)).toBeInTheDocument();
  });

  it('a supplier renamed elsewhere is followed live, and typing a quantity keeps the same box', async () => {
    const fake = source();
    const { user } = await openForm(fake);
    const flour = lineOf(madeOf(), 'Flour');
    await within(flour).findByText('Molino Rossi', undefined, LOAD);
    const box = within(flour).getByRole('textbox', { name: 'Quantity' });
    await user.type(box, '0');
    expect(within(lineOf(madeOf(), 'Flour')).getByRole('textbox', { name: 'Quantity' })).toBe(box);
    fake.suppliers.set('rossi', { ...ROSSI, shortName: 'Rossi Mill' });
    fake.push();
    expect(await within(flour).findByText('Rossi Mill', undefined, LOAD)).toBeInTheDocument();
    expect(box).toHaveValue('5000');
  });
});
