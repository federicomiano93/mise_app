import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { BOX, PACKAGING_PRICES } from '../testing/foodcostEditorFixtures';
import { REFERENCE, SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD } from '../testing/renderFoodcost';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';

// The guided steps of a cake: Base, Soak, Filling, Coating, Decoration, then «Cost and price». One open at a time; an open step shows
// only its title and a search box over the venue's semi-finished cards, and the cards chosen with their grams. UI state only: it is never
// saved. The logic is in cakeStepsModel.spec.ts; the start dialog is in CakesSection.start.spec.tsx.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

const CREAM = { ...SPONGE, id: 'CREAM', name: 'Cream' };
const CRUMBLE = { ...SPONGE, id: 'CRUMBLE', name: 'Cocoa crumble' };
const MOUSSE = { ...SPONGE, id: 'MOUSSE', name: 'Chocolate mousse' };
const foodcost = () => fakeFoodcostSource({
  products: [SPONGE, CREAM, CRUMBLE, MOUSSE],
  ingredients: [FLOUR, BOX],
  prices: { ...FLOUR_PRICES, ...PACKAGING_PRICES },
});

const openNew = async (options: Omit<NonNullable<Parameters<typeof renderCakes>[1]>, 'cakes' | 'foodcost'> = {}) => {
  const view = renderCakes('/cakes/new', { cakes: fakeCakesSource({ cakes: [], reference: storedReference() }), foodcost: foodcost(), ...options });
  await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
  return view;
};
const openSaved = async () => {
  const cake = cakeDoc('c1', 'Plain', {
    diameterCm: 22, discs: 3, ref: REFERENCE,
    lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }, { tier: 0, part: 'soak', productId: 'CREAM', grams: 70 }],
  });
  const view = renderCakes('/cakes/c1', { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: foodcost() });
  await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
  return view;
};

const PARTS = ['Base', 'Soak', 'Filling', 'Coating', 'Decoration'];
const step = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const expanded = (title: string) => step(title).getAttribute('aria-expanded');

describe('a new cake', () => {
  it('opens on the first step: its title and its search box, and nothing else of the step', async () => {
    await openNew();
    expect(expanded('Base')).toBe('true');
    for (const title of [...PARTS.slice(1), 'Cost and price']) expect(expanded(title)).toBe('false');
    const panel = within(screen.getByRole('group', { name: /^Base/ }));
    expect(panel.getByRole('combobox', { name: 'Search a recipe for Base' })).toBeInTheDocument();
    expect(panel.queryByRole('textbox', { name: /grams/ })).not.toBeInTheDocument();
  });

  it('lists the five steps in the order a cake is built, then the «Cost and price» card, with no «then» line between', async () => {
    await openNew();
    const expected = [...PARTS, 'Cost and price'];
    const steps = screen.getAllByRole('button', { name: /^(Base|Soak|Filling|Coating|Decoration|Cost and price)/ });
    expect(steps.map(button => expected.find(title => within(button).queryByText(title) !== null))).toEqual(expected);
    expect(screen.queryByText('Then, once the cake is composed')).not.toBeInTheDocument();
  });

  it('says the step that opened, once, for a screen reader', async () => {
    const { user } = await openNew();
    await user.click(step('Soak'));
    await waitFor(() => { expect(screen.getByText('Step 2 of 5: Soak')).toHaveAttribute('role', 'status'); });
  });
});

describe('a saved cake', () => {
  it('opens with every step closed, and each closed step names its recipes with their grams', async () => {
    await openSaved();
    for (const title of [...PARTS, 'Cost and price']) expect(expanded(title)).toBe('false');
    expect(step('Base')).toHaveTextContent('Sponge · 900 g');
    expect(step('Soak')).toHaveTextContent('Cream · 70 g');
    expect(step('Filling')).not.toHaveTextContent('·');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('a tap opens a step, and only one is open at a time; a tap on the open one closes it', async () => {
    const { user } = await openSaved();
    await user.click(step('Soak'));
    expect(expanded('Soak')).toBe('true');
    await user.click(step('Filling'));
    expect(expanded('Filling')).toBe('true');
    expect(expanded('Soak')).toBe('false');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    await user.click(step('Filling'));
    expect(expanded('Filling')).toBe('false');
  });

  it('a step with a recipe shows a tick and says so to a screen reader', async () => {
    await openSaved();
    expect(within(step('Base')).getByText('has a recipe')).toBeInTheDocument();
    expect(within(step('Filling')).queryByText('has a recipe')).not.toBeInTheDocument();
  });

  it('the steps are never saved: opening and closing them leaves the cake clean', async () => {
    const { user } = await openSaved();
    await user.click(step('Base'));
    await user.click(step('Soak'));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the search box', () => {
  it('lists the semi-finished cards, narrows as letters are typed and marks them in each name', async () => {
    const { user } = await openNew();
    const search = screen.getByRole('combobox', { name: 'Search a recipe for Base' });
    await user.click(search);
    expect(await screen.findAllByRole('option', undefined, LOAD)).toHaveLength(4);
    await user.type(search, 'CR');
    // The list ENDS with «+ New recipe “…”» (the owner may make recipes): the cards are the options before it.
    const options = screen.getAllByRole('option').slice(0, -1);
    // Capitals do not matter, and the letters are marked wherever they fall in each name.
    expect(options.map(option => option.querySelector('mark')?.textContent)).toEqual(['cr', 'Cr']);
    expect(options.map(option => option.textContent)).toEqual([expect.stringContaining('Cocoa crumble'), expect.stringContaining('Cream')]);
  });

  it('says so when nothing matches, for someone who cannot make recipes (the venue has no Recipes)', async () => {
    const { user } = await openNew({ session: { location: { sections: { catalogue: false } } } });
    await user.type(screen.getByRole('combobox', { name: 'Search a recipe for Base' }), 'zzz');
    expect(await screen.findByText('No recipe matches.')).toBeInTheDocument();
  });

  it('picking a recipe adds it to that part, empties the box, and shows its grams box with the rule’s figure, with the cursor in it', async () => {
    const { user } = await openNew();
    await user.click(screen.getByRole('combobox', { name: 'Search a recipe for Base' }));
    await user.click(await screen.findByRole('option', { name: /Sponge/ }, LOAD));
    const grams = await screen.findByRole('textbox', { name: 'Sponge: grams' });
    await waitFor(() => { expect(grams).toHaveFocus(); });
    expect(grams).toHaveValue('');
    // On the venue's reference grams the rule has a figure for it (a new cake is 20 cm, 3 discs): it is the placeholder.
    expect(Number(grams.getAttribute('placeholder'))).toBeGreaterThan(600);
    expect(screen.getByRole('combobox', { name: 'Search a recipe for Base' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Search a recipe for Base' })).toHaveAttribute('placeholder', 'Add another recipe…');
  });

  it('typed grams replace the rule, and the closed step then says them', async () => {
    const { user } = await openNew();
    await user.click(screen.getByRole('combobox', { name: 'Search a recipe for Base' }));
    await user.click(await screen.findByRole('option', { name: /Sponge/ }, LOAD));
    await user.type(await screen.findByRole('textbox', { name: 'Sponge: grams' }), '640');
    await user.click(step('Soak'));
    expect(expanded('Base')).toBe('false');
    expect(step('Base')).toHaveTextContent('Sponge · 640 g');
  });

  it('adds more than one recipe to a part, and removes one with the small ×', async () => {
    const { user } = await openNew();
    const search = () => screen.getByRole('combobox', { name: 'Search a recipe for Base' });
    await user.click(search());
    await user.click(await screen.findByRole('option', { name: /Sponge/ }, LOAD));
    await user.click(search());
    await user.click(await screen.findByRole('option', { name: /Cream/ }));
    const alone = Number(screen.getByRole('textbox', { name: 'Sponge: grams' }).getAttribute('placeholder'));
    expect(Number(screen.getByRole('textbox', { name: 'Cream: grams' }).getAttribute('placeholder'))).toBe(alone);
    await user.click(screen.getByRole('button', { name: 'Remove Cream' }));
    expect(screen.queryByRole('textbox', { name: 'Cream: grams' })).not.toBeInTheDocument();
    // Alone again, the sponge has the whole rule: about twice the share.
    expect(Number(screen.getByRole('textbox', { name: 'Sponge: grams' }).getAttribute('placeholder'))).toBeGreaterThanOrEqual(2 * alone - 1);
  });

  it('opens with the keyboard: the arrow keys and Enter pick, Escape closes without picking', async () => {
    const { user } = await openNew();
    const search = screen.getByRole('combobox', { name: 'Search a recipe for Base' });
    search.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowDown}');
    expect(await screen.findAllByRole('option', undefined, LOAD)).not.toHaveLength(0);
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('option')).not.toBeInTheDocument(); });
    await user.keyboard('coc{ArrowDown}{Enter}');
    expect(await screen.findByRole('textbox', { name: 'Cocoa crumble: grams' })).toBeInTheDocument();
  });

  it('the arrow button has a name', async () => {
    await openNew();
    expect(screen.getByRole('button', { name: 'Show the recipes' })).toBeInTheDocument();
  });
});

describe('what the steps never do', () => {
  it('the same recipe may go in two parts (a card is only refused twice in the same part)', async () => {
    const { user } = await openNew();
    await user.click(screen.getByRole('combobox', { name: 'Search a recipe for Base' }));
    await user.click(await screen.findByRole('option', { name: /Sponge/ }, LOAD));
    await user.click(step('Soak'));
    await user.click(screen.getByRole('combobox', { name: 'Search a recipe for Soak' }));
    expect(await screen.findByRole('option', { name: /Sponge/ }, LOAD)).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('a new cake with a recipe in a step is a change: leaving asks', async () => {
    const { user } = await openNew();
    await user.click(screen.getByRole('combobox', { name: 'Search a recipe for Base' }));
    await user.click(await screen.findByRole('option', { name: /Sponge/ }, LOAD));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('the ✓ of a recipe row', () => {
  const tick = (part: string) => screen.getByRole('button', { name: `Confirm ${part}` });

  it('closes the step and opens the next one, whose title takes the focus', async () => {
    const { user } = await openSaved();
    await user.click(step('Base'));
    await user.click(tick('Base'));
    expect(expanded('Base')).toBe('false');
    expect(expanded('Soak')).toBe('true');
    expect(step('Soak')).toHaveFocus();
  });

  it('on the last part opens the Cost and price card and moves the focus to it, closing every step', async () => {
    const cake = cakeDoc('c1', 'Plain', { diameterCm: 22, discs: 3, ref: REFERENCE, lines: [{ tier: 0, part: 'decoration', productId: 'CREAM', grams: 20 }] });
    const view = renderCakes('/cakes/c1', { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: foodcost() });
    await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
    await view.user.click(step('Decoration'));
    expect(expanded('Cost and price')).toBe('false');
    await view.user.click(tick('Decoration'));
    expect(expanded('Decoration')).toBe('false');
    expect(expanded('Cost and price')).toBe('true');
    expect(step('Cost and price')).toHaveFocus();
  });

  it('sits between the grams box and the ✕ in the DOM, which is the tab order and the tablet’s reading order', async () => {
    const { user } = await openSaved();
    await user.click(step('Base'));
    const controls = within(screen.getByRole('group', { name: /^Base/ })).getAllByRole('button', { name: /^(Confirm Base|Remove )/ });
    const grams = screen.getByRole('textbox', { name: /Sponge: grams/ });
    const [tickButton, removeButton] = controls;
    expect(grams.compareDocumentPosition(tickButton!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tickButton!.compareDocumentPosition(removeButton!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is a 48px button named for the part, in Italian too', async () => {
    const cake = cakeDoc('c1', 'Torta', { diameterCm: 22, discs: 3, ref: REFERENCE, lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }] });
    const view = renderCakes('/cakes/c1', { lang: 'it', cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: foodcost() });
    await screen.findByRole('heading', { level: 2, name: 'Torta' }, LOAD);
    await view.user.click(screen.getByRole('button', { name: /^Base/ }));
    expect(screen.getByRole('button', { name: 'Conferma Base' })).toBeInTheDocument();
  });
});

describe('the parts and cost cards fold', () => {
  const parts = () => screen.getByRole('button', { name: /^Parts of the cake/ });

  it('the Parts card starts open; folded it says which parts hold a recipe and how many of five', async () => {
    const { user } = await openSaved();
    expect(parts()).toHaveAttribute('aria-expanded', 'true');
    await user.click(parts());
    expect(parts()).toHaveAttribute('aria-expanded', 'false');
    expect(parts()).toHaveTextContent('Base, Soak · 2 of 5 parts');
    expect(screen.queryByRole('button', { name: /^Base/ })).not.toBeInTheDocument();
    await user.click(parts());
    expect(step('Base')).toBeInTheDocument();
  });

  it('a card with no recipe says so when folded', async () => {
    const { user } = await openNew();
    await user.click(parts());
    expect(parts()).toHaveTextContent('No part yet · 0 of 5 parts');
  });

  it('the Cost and price card starts folded with its summary; once a price is set the summary says it', async () => {
    const cake = cakeDoc('c1', 'Plain', { diameterCm: 22, discs: 3, ref: REFERENCE, sellingPrice: 24, lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }] });
    const view = renderCakes('/cakes/c1', { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: foodcost() });
    await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
    const cost = step('Cost and price');
    expect(cost).toHaveAttribute('aria-expanded', 'false');
    expect(cost).toHaveTextContent(/raw materials · price £24\.00$/);
    await view.user.click(cost);
    expect(cost).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Cost and price' })).toBeInTheDocument();
    await view.user.click(cost);
    expect(cost).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('in Italian', () => {
  it('says the steps and the search box in Italian', async () => {
    renderCakes('/cakes/new', { lang: 'it', cakes: fakeCakesSource({ cakes: [], reference: storedReference() }), foodcost: foodcost() });
    await screen.findByRole('heading', { level: 2, name: 'Nuova torta' }, LOAD);
    expect(screen.getByRole('combobox', { name: 'Cerca una ricetta per Base' })).toHaveAttribute('placeholder', 'Cerca una ricetta…');
    for (const title of ['Base', 'Bagna', 'Farcitura', 'Copertura', 'Decorazione', 'Costo e prezzo']) expect(screen.getByRole('button', { name: new RegExp(`^${title}`) })).toBeInTheDocument();
    expect(screen.queryByText('Poi, quando la torta è composta')).not.toBeInTheDocument();
  });
});
