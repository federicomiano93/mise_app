import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», step 3e-4 slice B: the ingredient card's pack list, allergens and nutrition, through the real screen
// and the fake source — which sections are drawn, the country's words, the proposal from the pack text (its timing and what it
// never does), the verification stamp, what a save writes (only what changed) and the nutrition boxes.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills Ltd' })];
const base = { supplierId: 's-alp', weight: '', unit: 'kg', category: 'Bakery' };
// Never declared: no stamp, no text.
const PLAIN = item('i-plain', { name: 'Flour', ...base });
// Declared: milk, stamped, with its pack text and two figures.
const DECLARED = item('i-declared', {
  name: 'Cream', ...base, allergens: ['milk'], mayContain: [], allergensCheckedAt: '2026-01-01T09:00:00.000Z',
  packIngredients: 'Cream (milk)', nutrition: { kcal: 0, fat: 12.5 },
});
// Verified «contains none», no text.
const VERIFIED = item('i-verified', { name: 'Salt', ...base, allergens: [], mayContain: [], allergensCheckedAt: '2026-02-02T09:00:00.000Z' });
// Pack text that says milk, and a milk box somebody deliberately left unticked.
const SAID = item('i-said', { name: 'Oat drink', ...base, allergens: [], mayContain: [], allergensCheckedAt: '', packIngredients: 'latte' });
const BOX = item('i-box', { name: 'Cake box', kind: 'packaging', supplierId: 's-alp' });

const seeded = (): FakeSuppliersSource => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [PLAIN, DECLARED, VERIFIED, SAID, BOX] });
const dialogOf = (name: string) => screen.findByRole('alertdialog', { name });

async function open(path: string, source = seeded(), options = {}) {
  const view = renderSuppliers(path, { source, ...options });
  const region = within(await screen.findByRole('region', { name: /^(Edit|New|Modifica|Nuovo) (ingredient|ingrediente|packaging|imballaggio)$/ }, LOAD));
  return { ...view, source, region };
}
type View = Awaited<ReturnType<typeof open>>;
type Region = View['region'];

const PACK_LABEL = 'The ingredient list printed on the pack';
const packHead = (region: Region) => region.getByRole('button', { name: /^Ingredient list/ });
const allergenHead = (region: Region) => region.getByRole('button', { name: /^Allergens/ });
const nutritionHead = (region: Region) => region.getByRole('button', { name: /^Nutrition/ });
const packBox = (region: Region, hidden = false) => region.getByRole('textbox', { name: PACK_LABEL, hidden });
const contains = (region: Region, name: string, hidden = false) => region.getByRole('checkbox', { name: `Contains ${name}`, hidden });
const checkedBox = (region: Region) => region.getByRole('checkbox', { name: 'I have checked the supplier’s specification' });

async function saveAndConfirm(view: View) {
  await view.user.click(view.region.getByRole('button', { name: 'Save' }));
  await view.user.click(within(await dialogOf('Save ingredient?')).getByRole('button', { name: 'Save' }));
  await waitFor(() => { expect(view.source.writes.some(write => write.op === 'ingredient-save')).toBe(true); });
}
const saved = (source: FakeSuppliersSource): Record<string, unknown> => {
  const write = source.writes.find(one => one.op === 'ingredient-save');
  if (write?.op !== 'ingredient-save') throw new Error('nothing was saved');
  return write.data;
};

describe('which sections are drawn', () => {
  it('an ingredient has the three sections, all CLOSED on open, with the answer outside the fold', async () => {
    const { region } = await open('/suppliers/ingredient/i-declared');
    for (const head of [packHead(region), allergenHead(region), nutritionHead(region)]) {
      expect(head).toHaveAttribute('aria-expanded', 'false');
    }
    expect(packBox(region, true)).not.toBeVisible();
    expect(contains(region, 'Milk', true)).not.toBeVisible();
    // The status line is outside the fold: read without touching anything.
    expect(region.getByText('Checked 2026-01-01 — Milk.')).toBeVisible();
    expect(allergenHead(region)).toHaveAccessibleName('Allergens declared');
    expect(packHead(region)).toHaveAccessibleName('Ingredient list filled in');
    expect(nutritionHead(region)).toHaveAccessibleName('Nutrition 6 of 8 empty');
  });

  it('an ingredient nobody has declared says so in words, outside the fold', async () => {
    const { region } = await open('/suppliers/ingredient/i-plain');
    expect(region.getByText('Not checked yet — this ingredient blocks any label it is used in.')).toBeVisible();
    expect(allergenHead(region)).toHaveAccessibleName('Allergens not declared');
    expect(packHead(region)).toHaveAccessibleName('Ingredient list to fill in');
    expect(nutritionHead(region)).toHaveAccessibleName('Nutrition Nothing yet');
  });

  it('opening a fold shows its job; a second tap shuts it', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(allergenHead(region));
    expect(allergenHead(region)).toHaveAttribute('aria-expanded', 'true');
    expect(contains(region, 'Milk')).toBeVisible();
    await user.click(allergenHead(region));
    expect(contains(region, 'Milk', true)).not.toBeVisible();
  });

  it('packaging has none of it', async () => {
    const { region } = await open('/suppliers/ingredient/i-box');
    expect(region.queryByRole('button', { name: /^Ingredient list/ })).not.toBeInTheDocument();
    expect(region.queryByRole('button', { name: /^Allergens/ })).not.toBeInTheDocument();
    expect(region.queryByRole('button', { name: /^Nutrition/ })).not.toBeInTheDocument();
  });

  it('a venue with allergens off has no pack list and no allergens; nutrition stays', async () => {
    const { region } = await open('/suppliers/ingredient/i-plain', seeded(), { session: { location: { showAllergens: false } } });
    expect(region.queryByRole('button', { name: /^Ingredient list/ })).not.toBeInTheDocument();
    expect(region.queryByRole('button', { name: /^Allergens/ })).not.toBeInTheDocument();
    expect(nutritionHead(region)).toBeInTheDocument();
  });

  it('a venue with nutrition off has no nutrition fold; the other two stay', async () => {
    const { region } = await open('/suppliers/ingredient/i-plain', seeded(), { session: { location: { showNutrition: false } } });
    expect(region.queryByRole('button', { name: /^Nutrition/ })).not.toBeInTheDocument();
    expect(packHead(region)).toBeInTheDocument();
    expect(allergenHead(region)).toBeInTheDocument();
  });

  it('⚠️ a hidden panel is a display switch: renaming a declared item with allergens off writes none of it', async () => {
    const view = await open('/suppliers/ingredient/i-declared', seeded(), { session: { location: { showAllergens: false, showNutrition: false } } });
    expect(view.region.queryByRole('button', { name: /^(Ingredient list|Allergens|Nutrition)/ })).not.toBeInTheDocument();
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in lists' }), 'x');
    await saveAndConfirm(view);
    const data = saved(view.source);
    for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'packIngredients', 'nutrition']) expect(data).not.toHaveProperty(key);
  });

  it('the safety sentence stands under the pack box, on every draw', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    const sentence = region.getByText('This only ticks boxes. Nothing is declared until you tick “I have checked the supplier’s specification” and save.');
    expect(sentence).toBeVisible();
    expect(packBox(region)).toHaveAttribute('aria-describedby', sentence.id);
    expect(packBox(region)).toHaveAttribute('maxlength', '4000');
    expect(packBox(region)).toHaveAttribute('rows', '4');
  });
});

describe('the food words follow the venue\'s country, the words to tap follow the screen', () => {
  it('an Italian venue prints Italian allergens, headings and nutrients on an English screen', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-declared', seeded(), { session: { location: { country: 'IT' }, language: 'en' } });
    expect(region.getByText('Checked 2026-01-01 — Latte.')).toBeInTheDocument();
    await user.click(allergenHead(region));
    expect(region.getByText('Cereali contenenti glutine')).toBeInTheDocument();
    expect(region.getByText('Frutta a guscio')).toBeInTheDocument();
    expect(region.getByRole('checkbox', { name: 'Contains Grano' })).toBeInTheDocument();
    expect(region.getAllByText('has').length).toBeGreaterThan(0);
    await user.click(nutritionHead(region));
    expect(region.getByRole('textbox', { name: 'Energia (kcal)' })).toBeInTheDocument();
  });

  it('an English venue prints English allergens on an Italian screen', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-declared', seeded(), { lang: 'it', session: { language: 'it', location: { country: 'GB' } } });
    expect(region.getByText('Verificato il 2026-01-01 — Milk.')).toBeInTheDocument();
    await user.click(region.getByRole('button', { name: /^Allergeni/ }));
    expect(region.getByText('Cereals containing gluten')).toBeInTheDocument();
    expect(region.getByRole('checkbox', { name: 'Contiene Wheat' })).toBeInTheDocument();
    expect(region.getByRole('checkbox', { name: 'Può contenere tracce di Wheat' })).toBeInTheDocument();
    expect(region.getByText('Il resto')).toBeInTheDocument();
    await user.click(region.getByRole('button', { name: /^Valori nutrizionali/ }));
    expect(region.getByRole('textbox', { name: 'Energy (kJ)' })).toBeInTheDocument();
  });
});

describe('the pack text proposes, it never declares', () => {
  it('⚠️ typing «latte» does nothing before the pause; after 450 ms it ticks milk and says so, and a save stamps nothing', async () => {
    const view = await open('/suppliers/ingredient/i-plain');
    const { region, user } = view;
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    act(() => { vi.advanceTimersByTime(449); });
    expect(contains(region, 'Milk')).not.toBeChecked();
    expect(region.queryByText(/The app has ticked/)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(contains(region, 'Milk')).toBeChecked();
    expect(region.getByText('The app has ticked 1 box from the ingredient list. Open Allergens and check it.')).toBeInTheDocument();
    // The state word of the pack list is neutral once filled in, and the allergens still read «not declared».
    expect(allergenHead(region)).toHaveAccessibleName('Allergens not declared');
    vi.useRealTimers();
    await saveAndConfirm(view);
    const data = saved(view.source);
    expect(data).toMatchObject({ allergens: ['milk'], mayContain: [], allergensCheckedAt: '', packIngredients: 'latte' });
  });

  it('every keystroke restarts the pause', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(packBox(region), { target: { value: 'lat' } });
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(contains(region, 'Milk')).not.toBeChecked();
    act(() => { vi.advanceTimersByTime(150); });
    expect(contains(region, 'Milk')).toBeChecked();
  });

  it('leaving the box proposes at once', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    await user.type(packBox(region), 'latte');
    await user.tab();
    expect(contains(region, 'Milk')).toBeChecked();
  });

  it('⚠️ opening an item whose text says «latte» with milk unticked leaves it unticked, and so does passing through the box', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-said');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => { vi.advanceTimersByTime(2000); });
    vi.useRealTimers();
    expect(contains(region, 'Milk')).not.toBeChecked();
    expect(region.queryByText(/The app has ticked/)).not.toBeInTheDocument();
    await user.click(packBox(region));
    await user.tab();
    expect(contains(region, 'Milk')).not.toBeChecked();
  });

  it('says what it recognised nothing of, and asks about what it cannot answer', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.type(packBox(region), 'zzzz');
    await user.tab();
    expect(region.getByText(/It recognised no allergen words in this text\. That does NOT mean/)).toBeInTheDocument();
    await user.clear(packBox(region));
    await user.type(packBox(region), 'emulsionante: lecitine');
    await user.tab();
    expect(region.getByText(/“lecitine” could be .* — the pack does not say which\./)).toBeInTheDocument();
    expect(region.queryByText(/recognised no allergen words/)).not.toBeInTheDocument();
  });

  it('⚠️ on a verified item, text that moves a box un-ticks «I have checked» and says the check has lapsed', async () => {
    const view = await open('/suppliers/ingredient/i-verified');
    const { region, user } = view;
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    expect(checkedBox(region)).toBeChecked();
    await user.type(packBox(region), 'latte');
    await user.tab();
    expect(contains(region, 'Milk')).toBeChecked();
    expect(checkedBox(region)).not.toBeChecked();
    expect(region.getByText('The verification has lapsed: the app changed 1 box from the ingredient list. Check the allergens and tick «I have checked…» again.')).toBeInTheDocument();
    // The old date is gone with it: the status reads «not checked» and a save writes no stamp.
    expect(region.getByText('Not checked yet — this ingredient blocks any label it is used in.')).toBeInTheDocument();
    await saveAndConfirm(view);
    expect(saved(view.source)).toMatchObject({ allergens: ['milk'], allergensCheckedAt: '' });
  });

  it('a lapsed check keeps speaking after the app takes its own tick back', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-verified');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    await user.type(packBox(region), 'latte');
    await user.tab();
    await user.clear(packBox(region));
    await user.tab();
    expect(contains(region, 'Milk')).not.toBeChecked();
    expect(region.getByText('The verification has lapsed: the app changed the boxes from the ingredient list. Check the allergens and tick «I have checked…» again.')).toBeInTheDocument();
  });

  it('a box a person ticked is never taken back by the text', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    await user.click(contains(region, 'Milk'));
    await user.type(packBox(region), 'latte');
    await user.clear(packBox(region));
    await user.tab();
    expect(contains(region, 'Milk')).toBeChecked();
  });
});

describe('the verification stamp and what a save writes', () => {
  it('⚠️ ticking «I have checked» and saving writes the stamp', async () => {
    const view = await open('/suppliers/ingredient/i-plain');
    await view.user.click(allergenHead(view.region));
    await view.user.click(contains(view.region, 'Milk'));
    await view.user.click(checkedBox(view.region));
    expect(view.region.getByText(/^Checked \d{4}-\d{2}-\d{2} — Milk\.$/)).toBeInTheDocument();
    expect(allergenHead(view.region)).toHaveAccessibleName('Allergens declared');
    await saveAndConfirm(view);
    expect(saved(view.source)).toMatchObject({
      allergens: ['milk'], mayContain: [], allergensCheckedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });
  });

  it('a tick in «traces» is its own column, never merged into «has»', async () => {
    const view = await open('/suppliers/ingredient/i-plain');
    await view.user.click(allergenHead(view.region));
    await view.user.click(view.region.getByRole('checkbox', { name: 'May contain traces of Eggs' }));
    await saveAndConfirm(view);
    expect(saved(view.source)).toMatchObject({ allergens: [], mayContain: ['eggs'], allergensCheckedAt: '' });
  });

  it('⚠️ an untouched Save of a declared item writes NO allergen key at all, and never moves the stamp', async () => {
    const view = await open('/suppliers/ingredient/i-declared');
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in lists' }), 'x');
    await saveAndConfirm(view);
    const data = saved(view.source);
    for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'packIngredients', 'nutrition']) expect(data).not.toHaveProperty(key);
  });

  it('a change to the nutrition alone writes the nutrition and nothing of the declaration', async () => {
    const view = await open('/suppliers/ingredient/i-declared');
    await view.user.click(nutritionHead(view.region));
    const fat = view.region.getByRole('textbox', { name: 'Fat (g)' });
    expect(fat).toHaveValue('12.5');
    await view.user.clear(fat);
    await view.user.type(fat, '3');
    await saveAndConfirm(view);
    const data = saved(view.source);
    expect(data).toMatchObject({ nutrition: { fat: 3, kcal: 0 } });
    for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'packIngredients']) expect(data).not.toHaveProperty(key);
  });

  it('a NEW ingredient writes all five, still undeclared', async () => {
    const view = await open('/suppliers/ingredient/new');
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in the message' }), 'Salt');
    await saveAndConfirm(view);
    expect(saved(view.source)).toMatchObject({
      allergens: [], mayContain: [], allergensCheckedAt: '', packIngredients: '',
      nutrition: { kj: null, kcal: null, fat: null, saturates: null, carbs: null, sugars: null, protein: null, salt: null },
    });
  });

  it('packaging writes none of it', async () => {
    const view = await open('/suppliers/ingredient/i-box');
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in lists' }), 'x');
    await view.user.click(view.region.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await dialogOf('Save packaging?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.source.writes).toHaveLength(1); });
    const data = saved(view.source);
    for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'packIngredients', 'nutrition']) expect(data).not.toHaveProperty(key);
  });
});

describe('the nutrition boxes', () => {
  const box = (region: Region, name: string) => region.getByRole('textbox', { name });

  it('⚠️ a comma reads like a dot: «1,5» saves 1.5', async () => {
    const view = await open('/suppliers/ingredient/i-plain');
    await view.user.click(nutritionHead(view.region));
    await view.user.type(box(view.region, 'Fat (g)'), '1,5');
    expect(box(view.region, 'Fat (g)')).toHaveAttribute('inputmode', 'decimal');
    expect(box(view.region, 'Fat (g)')).toHaveAttribute('type', 'text');
    expect(nutritionHead(view.region)).toHaveAccessibleName('Nutrition 7 of 8 empty');
    await saveAndConfirm(view);
    expect(saved(view.source)).toMatchObject({ nutrition: { fat: 1.5, kcal: null } });
  });

  it('⚠️ 0 is a real figure: it saves 0, not «empty»', async () => {
    const view = await open('/suppliers/ingredient/i-plain');
    await view.user.click(nutritionHead(view.region));
    await view.user.type(box(view.region, 'Protein (g)'), '0');
    await saveAndConfirm(view);
    expect(saved(view.source)).toMatchObject({ nutrition: { protein: 0, salt: null } });
  });

  it('⚠️ text that is not a number refuses Save: the fold opens, the box is marked, said and takes the focus, nothing is written', async () => {
    const view = await open('/suppliers/ingredient/i-plain');
    const { region, user, source } = view;
    await user.click(nutritionHead(region));
    await user.type(box(region, 'Salt (g)'), 'abc');
    // Shut again: the refusal must open it.
    await user.click(nutritionHead(region));
    expect(nutritionHead(region)).toHaveAttribute('aria-expanded', 'false');
    await user.click(region.getByRole('button', { name: 'Save' }));
    const salt = box(region, 'Salt (g)');
    expect(nutritionHead(region)).toHaveAttribute('aria-expanded', 'true');
    expect(salt).toHaveAttribute('aria-invalid', 'true');
    expect(salt).toHaveFocus();
    const sentence = region.getByText('Write a number, 0 or more — e.g. 12.5.');
    expect(salt.getAttribute('aria-describedby')).toContain(sentence.id);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.writes).toEqual([]);
    // Typing in it clears the sentence.
    await user.clear(salt);
    await user.type(salt, '2');
    expect(salt).not.toHaveAttribute('aria-invalid');
    expect(region.queryByText('Write a number, 0 or more — e.g. 12.5.')).not.toBeInTheDocument();
  });

  it('a negative figure is refused too', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-plain');
    await user.click(nutritionHead(region));
    await user.type(box(region, 'Fat (g)'), '-1');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(box(region, 'Fat (g)')).toHaveAttribute('aria-invalid', 'true');
    expect(source.writes).toEqual([]);
  });

  it('says the refusal in Italian, with the Italian layout of the example', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain', seeded(), { lang: 'it', session: { language: 'it', location: { country: 'IT' } } });
    await user.click(region.getByRole('button', { name: /^Valori nutrizionali/ }));
    await user.type(region.getByRole('textbox', { name: 'Grassi (g)' }), 'abc');
    await user.click(region.getByRole('button', { name: 'Salva' }));
    expect(region.getByText('Scrivi un numero, 0 o più — per esempio 12,5.')).toBeInTheDocument();
  });

  it('the head counts what is still empty and turns complete when all eight are in', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(nutritionHead(region));
    for (const name of ['Energy (kJ)', 'Energy (kcal)', 'Fat (g)', 'of which saturates (g)', 'Carbohydrate (g)', 'of which sugars (g)', 'Protein (g)']) {
      await user.type(box(region, name), '1');
    }
    expect(nutritionHead(region)).toHaveAccessibleName('Nutrition 1 of 8 empty');
    await user.type(box(region, 'Salt (g)'), '1');
    expect(nutritionHead(region)).toHaveAccessibleName('Nutrition Complete');
  });
});

describe('leaving with an allergen change', () => {
  it('⚠️ asks «Discard changes?» after a tick, and not before', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(allergenHead(region));
    await user.click(contains(region, 'Milk'));
    await user.click(region.getByRole('button', { name: 'Back' }));
    expect(await dialogOf('Discard changes?')).toBeInTheDocument();
  });

  it('a tick put back to where it was asks nothing', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(allergenHead(region));
    await user.click(contains(region, 'Milk'));
    await user.click(contains(region, 'Milk'));
    await user.click(region.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('typed pack text asks too', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.type(packBox(region), 'sugar');
    await user.click(region.getByRole('button', { name: 'Back' }));
    expect(await dialogOf('Discard changes?')).toBeInTheDocument();
  });
});
