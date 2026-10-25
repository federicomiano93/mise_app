import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The doors between the work view and Settings: the button at the top of the work view and of the empty states,
// the addresses under /calculator/settings, and Back with the focus handed back to the door that opened it.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;

function open(path: string, config: Record<string, unknown> | null = configOf()) {
  return renderCalculator(path, { source: fakeCalculatorSource({ config }) });
}

describe('the door at the top of the work view', () => {
  it('is a Settings button, and opens the hub one level down', async () => {
    const view = open('/calculator');
    await view.user.click(await main().findByRole('button', { name: 'Settings' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/settings');
    expect(await main().findByRole('heading', { level: 2, name: 'Settings' }, LOAD)).toBeInTheDocument();
    // One h1 for the whole screen: the section's name; the hub's title is the level below it.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('is there with the tabs of any recipe', async () => {
    open('/calculator/brioche');
    expect(await main().findByRole('button', { name: 'Settings' }, LOAD)).toBeInTheDocument();
  });

  it('puts the focus on the hub\'s title when it opens, and hands it back to the door on Back', async () => {
    const view = open('/calculator');
    await view.user.click(await main().findByRole('button', { name: 'Settings' }, LOAD));
    const title = await main().findByRole('heading', { level: 2, name: 'Settings' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });

    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(await main().findByRole('button', { name: 'Settings' })).toHaveFocus();
  });

  it('hands the focus back one level at a time: Extra dough to the hub, the hub to the work view', async () => {
    const view = open('/calculator');
    await view.user.click(await main().findByRole('button', { name: 'Settings' }, LOAD));
    await view.user.click(await main().findByRole('button', { name: /^Extra dough/ }, LOAD));
    expect(pathOf(view)).toBe('/calculator/settings/extra');

    await view.user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(await main().findByRole('button', { name: /^Extra dough/ })).toHaveFocus();

    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(await main().findByRole('button', { name: 'Settings' })).toHaveFocus();
  });

  it('steps back to the work view by REPLACING the entry when the hub was opened by its address', async () => {
    const view = open('/calculator/settings');
    await view.user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(view.router.state.historyAction).toBe('REPLACE');
  });
});

describe('the empty states', () => {
  it('«Loading…» has no button at all, not even Settings', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button')).not.toBeInTheDocument();
  });

  it('«No recipes yet» offers Settings and a primary «Add a recipe»', async () => {
    const view = open('/calculator', configOf({ recipes: [] }));
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    await view.user.click(main().getByRole('button', { name: 'Add a recipe' }));
    // A fresh recipe is made and opened at its own address.
    await waitFor(() => { expect(pathOf(view)).toMatch(/^\/calculator\/settings\/recipes\/r-[0-9a-z]+$/); });
  });

  it('«No recipe is shown here» offers Settings and «Choose which to show»', async () => {
    const view = open('/calculator', configOf({ recipes: [{ id: 'a', name: 'Hidden', logic: 'orders', visible: false, ingredients: [] }] }));
    expect(await screen.findByText('No recipe is shown here', undefined, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    await view.user.click(main().getByRole('button', { name: 'Choose which to show' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/recipes'); });
  });

  it('a brand-new venue (no document) gets both buttons', async () => {
    open('/calculator', null);
    expect(await main().findByRole('button', { name: 'Add a recipe' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('a configuration that failed to load has no button', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.refuse.config = true;
    renderCalculator('/calculator', { source });
    expect(await screen.findByText(/could not be loaded/, undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button')).not.toBeInTheDocument();
  });

  it('says the buttons in Italian', async () => {
    renderCalculator('/calculator', { source: fakeCalculatorSource({ config: configOf({ recipes: [] }) }), lang: 'it' });
    expect(await main().findByRole('button', { name: 'Aggiungi una ricetta' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Impostazioni' })).toBeInTheDocument();
  });
});

describe('the addresses under Settings', () => {
  it.each([
    '/calculator/settings/nonsense',
    '/calculator/settings/extra/more',
  ])('%s goes to the hub', async path => {
    const view = open(path);
    expect(await main().findByRole('heading', { level: 2, name: 'Settings' }, LOAD)).toBeInTheDocument();
    expect(pathOf(view)).toBe('/calculator/settings');
  });

  it('keeps a Settings address while the configuration has not answered', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    const view = renderCalculator('/calculator/settings/divisor/focaccia', { source });
    await screen.findByText('Loading…', undefined, LOAD);
    expect(pathOf(view)).toBe('/calculator/settings/divisor/focaccia');
  });

  it('draws the hub even for a venue with no recipe at all', async () => {
    open('/calculator/settings', configOf({ recipes: [] }));
    expect(await main().findByRole('heading', { level: 2, name: 'Settings' }, LOAD)).toBeInTheDocument();
  });
});
