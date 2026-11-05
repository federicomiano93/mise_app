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
const contains = (region: Region, name: string, hidden = false) => region.getByRole('checkbox', { name: `${name} has`, hidden });
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
    expect(region.getByRole('checkbox', { name: 'Grano has' })).toBeInTheDocument();
    expect(region.getAllByText('has').length).toBeGreaterThan(0);
    await user.click(nutritionHead(region));
    expect(region.getByRole('textbox', { name: 'Energia (kcal)' })).toBeInTheDocument();
  });

  it('an English venue prints English allergens on an Italian screen', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-declared', seeded(), { lang: 'it', session: { language: 'it', location: { country: 'GB' } } });
    expect(region.getByText('Verificato il 2026-01-01 — Milk.')).toBeInTheDocument();
    await user.click(region.getByRole('button', { name: /^Allergeni/ }));
    expect(region.getByText('Cereals containing gluten')).toBeInTheDocument();
    expect(region.getByRole('checkbox', { name: 'Wheat ha' })).toBeInTheDocument();
    expect(region.getByRole('checkbox', { name: 'Wheat tracce' })).toBeInTheDocument();
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

  it('⚠️ leaving the box does NOT propose by itself (a difference from the current app, on purpose): the proposal comes at the pause', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    act(() => { packBox(region).focus(); });
    act(() => { packBox(region).blur(); });
    expect(packBox(region)).not.toHaveFocus();
    expect(contains(region, 'Milk')).not.toBeChecked();
    act(() => { vi.advanceTimersByTime(449); });
    expect(contains(region, 'Milk')).not.toBeChecked();
    act(() => { vi.advanceTimersByTime(1); });
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
    expect(await region.findByText(/It recognised no allergen words in this text\. That does NOT mean/)).toBeInTheDocument();
    await user.clear(packBox(region));
    await user.type(packBox(region), 'emulsionante: lecitine');
    expect(await region.findByText(/“lecitine” could be .* — the pack does not say which\./)).toBeInTheDocument();
    expect(region.queryByText(/recognised no allergen words/)).not.toBeInTheDocument();
  });

  it('⚠️ on a verified item, text that moves a box un-ticks «I have checked» and says the check has lapsed', async () => {
    const view = await open('/suppliers/ingredient/i-verified');
    const { region, user } = view;
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    expect(checkedBox(region)).toBeChecked();
    await user.type(packBox(region), 'latte');
    await waitFor(() => { expect(contains(region, 'Milk')).toBeChecked(); });
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
    await waitFor(() => { expect(contains(region, 'Milk')).toBeChecked(); });
    await user.clear(packBox(region));
    await waitFor(() => { expect(contains(region, 'Milk')).not.toBeChecked(); });
    expect(region.getByText('The verification has lapsed: the app changed the boxes from the ingredient list. Check the allergens and tick «I have checked…» again.')).toBeInTheDocument();
  });

  it('a box a person ticked is never taken back by the text', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    await user.click(contains(region, 'Milk'));
    await user.type(packBox(region), 'latte');
    await user.clear(packBox(region));
    await new Promise(resolve => { setTimeout(resolve, 600); });
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
    await view.user.click(view.region.getByRole('checkbox', { name: 'Eggs traces' }));
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

describe('⚠️ a tap on a tick box straight from the pack box never undoes itself', () => {
  it('typing «farina di grano tenero» and tapping Wheat «has» before the pause leaves Wheat ticked, and as the person\'s', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    await user.type(packBox(region), 'farina di grano tenero');
    // The full pointer sequence: the press blurs the text box, the release and the click come after.
    await user.click(contains(region, 'Wheat'));
    await waitFor(() => { expect(contains(region, 'Wheat')).toBeChecked(); });
    // Let the deferred proposal run, then look again: it must have found the box already the person's.
    await new Promise(resolve => { setTimeout(resolve, 600); });
    expect(contains(region, 'Wheat')).toBeChecked();
    expect(region.queryByText(/The app has ticked/)).not.toBeInTheDocument();
  });

  // ⚠️ A FINGER'S ORDER (user-event's touch pointer): pointerdown, pointerup, mousedown (the text box blurs), mouseup, click. The
  // mouse order above never showed the failure these catch.
  it('⚠️ S1: a TOUCH tap on Milk «has» right after typing «latte» leaves Milk ticked, as the person\'s', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    await user.type(packBox(region), 'farina di grano tenero, latte');
    await user.pointer({ keys: '[TouchA]', target: contains(region, 'Milk') });
    expect(contains(region, 'Milk')).toBeChecked();
    // Past the pause: it must have found the box already the person's, so the app owns none of the ticks.
    await waitFor(() => { expect(contains(region, 'Wheat')).toBeChecked(); });
    expect(contains(region, 'Milk')).toBeChecked();
    expect(region.getByText('The app has ticked 1 box from the ingredient list. Open Allergens and check it.')).toBeInTheDocument();
  });

  it('⚠️ S2: on a verified item, «latte» typed and a TOUCH tap at once on «I have checked» to untick it leaves it unticked, and Save stamps nothing', async () => {
    const view = await open('/suppliers/ingredient/i-verified');
    const { region, user } = view;
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    expect(checkedBox(region)).toBeChecked();
    await user.type(packBox(region), 'latte');
    await user.pointer({ keys: '[TouchA]', target: checkedBox(region) });
    await waitFor(() => { expect(contains(region, 'Milk')).toBeChecked(); });
    expect(checkedBox(region)).not.toBeChecked();
    await saveAndConfirm(view);
    expect(saved(view.source)).toMatchObject({ allergens: ['milk'], allergensCheckedAt: '' });
  });

  it('S3: a press held down (pointerdown only) on a tick box lets the pause go by without a proposal; its click runs it and keeps the tick', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    const eggs = region.getByRole('checkbox', { name: 'Eggs has' });
    fireEvent.pointerDown(eggs);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(contains(region, 'Milk')).not.toBeChecked();
    fireEvent.click(eggs);
    expect(contains(region, 'Milk')).not.toBeChecked();
    act(() => { vi.advanceTimersByTime(1); });
    expect(contains(region, 'Milk')).toBeChecked();
    expect(eggs).toBeChecked();
  });

  it('S4: a press released with no click (a scroll, a release off the box) runs the held proposal after about 700 ms', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    const eggs = region.getByRole('checkbox', { name: 'Eggs has' });
    fireEvent.pointerDown(eggs);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerUp(eggs);
    act(() => { vi.advanceTimersByTime(699); });
    expect(contains(region, 'Milk')).not.toBeChecked();
    act(() => { vi.advanceTimersByTime(1); });
    expect(contains(region, 'Milk')).toBeChecked();
  });

  // A finger's whole order, by hand (user-event's own delays would wait on the fake clock): pointerdown, pointerup, mousedown,
  // mouseup, click.
  const finger = (box: HTMLElement) => {
    fireEvent.pointerDown(box, { pointerType: 'touch' });
    fireEvent.pointerUp(box, { pointerType: 'touch' });
    fireEvent.mouseDown(box);
    fireEvent.mouseUp(box);
    fireEvent.click(box);
  };

  it('⚠️ R1: a touch tap on Milk «has» 100 ms after the app ticked it keeps it ticked and is not counted as the app\'s; a later tap unticks it', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    act(() => { vi.advanceTimersByTime(450); });
    expect(contains(region, 'Milk')).toBeChecked();
    expect(region.getByText('The app has ticked 1 box from the ingredient list. Open Allergens and check it.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(100); });
    finger(contains(region, 'Milk'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(contains(region, 'Milk')).toBeChecked();
    expect(region.queryByText(/The app has ticked/)).not.toBeInTheDocument();
    // It is the person's now: a tap long after unticks it, and the text does not tick it back.
    finger(contains(region, 'Milk'));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(contains(region, 'Milk')).not.toBeChecked();
  });

  it('⚠️ R2: Space on a focused box holds the proposal like a press: the pause passes, the key-up and click land, then it runs', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    const wheat = contains(region, 'Wheat');
    act(() => { wheat.focus(); });
    fireEvent.keyDown(wheat, { key: ' ' });
    act(() => { vi.advanceTimersByTime(450); });
    expect(contains(region, 'Milk')).not.toBeChecked();
    fireEvent.keyUp(wheat, { key: ' ' });
    fireEvent.click(wheat);
    expect(wheat).toBeChecked();
    expect(contains(region, 'Milk')).not.toBeChecked();
    act(() => { vi.advanceTimersByTime(1); });
    expect(contains(region, 'Milk')).toBeChecked();
    expect(wheat).toBeChecked();
  });

  it('⚠️ R4: a press whose pause ends INSIDE it (finger lifted, no click yet) holds the proposal until the click, then the person\'s tick stands', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(packHead(region));
    await user.click(allergenHead(region));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(packBox(region), { target: { value: 'uova' } });
    const milk = contains(region, 'Milk');
    const eggs = contains(region, 'Eggs');
    fireEvent.pointerDown(milk, { pointerType: 'touch' });
    fireEvent.pointerUp(milk, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(600); });
    expect(eggs).not.toBeChecked();
    fireEvent.mouseDown(milk);
    fireEvent.mouseUp(milk);
    fireEvent.click(milk);
    expect(milk).toBeChecked();
    expect(eggs).not.toBeChecked();
    act(() => { vi.advanceTimersByTime(1); });
    expect(milk).toBeChecked();
    expect(eggs).toBeChecked();
    expect(region.getByText('The app has ticked 1 box from the ingredient list. Open Allergens and check it.')).toBeInTheDocument();
  });
});

describe('Save reads what the screen shows', () => {
  it('⚠️ a Save pressed before the pause ends writes the proposed ticks', async () => {
    const view = await open('/suppliers/ingredient/i-plain');
    const { region, user } = view;
    await user.click(packHead(region));
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    // A click with no press before it: the text box keeps its focus, so only the flush can have run the proposal.
    fireEvent.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save ingredient?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.source.writes.some(write => write.op === 'ingredient-save')).toBe(true); });
    expect(saved(view.source)).toMatchObject({ allergens: ['milk'], packIngredients: 'latte' });
  });

  it('⚠️ on a verified item the same early Save writes the lapsed check, not the old date', async () => {
    const view = await open('/suppliers/ingredient/i-verified');
    const { region, user } = view;
    await user.click(packHead(region));
    fireEvent.change(packBox(region), { target: { value: 'latte' } });
    fireEvent.click(region.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialogOf('Save ingredient?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.source.writes.some(write => write.op === 'ingredient-save')).toBe(true); });
    expect(saved(view.source)).toMatchObject({ allergens: ['milk'], allergensCheckedAt: '' });
  });
});

describe('the allergen boxes are named by what they show', () => {
  it('⚠️ the accessible name contains the visible words: «Milk has», «Milk traces» (WCAG 2.5.3); the long sentence is the tip', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(allergenHead(region));
    const has = contains(region, 'Milk');
    const traces = region.getByRole('checkbox', { name: 'Milk traces' });
    expect(has).not.toHaveAttribute('aria-label');
    expect(has.closest('label')).toHaveAttribute('title', 'Contains Milk');
    expect(traces.closest('label')).toHaveAttribute('title', 'May contain traces of Milk');
  });
});

describe('the nutrition check only looks at what was changed, and only when it is shown', () => {
  const BAD = item('i-bad', { name: 'Odd', ...base, nutrition: { fat: -3 } });
  const withBad = () => fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: [BAD] });

  it('⚠️ a stored figure that would be refused today does not block a save of something else', async () => {
    const view = await open('/suppliers/ingredient/i-bad', withBad());
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in lists' }), 'x');
    await saveAndConfirm(view);
    expect(saved(view.source)).not.toHaveProperty('nutrition');
  });

  it('with the nutrition switched off, a save writes no nutrition key', async () => {
    const view = await open('/suppliers/ingredient/i-bad', withBad(), { session: { location: { showNutrition: false } } });
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in lists' }), 'x');
    await saveAndConfirm(view);
    expect(saved(view.source)).not.toHaveProperty('nutrition');
  });

  it('⚠️ R3: nutrition typed, then hidden by the venue before Save, writes no nutrition key', async () => {
    const view = await open('/suppliers/ingredient/i-declared');
    await view.user.click(nutritionHead(view.region));
    const fat = view.region.getByRole('textbox', { name: 'Fat (g)' });
    await view.user.clear(fat);
    await view.user.type(fat, '3');
    act(() => { view.store.set({ location: { showNutrition: false } }); });
    await waitFor(() => { expect(view.region.queryByRole('button', { name: /^Nutrition/ })).not.toBeInTheDocument(); });
    await view.user.type(view.region.getByRole('textbox', { name: 'Name in lists' }), 'x');
    await saveAndConfirm(view);
    expect(saved(view.source)).not.toHaveProperty('nutrition');
  });

  it('⚠️ «1,550» in the energy box is refused with the thousands sentence, in English', async () => {
    const { region, user, source } = await open('/suppliers/ingredient/i-plain');
    await user.click(nutritionHead(region));
    await user.type(region.getByRole('textbox', { name: 'Energy (kcal)' }), '1,550');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(region.getByText('Write it without the thousands separator — e.g. 1550.')).toBeInTheDocument();
    expect(region.getByRole('textbox', { name: 'Energy (kcal)' })).toHaveAttribute('aria-invalid', 'true');
    expect(source.writes).toEqual([]);
  });

  it('says the thousands sentence in Italian', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain', seeded(), { lang: 'it', session: { language: 'it', location: { country: 'IT' } } });
    await user.click(region.getByRole('button', { name: /^Valori nutrizionali/ }));
    await user.type(region.getByRole('textbox', { name: 'Energia (kJ)' }), '1.550');
    await user.click(region.getByRole('button', { name: 'Salva' }));
    expect(region.getByText('Scrivilo senza il separatore delle migliaia — per esempio 1550.')).toBeInTheDocument();
  });

  it('«0x10» is refused as not a number', async () => {
    const { region, user } = await open('/suppliers/ingredient/i-plain');
    await user.click(nutritionHead(region));
    await user.type(region.getByRole('textbox', { name: 'Fat (g)' }), '0x10');
    await user.click(region.getByRole('button', { name: 'Save' }));
    expect(region.getByText('Write a number, 0 or more — e.g. 12.5.')).toBeInTheDocument();
  });
});
