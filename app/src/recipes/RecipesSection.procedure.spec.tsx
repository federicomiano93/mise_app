import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// Step 3d-8, slice A: the Procedure card on the recipe screen — its two states, its warning, its place on the page and the
// way into the steps editor. The editor itself: RecipesSection.steps.spec.tsx.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ROWS = [
  { label: 'Flour', grams: 1000, unit: 'g', rid: 'rf' },
  { label: 'Water', grams: 700, unit: 'g', rid: 'rw' },
  { label: 'Salt', grams: 20, unit: 'g', rid: 'rs' },
];
const PLAIN = recipe('plain', { name: 'Plain' });
const TIMED = recipe('timed', {
  name: 'Timed',
  ingredients: ROWS,
  steps: [
    { text: 'Mix', rows: ['rf', 'rw'], seconds: 90, speed: '1' },
    { text: 'Rest', rows: ['rs'], seconds: 210, speed: '' },
  ],
});
const UNTIMED = recipe('untimed', {
  name: 'Untimed',
  ingredients: ROWS,
  steps: [{ text: 'Mix everything', rows: ['rf', 'rw', 'rs'], seconds: 0, speed: '' }],
});
const MISSING = recipe('missing', {
  name: 'Missing',
  ingredients: ROWS,
  steps: [{ text: 'Mix', rows: ['rf'], seconds: 0, speed: '' }],
});

const main = () => within(screen.getByRole('main'));
const card = () => main().getByRole('heading', { level: 3, name: 'Procedure' }).closest('section')!;

async function open(id: string, options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes(`/recipes/${id}`, { source: sourceWith([PLAIN, TIMED, UNTIMED, MISSING]), ...options });
  await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
  return view;
}

describe('a recipe with no steps', () => {
  it('offers to write them, quietly, with a line that says what they are for', async () => {
    await open('plain');
    expect(within(card()).getByRole('button', { name: 'Write the mixing steps' })).toBeInTheDocument();
    expect(within(card()).getByText('A step at a time, with the amounts from this recipe, a timer and the mixer speed.')).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Edit the steps' })).not.toBeInTheDocument();
  });

  it('treats steps that say nothing as no steps', async () => {
    const empty = recipe('empty', { name: 'Empty', steps: [{ text: '', rows: [], seconds: 0, speed: '' }, 'junk', null] });
    renderRecipes('/recipes/empty', { source: sourceWith([empty]) });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(within(card()).getByRole('button', { name: 'Write the mixing steps' })).toBeInTheDocument();
  });
});

describe('a recipe with steps', () => {
  it('says how many there are and what the timers add up to', async () => {
    await open('timed');
    expect(within(card()).getByText('2 steps · 05:00 of timers')).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Edit the steps' })).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Write the mixing steps' })).not.toBeInTheDocument();
    expect(within(card()).queryByText(/A step at a time/)).not.toBeInTheDocument();
  });

  it('leaves the timers out when there are none, and says «1 step» in the singular', async () => {
    await open('untimed');
    expect(within(card()).getByText('1 step')).toBeInTheDocument();
    expect(within(card()).queryByText(/of timers/)).not.toBeInTheDocument();
  });

  it('⚠️ warns about the rows no step adds, by name', async () => {
    await open('missing');
    expect(within(card()).getByText('Not in any step: Water, Salt')).toBeInTheDocument();
  });

  it('has no warning when every named row is in a step', async () => {
    await open('timed');
    expect(within(card()).queryByText(/Not in any step/)).not.toBeInTheDocument();
  });
});

describe('where the card stands', () => {
  it('⚠️ is after the allergens and before Export', async () => {
    await open('timed');
    const allergens = main().getByRole('heading', { level: 3, name: /^Allergens/ });
    const procedure = main().getByRole('heading', { level: 3, name: 'Procedure' });
    const exportButton = main().getByRole('button', { name: 'Export' });
    const followed = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(followed(allergens, procedure)).toBe(true);
    expect(followed(procedure, exportButton)).toBe(true);
    expect(followed(procedure, main().getByRole('button', { name: 'Import into Calculator' }))).toBe(true);
  });
});

describe('the way into the editor', () => {
  it.each([
    ['Write the mixing steps', 'plain'],
    ['Edit the steps', 'timed'],
  ])('«%s» opens the steps one level below the recipe', async (name, id) => {
    const { router, user } = await open(id);
    await user.click(within(card()).getByRole('button', { name }));
    expect(router.state.location.pathname).toBe(`/recipes/${id}/steps`);
    expect(router.state.historyAction).toBe('PUSH');
    expect(await screen.findByRole('region', { name: 'Mixing steps' })).toBeInTheDocument();
  });

  it('is there for an employee as well: anyone who sees the section may write steps', async () => {
    await open('plain', { session: { role: 'staff', canManage: false, isOwner: false } });
    expect(within(card()).getByRole('button', { name: 'Write the mixing steps' })).toBeInTheDocument();
  });

  it('redraws in place when the recipe changes on another phone', async () => {
    const source = sourceWith([PLAIN]);
    renderRecipes('/recipes/plain', { source });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(within(card()).getByRole('button', { name: 'Write the mixing steps' })).toBeInTheDocument();
    source.recipes.set('plain', recipe('plain', { name: 'Plain', ingredients: ROWS, steps: [{ text: 'Mix', rows: ['rf'], seconds: 60, speed: '' }] }));
    act(() => { source.push(); });
    await waitFor(() => { expect(within(card()).getByText('1 step · 01:00 of timers')).toBeInTheDocument(); });
  });
});

describe('in Italian', () => {
  it('says the current app’s Italian words', async () => {
    renderRecipes('/recipes/timed', { source: sourceWith([TIMED, PLAIN, MISSING]), lang: 'it', session: { language: 'it' } });
    await screen.findByRole('heading', { level: 3, name: 'Ingredienti' }, LOAD);
    const italian = within(main().getByRole('heading', { level: 3, name: 'Procedimento' }).closest('section')!);
    expect(italian.getByText('2 passaggi · 05:00 di timer')).toBeInTheDocument();
    expect(italian.getByRole('button', { name: 'Modifica i passaggi' })).toBeInTheDocument();
  });

  it('says the writing words and the warning in Italian', async () => {
    renderRecipes('/recipes/plain', { source: sourceWith([PLAIN]), lang: 'it', session: { language: 'it' } });
    await screen.findByRole('heading', { level: 3, name: 'Ingredienti' }, LOAD);
    expect(main().getByRole('button', { name: 'Scrivi i passaggi dell’impasto' })).toBeInTheDocument();
    expect(main().getByText('Un passaggio alla volta, con le quantità di questa ricetta, un timer e la velocità dell’impastatrice.')).toBeInTheDocument();
  });

  it('says «In nessun passaggio» for the unassigned rows', async () => {
    renderRecipes('/recipes/missing', { source: sourceWith([MISSING]), lang: 'it', session: { language: 'it' } });
    await screen.findByRole('heading', { level: 3, name: 'Ingredienti' }, LOAD);
    expect(main().getByText('In nessun passaggio: Water, Salt')).toBeInTheDocument();
  });
});
