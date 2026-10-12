import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { BRIOCHE, FOCACCIA, LOAD, configOf, onlyFocaccia, renderCalculator } from '../testing/renderCalculator';

// The tabs, the address and the three empty states of the Calculator's work view. What is inside a tab is in
// CalculatorSection.entries.spec.tsx and CalculatorSection.result.spec.tsx.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const tabNames = () => main().queryAllByRole('tab').map(tab => tab.textContent);
const selected = () => main().getByRole('tab', { selected: true }).textContent;

async function open(path = '/calculator', config: Record<string, unknown> | null = configOf(), lang: 'en' | 'it' = 'en') {
  const view = renderCalculator(path, { source: fakeCalculatorSource({ config }), lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  return view;
}

describe('the tabs', () => {
  it('draws the visible recipes in their order, as tabs, the first one selected', async () => {
    await open();
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(tabNames()).toEqual(['Focaccia', 'Brioche', 'Sourdough']);
    expect(selected()).toBe('Focaccia');
  });

  it('names a tab by the words drawn on it', async () => {
    await open();
    expect(await screen.findByRole('tab', { name: 'Brioche' }, LOAD)).toBeInTheDocument();
  });

  it('puts a recipe set to «hidden» out of the strip, and keeps to the `order` field', async () => {
    const config = configOf({
      recipes: [{ ...BRIOCHE, order: 1 }, { ...FOCACCIA, order: 2 }, { ...BRIOCHE, id: 'hid', name: 'Hidden', visible: false, order: 0 }],
    });
    await open('/calculator', config);
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(tabNames()).toEqual(['Brioche', 'Focaccia']);
  });

  it('shows at most four', async () => {
    const recipes = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ ...BRIOCHE, id, name: `Dough ${id}`, order: i }));
    await open('/calculator', configOf({ recipes }));
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(tabNames()).toEqual(['Dough a', 'Dough b', 'Dough c', 'Dough d']);
  });

  it('draws ONE recipe as a plain title, not a lone tab: nothing to press or to focus', async () => {
    await open('/calculator', onlyFocaccia());
    expect(await main().findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('tab')).not.toBeInTheDocument();
    expect(main().queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('has the one h1 of the screen, the section\'s name', async () => {
    await open();
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Calculator');
  });

  it('labels the strip and joins the selected tab to its panel', async () => {
    await open();
    const list = await main().findByRole('tablist', { name: 'Recipes' }, LOAD);
    const tab = within(list).getByRole('tab', { selected: true });
    const panel = main().getByRole('tabpanel');
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
  });

  it('keeps only the selected tab in the Tab order, and moves with the arrow keys', async () => {
    const { user, router } = await open();
    await screen.findAllByRole('tab', undefined, LOAD);
    const tabs = main().getAllByRole('tab');
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);

    tabs[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(selected()).toBe('Brioche');
    expect(main().getByRole('tab', { name: 'Brioche' })).toHaveFocus();
    expect(router.state.location.pathname).toBe('/calculator/brioche');

    await user.keyboard('{End}');
    expect(selected()).toBe('Sourdough');
    await user.keyboard('{ArrowRight}');
    expect(selected()).toBe('Focaccia');
    await user.keyboard('{ArrowLeft}');
    expect(selected()).toBe('Sourdough');
  });
});

describe('the address', () => {
  it('opens a tab by its address, so a shared link lands on the same tab', async () => {
    await open('/calculator/brioche');
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(selected()).toBe('Brioche');
  });

  it('picking a tab changes the address by REPLACING it: four tabs do not pile four steps onto Back', async () => {
    const { user, router } = await open();
    const start = router.state.location.key;
    await user.click(await screen.findByRole('tab', { name: 'Sourdough' }, LOAD));
    expect(router.state.location.pathname).toBe('/calculator/sourdough');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.key).not.toBe(start);
  });

  it('leaves the focus on the tab that was pressed, not on the page title', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('tab', { name: 'Brioche' }, LOAD));
    expect(main().getByRole('tab', { name: 'Brioche' })).toHaveFocus();
  });

  it('sends an unknown recipe to the first visible one, by replacing the address', async () => {
    const { router } = await open('/calculator/nonsense');
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(router.state.location.pathname).toBe('/calculator/focaccia');
    expect(selected()).toBe('Focaccia');
  });

  it('sends a hidden recipe the same way', async () => {
    const config = configOf({ recipes: [FOCACCIA, { ...BRIOCHE, visible: false }] });
    const { router } = await open('/calculator/brioche', config);
    await main().findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD);
    expect(router.state.location.pathname).toBe('/calculator/focaccia');
  });

  it('sends an address with more than one segment back to the Calculator', async () => {
    const { router } = await open('/calculator/brioche/extra/stuff');
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(router.state.location.pathname).toBe('/calculator');
  });

  it('reads an id with a slash in it whole', async () => {
    const config = configOf({ recipes: [FOCACCIA, { ...BRIOCHE, id: 'a/b c', name: 'Odd id' }] });
    await open(`/calculator/${encodeURIComponent('a/b c')}`, config);
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(selected()).toBe('Odd id');
  });

  it('does not lose a tab\'s address while the configuration has not answered yet', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    const { router } = renderCalculator('/calculator/brioche', { source });
    await screen.findByText('Loading…', undefined, LOAD);
    expect(router.state.location.pathname).toBe('/calculator/brioche');
    act(() => { source.release(); });
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(selected()).toBe('Brioche');
  });
});

describe('a configuration that changes under the screen (another phone)', () => {
  it('keeps the tab if it is still there', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    renderCalculator('/calculator/brioche', { source });
    await screen.findAllByRole('tab', undefined, LOAD);
    act(() => { source.config = configOf({ recipes: [FOCACCIA, BRIOCHE] }); source.push(); });
    expect(tabNames()).toEqual(['Focaccia', 'Brioche']);
    expect(selected()).toBe('Brioche');
  });

  it('falls back to the first recipe when the tab was taken away', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    const { router } = renderCalculator('/calculator/brioche', { source });
    await screen.findAllByRole('tab', undefined, LOAD);
    act(() => { source.config = configOf({ recipes: [FOCACCIA, { ...BRIOCHE, visible: false }] }); source.push(); });
    await main().findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD);
    expect(router.state.location.pathname).toBe('/calculator/focaccia');
  });

  it('falls back to the empty sentence, never a blank strip, when no recipe is left to show', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    renderCalculator('/calculator/brioche', { source });
    await screen.findAllByRole('tab', undefined, LOAD);
    act(() => { source.config = configOf({ recipes: [{ ...FOCACCIA, visible: false }] }); source.push(); });
    expect(await screen.findByText('No recipe is shown here', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('tab')).not.toBeInTheDocument();
  });
});

describe('a Calculator with nothing to draw says why, in three different sentences', () => {
  it('«Loading…» while nothing has answered, with no button', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Fetching the recipes saved for this venue.')).toBeInTheDocument();
    expect(main().queryByRole('button')).not.toBeInTheDocument();
    expect(main().queryByRole('link')).not.toBeInTheDocument();
  });

  it('«No recipes yet» when the venue has none — with the doors to the Dough history, Settings and to «Add a recipe»', async () => {
    await open('/calculator', configOf({ recipes: [] }));
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(/Add your first recipe/)).toBeInTheDocument();
    expect(main().getAllByRole('button').map(button => button.textContent)).toEqual(['Dough history', 'Settings', 'Add a recipe']);
  });

  it('a brand-new venue (the server says «no document») is «No recipes yet», not «Loading…» for ever', async () => {
    await open('/calculator', null);
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('«No recipe is shown here» when recipes exist but none is set to show', async () => {
    await open('/calculator', configOf({ recipes: [{ ...FOCACCIA, visible: false }] }));
    expect(await screen.findByText('No recipe is shown here', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(/none of them is set to appear as a tab/)).toBeInTheDocument();
    expect(main().getAllByRole('button').map(button => button.textContent)).toEqual(['Dough history', 'Settings', 'Choose which to show']);
  });

  it('says the configuration could not be loaded when the stream failed and nothing is on this phone', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.refuse.config = true;
    renderCalculator('/calculator', { source });
    expect(await screen.findByText(
      'The Calculator could not be loaded. Check the connection and reopen it.', undefined, LOAD,
    )).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('keeps showing the recipes of the copy on this phone when the stream fails', async () => {
    window.localStorage.setItem('calculator-config', JSON.stringify(configOf()));
    const source = fakeCalculatorSource({ config: configOf() });
    source.refuse.config = true;
    renderCalculator('/calculator', { source });
    await screen.findAllByRole('tab', undefined, LOAD);
    expect(tabNames()).toEqual(['Focaccia', 'Brioche', 'Sourdough']);
  });

  it('is the dashed neutral card, not a warning', async () => {
    await open('/calculator', configOf({ recipes: [] }));
    const sentence = await screen.findByText('No recipes yet', undefined, LOAD);
    expect(main().queryByRole('alert')).not.toBeInTheDocument();
    expect(sentence.closest('[role]')).toBeNull();
  });
});

describe('in Italian', () => {
  it('says the three empty states in Italian', async () => {
    await open('/calculator', configOf({ recipes: [] }), 'it');
    expect(await screen.findByText('Ancora nessuna ricetta', undefined, LOAD)).toBeInTheDocument();
  });

  it('says «no recipe is shown» in Italian', async () => {
    await open('/calculator', configOf({ recipes: [{ ...FOCACCIA, visible: false }] }), 'it');
    expect(await screen.findByText('Qui non è mostrata nessuna ricetta', undefined, LOAD)).toBeInTheDocument();
  });

  it('says «loading» in Italian', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator', { source, lang: 'it' });
    expect(await screen.findByText('Caricamento…', undefined, LOAD)).toBeInTheDocument();
  });

  it('labels the strip in Italian', async () => {
    await open('/calculator', configOf(), 'it');
    expect(await main().findByRole('tablist', { name: 'Ricette' }, LOAD)).toBeInTheDocument();
  });
});
