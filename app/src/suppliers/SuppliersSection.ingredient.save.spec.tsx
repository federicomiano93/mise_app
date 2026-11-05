import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { INGREDIENT_DRAINED_FIELDS } from '@mise/shared/price-model';
import { isBusy } from '../session/busy';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», step 3e-2: the ingredient card's Save — every refusal and where it points, the question, the exact
// payload written, the order line it freezes, «+ New supplier…» in a dialog above the card, and the way out.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills Ltd', shortName: 'Alpine' }),
  supplier('s-zed', { name: 'Zed Dairy' }),
];
const FLOUR = item('i-flour', {
  name: 'Flour 00', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', unit: 'kg',
  invoiceName: 'FARINA 00 25KG', supplierCodes: ['A1'], allergens: ['milk'], allergensCheckedAt: '2026-01-01', pricePerUnit: 3, priceUnit: 'kg',
});
const CASE = item('i-case', { name: 'Passata', packCount: 4, packUnit: 'bag', unit: 'case', weight: '2.5 kg', supplierId: 's-zed' });
const BOX = item('i-box', { name: 'Cake box', kind: 'packaging', supplierId: 's-alp' });

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [FLOUR, CASE, BOX] });
const main = () => within(screen.getByRole('main'));
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });
const drained = Object.fromEntries(INGREDIENT_DRAINED_FIELDS.map(key => [key, null]));

async function open(path: string, source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  const region = within(await screen.findByRole('region', { name: /^(Edit|New|Modifica|Nuovo) (ingredient|ingrediente|packaging|imballaggio)$/ }, LOAD));
  return { ...view, source, region };
}
type Region = Awaited<ReturnType<typeof open>>['region'];
const nameBox = (region: Region) => region.getByRole('textbox', { name: 'Name in the message' });

async function saveAndConfirm(view: { user: Awaited<ReturnType<typeof open>>['user']; region: Region }) {
  await view.user.click(view.region.getByRole('button', { name: 'Save' }));
  await view.user.click(within(await dialogOf('Save ingredient?')).getByRole('button', { name: 'Save' }));
}

describe('the refusals', () => {
  it('⚠️ an empty name is marked, said under the box, takes the focus, asks nothing and writes nothing', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/new');
    await user.click(region.getByRole('button', { name: 'Save' }));
    const box = nameBox(region);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveFocus();
    expect(region.getByText('Enter the ingredient’s name.')).toBeInTheDocument();
    expect(box.getAttribute('aria-describedby')).toContain(region.getByText('Enter the ingredient’s name.').id);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.writes).toEqual([]);
    // Typing clears it.
    await user.type(box, 'S');
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(region.queryByText('Enter the ingredient’s name.')).not.toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    const { region, user } = await open('/suppliers/ingredient/new', seeded(), { lang: 'it', session: { language: 'it' } });
    await user.click(region.getByRole('button', { name: 'Salva' }));
    expect(region.getByText('Scrivi il nome dell’ingrediente.')).toBeInTheDocument();
  });

  it('⚠️ an unusable weight is refused on its box, with its sentence; an empty box is fine', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-flour');
    const amount = region.getByRole('textbox', { name: 'Weight amount' });
    for (const typed of ['2.27kg', 'abc', '0']) {
      await user.clear(amount);
      await user.type(amount, typed);
      await user.click(region.getByRole('button', { name: 'Save' }));
      expect(amount).toHaveAttribute('aria-invalid', 'true');
      expect(amount).toHaveFocus();
      expect(region.getByText('Write a number, e.g. 2.5')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    }
    await user.type(amount, '5');
    expect(amount).not.toHaveAttribute('aria-invalid');
    await user.clear(amount);
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(await dialogOf('Save ingredient?')).toBeInTheDocument();
    expect(source.writes).toEqual([]);
  });

  it('a «+ New category…» box left empty is refused on that box', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-flour');
    await user.selectOptions(region.getByRole('combobox', { name: 'Category' }), '+ New category…');
    const typed = region.getByRole('textbox', { name: 'New category name' });
    expect(typed).toHaveFocus();
    expect(typed).toHaveAttribute('maxlength', '200');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(typed).toHaveAttribute('aria-invalid', 'true');
    expect(typed).toHaveFocus();
    expect(region.getByText('Write the new category’s name')).toBeInTheDocument();
  });

  it('the order: the name first, then the weight', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-flour');
    await user.clear(nameBox(region));
    await user.clear(region.getByRole('textbox', { name: 'Weight amount' }));
    await user.type(region.getByRole('textbox', { name: 'Weight amount' }), 'abc');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(nameBox(region)).toHaveFocus();
    expect(region.getByRole('textbox', { name: 'Weight amount' })).not.toHaveAttribute('aria-invalid');
  });

  it('⚠️ a Case being written needs a whole count, then a word', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-flour');
    await user.click(region.getByRole('button', { name: 'Case' }));
    const count = region.getByRole('textbox', { name: 'How many in the case' });
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(count).toHaveAttribute('aria-invalid', 'true');
    expect(count).toHaveFocus();
    expect(region.getByText('Write a whole number, e.g. 4')).toBeInTheDocument();
    await user.type(count, '2.5');
    expect(count).not.toHaveAttribute('aria-invalid');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(count).toHaveAttribute('aria-invalid', 'true');

    await user.clear(count);
    await user.type(count, '3');
    await user.selectOptions(region.getByRole('combobox', { name: 'What is inside the case' }), '— none —');
    await user.click(region.getByRole('button', { name: 'Save' }));
    const menu = region.getByRole('combobox', { name: 'What is inside the case' });
    expect(menu).toHaveAttribute('aria-invalid', 'true');
    expect(menu).toHaveFocus();
    expect(region.getByText('Choose what is inside the case')).toBeInTheDocument();

    await user.selectOptions(menu, '+ New…');
    const typed = region.getByRole('textbox', { name: 'New package name' });
    expect(typed).toHaveAttribute('maxlength', '40');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(typed).toHaveAttribute('aria-invalid', 'true');
    expect(region.getByText('Write the new package’s name')).toBeInTheDocument();
    expect(source.writes).toEqual([]);
  });

  it('⚠️ a Case nobody touched is not refused: an old product with no count saves as it was', async () => {
    const source = fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [item('i-old', { name: 'Old cartons', unit: 'cartone', packUnit: 'busta' })] });
    const view = await open('/suppliers/ingredient/i-old', source);
    expect(view.region.getByRole('button', { name: 'Case' })).toHaveAttribute('aria-pressed', 'true');
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    await saveAndConfirm(view);
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toMatchObject({ data: { brand: 'X' } });
    expect(source.writes[0]).not.toMatchObject({ data: { packCount: expect.anything() } });
  });
});

describe('the question and the payload', () => {
  it('asks «Save “name”?» with the name shown in lists; Cancel writes nothing and keeps the card', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    const dialog = await dialogOf('Save ingredient?');
    expect(within(dialog).getByText('Save “Flour”?')).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(view.source.writes).toEqual([]);
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
  });

  it('⚠️ a rename writes the product data and the six drained nulls — no format key, no price, allergen or nutrition key, no invoice name', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.clear(nameBox(view.region));
    await view.user.type(nameBox(view.region), '  Flour 000  ');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toEqual({
      op: 'ingredient-save',
      id: 'i-flour',
      data: {
        name: 'Flour 000', shortName: 'Flour', supplierId: 's-alp', brand: 'Caputo', weight: '25 kg', category: 'Bakery', active: true, kind: 'ingredient',
        ...drained,
      },
      // The card of a person who may not write prices carries no money (step 3e-3: the fake records the money of the batch).
      price: null,
    });
  });

  it('a blank short name is sent as an empty string, a blank category as «Other», the weight joined from its two boxes', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.clear(view.region.getByRole('textbox', { name: 'Name in lists' }));
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Category' }), '— none —');
    await view.user.clear(view.region.getByRole('textbox', { name: 'Weight amount' }));
    await view.user.type(view.region.getByRole('textbox', { name: 'Weight amount' }), '2,5');
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Weight unit' }), 'l');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { shortName: '', category: 'Other', weight: '2.5 l' } });
  });

  it('a new category is saved as typed, trimmed', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Category' }), '+ New category…');
    await view.user.type(view.region.getByRole('textbox', { name: 'New category name' }), '  Dairy ');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { category: 'Dairy' } });
  });

  it('⚠️ an unreadable weight is saved untouched unless a usable number is typed', async () => {
    const source = fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [item('i-odd', { name: 'Odd', weight: '6x1kg' })] });
    const view = await open('/suppliers/ingredient/i-odd', source);
    await saveAndConfirm(view);
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]).toMatchObject({ data: { weight: '6x1kg' } });
  });

  it('Single → Case writes the count, the word and the venue\'s carton word, and freezes the open order line in the old unit', async () => {
    const source = seeded();
    source.draft = { 'i-flour': { qty: 3 } };
    const view = await open('/suppliers/ingredient/i-flour', source);
    await view.user.click(view.region.getByRole('button', { name: 'Case' }));
    await view.user.type(view.region.getByRole('textbox', { name: 'How many in the case' }), '4');
    expect(view.region.getByText('Case of 4 bags of 25 kg (100 kg)')).toBeInTheDocument();
    await saveAndConfirm(view);
    await waitFor(() => { expect(source.writes.some(write => write.op === 'draft-unit')).toBe(true); });
    expect(source.writes[0]).toMatchObject({ op: 'ingredient-save', data: { packCount: 4, packUnit: 'bag', unit: 'case' } });
    expect(source.draft?.['i-flour']).toEqual({ qty: 3, unit: 'kg' });
  });

  it('Case → Single writes no count, and the unit the line meant stays: the open line is frozen in «case»', async () => {
    const source = seeded();
    source.draft = { 'i-case': { qty: 2 } };
    const view = await open('/suppliers/ingredient/i-case', source);
    await view.user.click(view.region.getByRole('button', { name: 'Single' }));
    await saveAndConfirm(view);
    await waitFor(() => { expect(source.writes.some(write => write.op === 'draft-unit')).toBe(true); });
    expect(source.writes[0]).toMatchObject({ op: 'ingredient-save', data: { packCount: null, unit: 'bag' } });
    expect(source.draft?.['i-case']).toEqual({ qty: 2, unit: 'case' });
  });

  it('a Case in an Italian venue writes the Italian words, whatever the screen says', async () => {
    const view = await open('/suppliers/ingredient/new', seeded(), { session: { location: { country: 'IT' }, language: 'en' } });
    await view.user.type(nameBox(view.region), 'Passata');
    await view.user.click(view.region.getByRole('button', { name: 'Case' }));
    await view.user.type(view.region.getByRole('textbox', { name: 'How many in the case' }), '6');
    expect(view.region.getByRole('combobox', { name: 'What is inside the case' })).toHaveValue('busta');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { packCount: 6, packUnit: 'busta', unit: 'cartone' } });
  });

  it('a NEW ingredient', async () => {
    const view = await open('/suppliers/ingredient/new');
    await view.user.type(nameBox(view.region), 'Salt');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toEqual({
      op: 'ingredient-save',
      id: expect.stringMatching(/^new-ingredient-/),
      data: {
        name: 'Salt', shortName: '', supplierId: 'no-supplier', brand: '', weight: '', category: 'Other', unit: '', active: true, kind: 'ingredient',
        ...drained,
        allergens: [], mayContain: [], allergensCheckedAt: '', packIngredients: '',
        nutrition: { kj: null, kcal: null, fat: null, saturates: null, carbs: null, sugars: null, protein: null, salt: null },
      },
      price: null,
    });
  });

  it('a NEW packaging item, started on a supplier', async () => {
    const view = await open('/suppliers/ingredient/new?kind=packaging&supplier=s-zed');
    expect(view.region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('s-zed');
    await view.user.type(nameBox(view.region), 'Box 30x40');
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await dialogOf('Save packaging?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { name: 'Box 30x40', supplierId: 's-zed', unit: '', active: true, kind: 'packaging' } });
  });

  it('an existing packaging item stays packaging', async () => {
    const view = await open('/suppliers/ingredient/i-box');
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await dialogOf('Save packaging?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { kind: 'packaging', brand: 'X' } });
  });

  it('an employee saves the same card', async () => {
    const view = await open('/suppliers/ingredient/i-flour', seeded(), { session: { canManage: false, role: 'staff', isOwner: false } });
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
  });

  it('goes back to the list, says it was saved, and the row owes the focus', async () => {
    const view = await open('/suppliers/ingredient/new');
    await view.user.type(nameBox(view.region), 'Salt');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers'); });
    expect(await screen.findByText('Ingredient saved.')).toBeInTheDocument();
    expect(await main().findByRole('button', { name: /^Salt/ })).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'New ingredient' })).not.toBeInTheDocument(); });
  });

  it('saves while the network is away: on screen at once, busy until the server answers', async () => {
    const source = seeded();
    const release = source.holdWrites();
    const view = await open('/suppliers/ingredient/i-flour', source);
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers'); });
    expect(isBusy()).toBe(true);
    release();
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('a refused write is said, by the store\'s sentence', async () => {
    const source = seeded();
    source.refuseWrites.ingredientSave = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await open('/suppliers/ingredient/i-flour', source);
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    await saveAndConfirm(view);
    expect(await screen.findByText('Could not save “Flour”. Check your network and try again.')).toBeInTheDocument();
  });

  it('ignores a second tap on Save while the question is open', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    const save = view.region.getByRole('button', { name: 'Save' });
    await view.user.click(save);
    await dialogOf('Save ingredient?');
    await act(async () => { save.click(); });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  });
});

describe('«+ New supplier…» in a dialog above the card', () => {
  const NEW = '+ New supplier…';

  it('offers it last in the menu, after «No supplier» first and the suppliers by the name shown', async () => {
    const { region } = await open('/suppliers/ingredient/i-flour');
    const options = within(region.getByRole('combobox', { name: 'Supplier' })).getAllByRole('option').map(option => option.textContent);
    expect(options).toEqual(['— No supplier —', 'Alpine', 'Zed Dairy', NEW]);
  });

  it('⚠️ opens the supplier card in a dialog, keeps every keystroke underneath, and selects the new supplier', async () => {
    const view = await open('/suppliers/ingredient/new');
    await view.user.type(nameBox(view.region), 'Ricotta');
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Supplier' }), NEW);
    const dialog = within(await screen.findByRole('dialog', { name: 'New supplier' }));
    // The address did not change.
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/new');
    await view.user.type(dialog.getByRole('textbox', { name: 'Name on invoices' }), 'Latteria Rossi');
    await view.user.click(dialog.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await dialogOf('Save supplier?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New supplier' })).not.toBeInTheDocument(); });
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/new');
    expect(nameBox(view.region)).toHaveValue('Ricotta');
    const menu = view.region.getByRole('combobox', { name: 'Supplier' });
    expect(within(menu).getByRole('option', { name: 'Latteria Rossi' })).toBeInTheDocument();
    const made = [...view.source.suppliers.keys()].find(key => key.startsWith('new-supplier-'));
    expect(menu).toHaveValue(made);

    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes.some(write => write.op === 'ingredient-save')).toBe(true); });
    const saved = view.source.writes.find(write => write.op === 'ingredient-save');
    expect(saved).toMatchObject({ data: { name: 'Ricotta', supplierId: made } });
  });

  it('⚠️ cancelled, the previous value comes back and the marker is never saved', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Supplier' }), NEW);
    const dialog = within(await screen.findByRole('dialog', { name: 'New supplier' }));
    await view.user.click(dialog.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New supplier' })).not.toBeInTheDocument(); });
    expect(view.region.getByRole('combobox', { name: 'Supplier' })).toHaveValue('s-alp');
    // Nothing was typed on the card: leaving it asks nothing.
    expect(isBusy()).toBe(false);
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), 'X');
    await saveAndConfirm(view);
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    expect(view.source.writes[0]).toMatchObject({ data: { supplierId: 's-alp' } });
  });

  it('a supplier card with typing asks «Discard changes?» before it closes, and Escape does not close it', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.selectOptions(view.region.getByRole('combobox', { name: 'Supplier' }), NEW);
    const dialog = within(await screen.findByRole('dialog', { name: 'New supplier' }));
    await view.user.type(dialog.getByRole('textbox', { name: 'Name on invoices' }), 'Rossi');
    await view.user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'New supplier' })).toBeInTheDocument();
    await view.user.click(dialog.getByRole('button', { name: 'Back' }));
    await view.user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New supplier' })).not.toBeInTheDocument(); });
    expect(view.source.writes).toEqual([]);
  });
});

describe('leaving the card', () => {
  it('with nothing typed leaves in silence, to the list', async () => {
    const view = await open('/suppliers/ingredient/new');
    await view.user.click(view.region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('⚠️ choosing a menu word and choosing it back is not a change', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.click(view.region.getByRole('button', { name: 'Case' }));
    await view.user.click(view.region.getByRole('button', { name: 'Single' }));
    await view.user.click(view.region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('with something typed asks «Discard changes?»: Cancel stays, Discard leaves and writes nothing', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.type(nameBox(view.region), '!');
    await view.user.click(view.region.getByRole('button', { name: 'Back' }));
    const dialog = await dialogOf('Discard changes?');
    expect(within(dialog).getByText(/What you typed on this card is not saved/)).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    expect(nameBox(view.region)).toHaveValue('Flour 00!');
    await view.user.click(view.region.getByRole('button', { name: 'Back' }));
    await view.user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/suppliers'); });
    expect(view.source.writes).toEqual([]);
  });

  it('asks on the browser\'s Back and on the rail too, and holds the app busy while something is unsaved', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    expect(isBusy()).toBe(false);
    await view.user.type(nameBox(view.region), '!');
    expect(isBusy()).toBe(true);
    act(() => { void view.router.navigate('/suppliers/packaging'); });
    await view.user.click(within(await dialogOf('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(view.router.state.location.pathname).toBe('/suppliers/ingredient/i-flour');
    await view.user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Recipes' }));
    expect(await dialogOf('Discard changes?')).toBeInTheDocument();
  });

  it('⚠️ copies ONCE: the item changed on another phone afterwards never replaces what is on the card', async () => {
    const view = await open('/suppliers/ingredient/i-flour');
    await view.user.type(view.region.getByRole('textbox', { name: 'Brand' }), '!');
    view.source.ingredients.set('i-flour', { ...FLOUR, brand: 'Other', name: 'Renamed' });
    act(() => { view.source.push(); });
    expect(view.region.getByRole('textbox', { name: 'Brand' })).toHaveValue('Caputo!');
    expect(nameBox(view.region)).toHaveValue('Flour 00');
  });
});
