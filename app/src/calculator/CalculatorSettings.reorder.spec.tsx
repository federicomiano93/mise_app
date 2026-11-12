import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { FOCACCIA, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// Item 36 of docs/mise2-port-owed.md (current app 71627519, 262efcfe, 33a22947): reordering a recipe's ingredients in
// Settings → Recipes → one recipe — a MODE («Reorder» / «Done») in which each row is a grip, its name and its grams, reusing
// the recipe book's ReorderRows. The pure moves: recipesModel.reorder.spec.ts and shared/src/calculator-reorder.spec.ts.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const LIST = '/calculator/settings/recipes';

async function open(path: string, { config = configOf(), lang = 'en' as 'en' | 'it', source = fakeCalculatorSource({ config }) } = {}) {
  const view = renderCalculator(path, { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  await waitFor(() => { expect(main().queryByText(/^(Loading…|Caricamento…)$/)).toBeNull(); }, LOAD);
  return { ...view, source };
}

const grips = () => main().queryAllByRole('button', { name: /^(Move|Sposta) «/ });
const names = () => grips().map(grip => /«(.*)»/.exec(grip.getAttribute('aria-label') ?? '')?.[1]);
const gripOf = (name: string) => main().getByRole('button', { name: `Move «${name}»` });
const reorderButton = (name = 'Reorder') => main().getByRole('button', { name });
const ingredientNames = () => main().queryAllByRole('combobox', { name: /^Ingredient \d+$/ }).map(box => (box as HTMLInputElement).value);
const later = (ms = 150) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });

async function enter(user: Awaited<ReturnType<typeof open>>['user']) {
  await user.click(reorderButton());
  await waitFor(() => { expect(grips()).not.toHaveLength(0); });
}

describe('the button', () => {
  it('sits beside the Ingredients heading of a recipe with its own rows, and says whether the mode is on', async () => {
    await open(`${LIST}/focaccia`);
    expect(reorderButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('is absent with one row, present with two', async () => {
    const one = { ...FOCACCIA, ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }], leaveningKey: null };
    const { user } = await open(`${LIST}/focaccia`, { config: configOf({ recipes: [one] }) });
    expect(main().queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument();
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    expect(reorderButton()).toBeInTheDocument();
  });

  it('is absent on a recipe linked to the recipe book (its rows are read-only there)', async () => {
    const linked = { ...FOCACCIA, catalogueId: 'cat-1', ingredients: [] };
    await open(`${LIST}/focaccia`, {
      source: fakeCalculatorSource({
        config: configOf({ recipes: [linked] }),
        recipes: [{ id: 'cat-1', name: 'Focaccia book', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g', rid: 'a' }, { label: 'Water', grams: 700, unit: 'g', rid: 'b' }] }],
      }),
    });
    await main().findAllByText('Flour', undefined, LOAD);
    expect(main().queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument();
  });

  it('reads «Riordina» then «Fine» in Italian, with the hint and the grips in Italian', async () => {
    const { user } = await open(`${LIST}/focaccia`, { lang: 'it' });
    await user.click(main().getByRole('button', { name: 'Riordina' }));
    expect(main().getByRole('button', { name: 'Fine' })).toHaveAttribute('aria-pressed', 'true');
    expect(await main().findByText('Tieni premuto un ingrediente e trascinalo al suo posto. Con la tastiera usa le frecce su e giù.')).toBeInTheDocument();
    expect(await main().findAllByRole('button', { name: /^Sposta «/ })).toHaveLength(4);
  });
});

describe('the rows in the mode', () => {
  it('are a grip, a name and the grams, with nothing to type in and no «Add ingredient»', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await enter(user);
    expect(names()).toEqual(['Flour', 'Water', 'Salt', 'Yeast']);
    expect(main().queryAllByRole('combobox', { name: /^Ingredient \d+$/ })).toHaveLength(0);
    expect(main().queryAllByRole('spinbutton', { name: /weight in grams$/ })).toHaveLength(0);
    expect(main().queryByRole('button', { name: '+ Add ingredient' })).not.toBeInTheDocument();
    const rows = main().getAllByRole('row');
    expect(rows[0]).toHaveTextContent('Flour1000g');
    expect(rows[3]).toHaveTextContent('Yeast5g');
  });

  it('tells how to move a row, and the LIST is described by it', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    expect(main().queryByText(/Hold an ingredient/)).not.toBeInTheDocument();
    await enter(user);
    const hint = main().getByText('Hold an ingredient and drag it to its place. With a keyboard, use the up and down arrows.');
    expect(main().getByRole('grid')).toHaveAttribute('aria-describedby', hint.id);
    await user.click(reorderButton('Done'));
    expect(main().queryByText(/Hold an ingredient/)).not.toBeInTheDocument();
    expect(ingredientNames()).toEqual(['Flour', 'Water', 'Salt', 'Yeast']);
  });

  it('says «(no name)»-style placeholder for a row with no name', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    await user.click(reorderButton());
    await waitFor(() => { expect(grips()).toHaveLength(5); });
    expect(names()[4]).toBe('(no name)');
  });
});

describe('the focus', () => {
  it('goes to the first grip on entering and to the button on leaving', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await enter(user);
    await waitFor(() => { expect(gripOf('Flour')).toHaveFocus(); });
    await user.click(reorderButton('Done'));
    expect(reorderButton()).toHaveFocus();
  });

  it('is on the button after leaving with the keyboard', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    reorderButton().focus();
    await user.keyboard('{Enter}');
    await waitFor(() => { expect(gripOf('Flour')).toHaveFocus(); });
    reorderButton('Done').focus();
    await user.keyboard('{Enter}');
    expect(reorderButton()).toHaveFocus();
  });
});

describe('the arrow keys on a grip', () => {
  it('move the row one place and keep the focus on its grip', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await enter(user);
    gripOf('Flour').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => { expect(names()).toEqual(['Water', 'Flour', 'Salt', 'Yeast']); });
    await waitFor(() => { expect(gripOf('Flour')).toHaveFocus(); });
    await later();
    expect(names()).toEqual(['Water', 'Flour', 'Salt', 'Yeast']);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(() => { expect(names()).toEqual(['Water', 'Salt', 'Yeast', 'Flour']); });
    await waitFor(() => { expect(gripOf('Flour')).toHaveFocus(); });
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    await waitFor(() => { expect(names()).toEqual(['Flour', 'Water', 'Salt', 'Yeast']); });
    await waitFor(() => { expect(gripOf('Flour')).toHaveFocus(); });
  });

  it('do nothing at the ends, and are no edit there', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await enter(user);
    gripOf('Flour').focus();
    await user.keyboard('{ArrowUp}');
    gripOf('Yeast').focus();
    await user.keyboard('{ArrowDown}');
    expect(names()).toEqual(['Flour', 'Water', 'Salt', 'Yeast']);
    expect(gripOf('Yeast')).toHaveFocus();
    expect(isBusy()).toBe(false);
    expect(saveButton()).toBeDisabled();
  });

  it('⚠️ leave the keyboard drag working (Enter, the arrows, Enter)', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await enter(user);
    gripOf('Flour').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => { expect(names()).toEqual(['Water', 'Flour', 'Salt', 'Yeast']); });
    await waitFor(() => { expect(gripOf('Flour')).toHaveFocus(); });
    await user.keyboard('{Enter}');
    expect((await screen.findAllByRole('button', { name: /^Insert (before|after) /, hidden: true }, LOAD)).length).toBeGreaterThan(0);
    // Two arrows walk the drop places from Flour's own to the one after Yeast: Flour goes last, once.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => { expect(names()).toEqual(['Water', 'Salt', 'Yeast', 'Flour']); });
    await waitFor(() => { expect(gripOf('Flour')).toHaveFocus(); });
    await later();
    expect(names()).toEqual(['Water', 'Salt', 'Yeast', 'Flour']);
  });
});

describe('what a move changes', () => {
  it('is an edit (Save wakes, the unsaved-changes guard is on) and only the ORDER', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    await enter(user);
    expect(saveButton()).toBeDisabled();
    gripOf('Yeast').focus();
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    await waitFor(() => { expect(names()).toEqual(['Yeast', 'Flour', 'Water', 'Salt']); });
    expect(saveButton()).toBeEnabled();
    expect(isBusy()).toBe(true);
    await user.click(reorderButton('Done'));
    expect(ingredientNames()).toEqual(['Yeast', 'Flour', 'Water', 'Salt']);
    // ⚠️ The grams went with their rows, and the leavening is still the yeast.
    expect((main().getByRole('spinbutton', { name: 'Ingredient 1, weight in grams' }) as HTMLInputElement).value).toBe('5');
    expect(main().getByRole('combobox', { name: 'Leavening' })).toHaveDisplayValue('Yeast');

    await user.click(saveButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save these changes?' }, LOAD)).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = (source.savedConfigs[0]?.recipes as { id: string; ingredients: { key: string; grams: number }[]; leaveningKey: string }[]).find(r => r.id === 'focaccia')!;
    expect(saved.ingredients.map(row => row.key)).toEqual(['yeast', 'flour', 'water', 'salt']);
    expect(saved.ingredients.map(row => row.grams)).toEqual([5, 1000, 700, 20]);
    expect(saved.leaveningKey).toBe('yeast');
  });

  it('⚠️ a NEW row named like the leavening, moved above it, does not take the leavening on Save', async () => {
    const { user, source } = await open(`${LIST}/focaccia`);
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    await user.type(main().getByRole('combobox', { name: 'Ingredient 5' }), 'Yeast');
    await enter(user);
    // The new «Yeast» is last; walk it to the top, above the saved Yeast.
    const lastGrip = grips()[4]!;
    lastGrip.focus();
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}');
    await waitFor(() => { expect(grips().indexOf(document.activeElement as HTMLElement)).toBe(0); });
    await user.click(reorderButton('Done'));
    await user.click(saveButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save these changes?' }, LOAD)).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    const saved = (source.savedConfigs[0]?.recipes as { id: string; ingredients: { key: string; grams: number }[]; leaveningKey: string }[]).find(r => r.id === 'focaccia')!;
    const leavening = saved.ingredients.find(row => row.key === saved.leaveningKey);
    expect(leavening?.grams).toBe(5);
    expect(new Set(saved.ingredients.map(row => row.key)).size).toBe(5);
  });

  it('Back out of the recipe with a move made keeps the working copy, as any edit does', async () => {
    const { user, router } = await open(`${LIST}/focaccia`);
    await enter(user);
    gripOf('Water').focus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() => { expect(names()).toEqual(['Water', 'Flour', 'Salt', 'Yeast']); });
    await user.click(reorderButton('Done'));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(LIST); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });
});

describe('Save refusing a blank name', () => {
  it('leaves the mode, so the blank box is there to be marked', async () => {
    const { user } = await open(`${LIST}/focaccia`);
    await user.click(main().getByRole('button', { name: '+ Add ingredient' }));
    await user.click(reorderButton());
    await waitFor(() => { expect(grips()).toHaveLength(5); });
    await user.click(saveButton());
    const alert = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(alert).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(main().getByRole('combobox', { name: 'Ingredient 5' })).toHaveAttribute('aria-invalid', 'true'); });
    expect(main().queryAllByRole('button', { name: /^Move «/ })).toHaveLength(0);
  });
});
