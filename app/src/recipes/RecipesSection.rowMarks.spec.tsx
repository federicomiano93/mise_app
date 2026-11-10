import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// Two small marks on a recipe row's LINK LINE in the editor, ported from the current app (docs/mise2-port-owed.md, items 30 and 31):
//   • the crossed-out euro on a row Food cost cannot price (ff1a2d38, 28 Oct 2026) — prices read once, only for somebody who may
//     read Food cost, never kept, no money on screen;
//   • the amber note on a linked row whose typed name no longer matches its link (a84fa1ab, 94e0514e, 7 Nov 2026) — a warning, never
//     an automatic unlink, announced once when it turns on, cleared by typing the old name back or choosing the same link again.
// The rules themselves (which rows, which names) are tested in shared/ against both files; this is the screen.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

type Session = NonNullable<NonNullable<Parameters<typeof renderRecipes>[1]>['session']>;

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false, location: {} };
const FLOUR = { id: 'ing-flour', name: 'Farina 00 Caputo', shortName: 'Caputo' };
const SALT = { id: 'ing-salt', name: 'Sale fino' };
const BUTTER = { id: 'ing-butter', name: 'Unsalted Butter 250g', invoiceName: 'BURRO 82% 1KG' };
const PRICES = { 'ing-flour': { priceUnit: 'kg', pricePerUnit: 2 } };

const MIXED = recipe('r1', {
  name: 'Focaccia',
  ingredients: [
    { label: 'Caputo', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-flour' },   // priced
    { label: 'Salt', grams: 20, unit: 'g', kind: 'ingredient', refId: 'ing-salt' },        // no price
    { label: 'Water', grams: 700, unit: 'g' },                                             // not linked
    { label: 'Yeast', grams: '', unit: 'g' },                                              // no amount yet
    { label: 'Pinch', grams: '', unit: 'to taste', kind: 'ingredient', refId: 'ing-salt' }, // not weighed
  ],
});

async function openEditor(
  seed: Parameters<typeof fakeRecipesSource>[0],
  { lang = 'en', session }: { lang?: 'en' | 'it'; session?: Session } = {},
) {
  const source = fakeRecipesSource(seed);
  const view = renderRecipes('/recipes/r1/edit', { source, lang, ...(session ? { session } : {}) });
  const region = await screen.findByRole('region', { name: lang === 'it' ? 'Modifica ricetta' : 'Edit recipe' }, LOAD);
  return { ...view, region };
}

// Every row's link line, in order: the button each IngredientRow draws under its boxes.
const linkLines = (region: HTMLElement) => [...region.querySelectorAll<HTMLElement>('li button[data-linked]')];
const marksOf = (line: HTMLElement, name = 'no price') => within(line).queryAllByRole('img', { name });
const nameBoxes = (region: HTMLElement) => within(region).getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
const announcer = (region: HTMLElement) => region.querySelector('[aria-live="polite"]') as HTMLElement;

describe('the crossed-out euro on a row Food cost cannot price', () => {
  it('marks exactly the rows that cannot be priced: unlinked or unpriced ones, not a priced one, a line still being typed, or a «to taste»', async () => {
    const { region, source } = await openEditor({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES });
    await waitFor(() => { expect(marksOf(linkLines(region)[1]!)).toHaveLength(1); });
    const lines = linkLines(region);
    expect(lines).toHaveLength(5);
    expect(lines.map(line => marksOf(line).length)).toEqual([0, 1, 1, 0, 0]);
    expect(source.priceReads).toBe(1);
  });

  it('is a small image with a name, inside the link button, and its svg is hidden from a screen reader', async () => {
    const { region } = await openEditor({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES });
    await waitFor(() => { expect(marksOf(linkLines(region)[1]!)).toHaveLength(1); });
    const line = linkLines(region)[1]!;
    expect(line).toHaveAccessibleName('→ Sale fino no price');
    const mark = marksOf(line)[0]!;
    expect(mark.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(line.textContent?.trim()).toBe('→ Sale fino');
  });

  it('is named in Italian on an Italian screen', async () => {
    const { region } = await openEditor({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES }, { lang: 'it' });
    await waitFor(() => { expect(marksOf(linkLines(region)[1]!, 'senza prezzo')).toHaveLength(1); });
    expect(marksOf(linkLines(region)[1]!)).toHaveLength(0);
  });

  it('follows what is typed: a unit that is not weighed takes the mark off, a weighed one puts it back', async () => {
    const { region, user } = await openEditor({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES });
    await waitFor(() => { expect(marksOf(linkLines(region)[1]!)).toHaveLength(1); });
    const unit = within(region).getAllByRole('combobox', { name: 'Unit' })[1]!;
    await user.selectOptions(unit, 'to taste');
    expect(marksOf(linkLines(region)[1]!)).toHaveLength(0);
    await user.selectOptions(unit, 'g');
    expect(marksOf(linkLines(region)[1]!)).toHaveLength(1);
  });

  it('⚠️ asks for nothing and shows nothing to somebody who may not read Food cost', async () => {
    const { region, source } = await openEditor({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES }, { session: EMPLOYEE });
    expect(linkLines(region)).toHaveLength(5);
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(source.priceReads).toBe(0);
    expect(within(region).queryAllByRole('img', { name: 'no price' })).toHaveLength(0);
  });

  it('⚠️ asks for nothing in a venue that does not use Food cost', async () => {
    const { region, source } = await openEditor(
      { recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES },
      { session: { location: { sections: { foodcost: false } } } },
    );
    expect(linkLines(region)).toHaveLength(5);
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(source.priceReads).toBe(0);
    expect(within(region).queryAllByRole('img', { name: 'no price' })).toHaveLength(0);
  });

  it('asks an employee that the venue shows Food cost to', async () => {
    const { region, source } = await openEditor(
      { recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES },
      { session: { ...EMPLOYEE, location: { staffShownCards: { foodcost: true } } } },
    );
    await waitFor(() => { expect(marksOf(linkLines(region)[1]!)).toHaveLength(1); });
    expect(source.priceReads).toBe(1);
  });

  it('a refused read draws no mark and no error: the editor works as before', async () => {
    const source = fakeRecipesSource({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES });
    source.refusePrices = true;
    renderRecipes('/recipes/r1/edit', { source });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await waitFor(() => { expect(source.priceReads).toBe(1); });
    expect(within(region).queryAllByRole('img', { name: 'no price' })).toHaveLength(0);
    expect(within(region).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('an owner on a venue with zero price documents (`prices: {}`) sees every costable linked row crossed out, as the current app', async () => {
    const { region, source } = await openEditor({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: {} });
    await waitFor(() => { expect(marksOf(linkLines(region)[0]!)).toHaveLength(1); });
    expect(linkLines(region).map(line => marksOf(line).length)).toEqual([1, 1, 1, 0, 0]);
    expect(source.priceReads).toBe(1);
  });

  it('⚠️ shows no money: the editor draws no amount the prices stand for', async () => {
    const { region } = await openEditor({ recipes: [MIXED], ingredients: [FLOUR, SALT], prices: PRICES });
    await waitFor(() => { expect(marksOf(linkLines(region)[1]!)).toHaveLength(1); });
    expect(region.textContent).not.toMatch(/[€£$]|2[.,]00/);
  });
});

describe('the amber note on a linked row whose name was retyped', () => {
  const LINKED = recipe('r1', {
    name: 'Focaccia',
    ingredients: [
      { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-flour' },
      { label: 'Burro', grams: 200, unit: 'g', kind: 'ingredient', refId: 'ing-butter' },
      { label: 'Water', grams: 700, unit: 'g' },
    ],
  });
  const STALE = (name: string) => `The name changed, but this row is still linked to “${name}” — tap to change`;
  // Every linked ingredient has a price, so the only mark left is the unlinked «Water» row's: these cases are about the note.
  const seed = () => ({
    recipes: [LINKED], ingredients: [FLOUR, BUTTER, SALT],
    prices: { 'ing-flour': PRICES['ing-flour'], 'ing-butter': PRICES['ing-flour'], 'ing-salt': PRICES['ing-flour'] },
  });

  it('says nothing on opening, even when the saved name never resembled the link («Flour» on «Caputo»)', async () => {
    const { region } = await openEditor(seed());
    expect(linkLines(region)[0]).toHaveAccessibleName('→ Caputo');
    expect(linkLines(region)[0]).not.toHaveAttribute('data-stale');
    expect(announcer(region)).toBeEmptyDOMElement();
  });

  it('warns, live and in place, when the name moves to something else — the link line turns amber and names the link', async () => {
    const { region, user } = await openEditor(seed());
    await user.clear(nameBoxes(region)[0]!);
    await user.type(nameBoxes(region)[0]!, 'Margarine');
    const line = linkLines(region)[0]!;
    expect(line).toHaveAccessibleName(STALE('Caputo'));
    expect(line).toHaveAttribute('data-stale', 'true');
    // Nothing is unlinked on its own.
    expect(nameBoxes(region)[0]).toHaveValue('Margarine');
  });

  it('is in Italian on an Italian screen, with the name between the guillemets', async () => {
    const { region, user } = await openEditor(seed(), { lang: 'it' });
    const box = within(region).getAllByRole('combobox', { name: 'Nome dell’ingrediente' })[0]!;
    await user.clear(box);
    await user.type(box, 'Margarina');
    expect(within(region).getByRole('button', { name: 'Il nome è cambiato, ma questa riga è ancora collegata a «Caputo» — tocca per cambiare' })).toBeInTheDocument();
  });

  it('⚠️ compares WHOLE words: «Salt» is not found inside «Unsalted Butter», and a correction of the opened name does not warn', async () => {
    const { region, user } = await openEditor(seed());
    const box = nameBoxes(region)[1]!;
    await user.clear(box);
    await user.type(box, 'Salt');
    expect(linkLines(region)[1]).toHaveAccessibleName(STALE('Unsalted Butter 250g'));
    // «Burro» -> «Burro 82%» is the same thing, more precisely: it never warns.
    await user.clear(box);
    await user.type(box, 'Burro 82%');
    expect(linkLines(region)[1]).toHaveAccessibleName('→ Unsalted Butter 250g');
    expect(linkLines(region)[1]).not.toHaveAttribute('data-stale');
  });

  it('clears when the opened name is typed back, or the new name resembles the link', async () => {
    const { region, user } = await openEditor(seed());
    const box = nameBoxes(region)[0]!;
    await user.clear(box);
    await user.type(box, 'Margarine');
    expect(linkLines(region)[0]).toHaveAttribute('data-stale', 'true');
    await user.clear(box);
    await user.type(box, 'Flour');
    expect(linkLines(region)[0]).not.toHaveAttribute('data-stale');
    await user.clear(box);
    await user.type(box, 'Margarine');
    await user.clear(box);
    await user.type(box, 'caputo');
    expect(linkLines(region)[0]).not.toHaveAttribute('data-stale');
  });

  it('never warns on a row with no link, and not on an emptied name', async () => {
    const { region, user } = await openEditor(seed());
    const water = nameBoxes(region)[2]!;
    await user.clear(water);
    await user.type(water, 'Milk');
    expect(linkLines(region)[2]).toHaveAccessibleName('+ Link to an ingredient no price');
    await user.clear(nameBoxes(region)[0]!);
    expect(linkLines(region)[0]).not.toHaveAttribute('data-stale');
  });

  it('⚠️ choosing the SAME link again says «yes, this one»: the name stays and the warning clears', async () => {
    const { region, user } = await openEditor(seed());
    const box = nameBoxes(region)[0]!;
    await user.clear(box);
    await user.type(box, 'Margarine');
    await user.click(linkLines(region)[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    await user.click(within(dialog).getByRole('button', { name: /^Caputo/ }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(nameBoxes(region)[0]).toHaveValue('Margarine');
    expect(linkLines(region)[0]).toHaveAccessibleName('→ Caputo');
    expect(linkLines(region)[0]).not.toHaveAttribute('data-stale');
    // …and the baseline moved: another retyping to something else warns again from there.
    await user.clear(nameBoxes(region)[0]!);
    await user.type(nameBoxes(region)[0]!, 'Oil');
    expect(linkLines(region)[0]).toHaveAttribute('data-stale', 'true');
  });

  it('choosing ANOTHER link renames the row after it and starts the comparison again from that name', async () => {
    const { region, user } = await openEditor(seed());
    await user.click(linkLines(region)[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    await user.click(within(dialog).getByRole('button', { name: /^Sale fino/ }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(nameBoxes(region)[0]).toHaveValue('Sale fino');
    expect(linkLines(region)[0]).not.toHaveAttribute('data-stale');
  });

  it('⚠️ is announced ONCE when a row turns stale (one polite live region), not on every keystroke, and emptied when it clears', async () => {
    const { region, user } = await openEditor(seed());
    const live = announcer(region);
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('role', 'status');
    const box = nameBoxes(region)[0]!;
    await user.clear(box);
    await user.type(box, 'Marg');
    expect(live).toHaveTextContent(STALE('Caputo'));
    // Typing on does not touch the region again.
    const records: string[] = [];
    const watcher = new MutationObserver(list => { for (const item of list) records.push(item.type); });
    watcher.observe(live, { childList: true, characterData: true, subtree: true });
    await user.type(box, 'arine');
    watcher.disconnect();
    expect(records).toEqual([]);
    await user.clear(box);
    await user.type(box, 'Flour');
    expect(live).toBeEmptyDOMElement();
  });

  it('⚠️ the warning is not in the saved recipe: Save writes the rows exactly as typed, with their links', async () => {
    const { region, user, source } = await openEditor(seed());
    const box = nameBoxes(region)[0]!;
    await user.clear(box);
    await user.type(box, 'Margarine');
    await user.click(within(region).getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    const saved = source.recipeWrites[0]?.data?.ingredients as Array<Record<string, unknown>>;
    expect(saved[0]).toEqual({ label: 'Margarine', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-flour', rid: expect.any(String) });
    expect(JSON.stringify(saved)).not.toMatch(/stale|opened/i);
  });

  it('the crossed-out euro survives the warning: both ride in the same link line', async () => {
    const { region, user } = await openEditor({ ...seed(), prices: {} });
    await waitFor(() => { expect(marksOf(linkLines(region)[0]!)).toHaveLength(1); });
    await user.clear(nameBoxes(region)[0]!);
    await user.type(nameBoxes(region)[0]!, 'Margarine');
    expect(linkLines(region)[0]).toHaveAccessibleName(`${STALE('Caputo')} no price`);
  });
});
