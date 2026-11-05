import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { isBusy } from '../session/busy';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// Divider lines (PR #458 of the current app, ported): a second MODE of the ingredients, «Dividers», in which a tap on a row
// puts a line under it. The pure part: editorModel.spec.ts and shared/src/catalogue-model.spec.ts. The stylesheets cannot
// be seen here (jsdom), so the line itself is pinned by the data attribute the recipe screen and the editor's rows carry.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const PLAIN = recipe('r1', {
  name: 'Focaccia',
  ingredients: [
    { label: 'Flour', grams: 1000, unit: 'g', rid: 'row-flour' },
    { label: 'Water', grams: 700, unit: 'g', rid: 'row-water' },
    { label: 'Salt', grams: 20, unit: 'g', rid: 'row-salt' },
  ],
});
const DIVIDED = recipe('r2', {
  name: 'Brioche',
  ingredients: [
    { label: 'Flour', grams: 1000, unit: 'g', rid: 'a', dividerAfter: true },
    { label: 'Water', grams: 700, unit: 'g', rid: 'b' },
    { label: 'Salt', grams: 20, unit: 'g', rid: 'c' },
  ],
});

type User = { click: (el: Element) => Promise<void> };

async function openEditor(path = '/recipes/r1/edit', options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes(path, { source: sourceWith([PLAIN, DIVIDED]), ...options });
  const region = await screen.findByRole('region', { name: /^(New recipe|Nuova ricetta|Edit recipe|Modifica ricetta)$/ }, LOAD);
  return { ...view, region };
}

const dividersButton = (region: HTMLElement, name = 'Dividers') => within(region).getByRole('button', { name });
const reorderButton = (region: HTMLElement, name = 'Reorder') => within(region).getByRole('button', { name });
const rowButtons = (region: HTMLElement) => within(region).queryAllByRole('button', { name: /^(Line under|Linea sotto) / });
const rowButton = (region: HTMLElement, name: string) => within(region).getByRole('button', { name: `Line under ${name}` });
const saveButton = (region: HTMLElement) => within(region).getByRole('button', { name: 'Save' });

async function enter(region: HTMLElement, user: User) {
  await user.click(dividersButton(region));
  await waitFor(() => { expect(rowButtons(region)).not.toHaveLength(0); });
}

async function answerSave(user: User) {
  const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

describe('the button', () => {
  it('is absent with one row and present with two', async () => {
    const { region, user } = await openEditor('/recipes/new');
    expect(within(region).queryByRole('button', { name: 'Dividers' })).not.toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    expect(dividersButton(region)).toBeInTheDocument();
    await user.click(within(region).getAllByRole('button', { name: 'Remove ingredient' })[0]!);
    expect(within(region).queryByRole('button', { name: 'Dividers' })).not.toBeInTheDocument();
  });

  it('says whether the mode is on, and reads «Divisioni» then «Fine» in Italian', async () => {
    const { region, user } = await openEditor('/recipes/r1/edit', { lang: 'it' });
    expect(dividersButton(region, 'Divisioni')).toHaveAttribute('aria-pressed', 'false');
    await user.click(dividersButton(region, 'Divisioni'));
    expect(dividersButton(region, 'Fine')).toHaveAttribute('aria-pressed', 'true');
    expect(await within(region).findByText('Tocca un ingrediente per mettere una linea sotto. Tocca di nuovo per toglierla.')).toBeInTheDocument();
    expect(await within(region).findAllByRole('button', { name: /^Linea sotto / })).toHaveLength(2);
  });

  it('the two modes exclude each other: each one’s button is absent while the other is on', async () => {
    const { region, user } = await openEditor();
    await user.click(dividersButton(region));
    expect(dividersButton(region, 'Done')).toHaveAttribute('aria-pressed', 'true');
    expect(within(region).queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument();
    await user.click(dividersButton(region, 'Done'));
    expect(dividersButton(region)).toHaveAttribute('aria-pressed', 'false');
    await user.click(reorderButton(region));
    expect(within(region).queryByRole('button', { name: 'Dividers' })).not.toBeInTheDocument();
    await user.click(reorderButton(region, 'Done'));
    expect(dividersButton(region)).toBeInTheDocument();
  });

  it('turning the mode on and off is not an edit: Back asks nothing', async () => {
    const { region, user, router } = await openEditor();
    await enter(region, user);
    await user.click(dividersButton(region, 'Done'));
    expect(isBusy()).toBe(false);
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the rows in the mode', () => {
  it('are buttons except the last, which has nothing under it; nothing to type in, no «Add ingredient»', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    expect(rowButtons(region).map(button => button.getAttribute('aria-label'))).toEqual(['Line under Flour', 'Line under Water']);
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent('Salt20g');
    expect(within(items[2]!).queryByRole('button')).not.toBeInTheDocument();
    expect(items[0]).toHaveTextContent('Flour1000g');
    expect(within(region).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(region).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: '+ Add ingredient' })).not.toBeInTheDocument();
    expect(within(region).getByText('Total')).toBeInTheDocument();
  });

  it('every row button is described by the hint, and the hint goes with the mode', async () => {
    const { region, user } = await openEditor();
    expect(within(region).queryByText(/Tap an ingredient/)).not.toBeInTheDocument();
    await enter(region, user);
    const hint = within(region).getByText('Tap an ingredient to put a line under it. Tap again to take it away.');
    for (const button of rowButtons(region)) expect(button).toHaveAttribute('aria-describedby', hint.id);
    await user.click(dividersButton(region, 'Done'));
    expect(within(region).queryByText(/Tap an ingredient/)).not.toBeInTheDocument();
    expect(within(region).getByRole('button', { name: '+ Add ingredient' })).toBeInTheDocument();
  });

  it('shows the lines that are there as pressed, and a tap toggles one — it is an edit', async () => {
    const { region, user } = await openEditor('/recipes/r2/edit');
    await enter(region, user);
    expect(rowButton(region, 'Flour')).toHaveAttribute('aria-pressed', 'true');
    expect(rowButton(region, 'Water')).toHaveAttribute('aria-pressed', 'false');
    await user.click(rowButton(region, 'Water'));
    expect(rowButton(region, 'Water')).toHaveAttribute('aria-pressed', 'true');
    expect(isBusy()).toBe(true);
    await user.click(rowButton(region, 'Water'));
    expect(rowButton(region, 'Water')).toHaveAttribute('aria-pressed', 'false');
  });

  it('puts the focus on the first row on entering, keeps it on the tapped row, and returns it to the button on leaving', async () => {
    const { region, user } = await openEditor();
    await user.click(dividersButton(region));
    await waitFor(() => { expect(rowButton(region, 'Flour')).toHaveFocus(); });
    rowButton(region, 'Water').focus();
    await user.keyboard('{Enter}');
    expect(rowButton(region, 'Water')).toHaveAttribute('aria-pressed', 'true');
    expect(rowButton(region, 'Water')).toHaveFocus();
    await user.click(dividersButton(region, 'Done'));
    expect(dividersButton(region)).toHaveFocus();
  });

  it('the ordinary rows draw the line under the rows that have one, after the mode is left', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    await user.click(rowButton(region, 'Flour'));
    await user.click(dividersButton(region, 'Done'));
    const marked = within(region).getAllByRole('listitem').map(item => item.hasAttribute('data-divider-after'));
    expect(marked).toEqual([true, false, false]);
  });
});

describe('Save', () => {
  it('⚠️ writes dividerAfter: true on the tapped row only, and nothing else changes', async () => {
    const { region, user, source } = await openEditor();
    await enter(region, user);
    await user.click(rowButton(region, 'Water'));
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.ingredients).toEqual([
      { label: 'Flour', grams: 1000, unit: 'g', rid: 'row-flour' },
      { label: 'Water', grams: 700, unit: 'g', rid: 'row-water', dividerAfter: true },
      { label: 'Salt', grams: 20, unit: 'g', rid: 'row-salt' },
    ]);
  });

  it('taking a line away writes the row without the key', async () => {
    const { region, user, source } = await openEditor('/recipes/r2/edit');
    await enter(region, user);
    await user.click(rowButton(region, 'Flour'));
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    for (const row of source.recipeWrites[0]?.data?.ingredients as object[]) expect(row).not.toHaveProperty('dividerAfter');
  });

  it('⚠️ with a row to fix, leaves the mode, marks the bad box and puts the cursor in it', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), 'Pane');
    await user.type(within(region).getAllByRole('combobox', { name: 'Ingredient name' })[0]!, 'Flour');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    await user.type(within(region).getAllByRole('combobox', { name: 'Ingredient name' })[1]!, 'Water');
    await enter(region, user);
    await user.click(saveButton(region));
    const boxes = await within(region).findAllByRole('spinbutton', { name: 'Amount' });
    expect(dividersButton(region)).toHaveAttribute('aria-pressed', 'false');
    expect(rowButtons(region)).toHaveLength(0);
    await waitFor(() => { expect(boxes[0]).toHaveFocus(); });
    expect(boxes[0]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the recipe screen', () => {
  it('marks the row under which a line sits, and never the last row', async () => {
    renderRecipes('/recipes/r2', { source: sourceWith([PLAIN, DIVIDED]) });
    const table = await screen.findByRole('table', { name: /^(Ingredients|Ingredienti)$/ }, LOAD);
    const body = within(table).getAllByRole('row').filter(row => within(row).queryAllByRole('rowheader').length > 0);
    const marked = body.map(row => row.hasAttribute('data-divider-after'));
    // Three ingredients and the Total row: only the first carries a line.
    expect(marked).toEqual([true, false, false, false]);
  });

  it('draws no line for a recipe without any, and not under the last row even if it carries the flag', async () => {
    const stray = recipe('r3', {
      name: 'Stray',
      ingredients: [
        { label: 'Flour', grams: 1000, unit: 'g' },
        { label: 'Salt', grams: 20, unit: 'g', dividerAfter: true },
      ],
    });
    renderRecipes('/recipes/r3', { source: sourceWith([stray]) });
    const table = await screen.findByRole('table', { name: /^(Ingredients|Ingredienti)$/ }, LOAD);
    expect(table.querySelectorAll('[data-divider-after]')).toHaveLength(0);
  });
});

describe('the words', () => {
  it('exist in English and Italian, the line’s name with a hole for the ingredient', () => {
    for (const key of ['cat.dividers', 'cat.dividersHint', 'cat.dividerUnder'] as const) {
      expect(en[key], key).not.toBe('');
      expect(italian[key], key).not.toBe('');
    }
    expect(en['cat.dividerUnder']).toContain('{name}');
    expect(italian['cat.dividerUnder']).toContain('{name}');
  });
});
