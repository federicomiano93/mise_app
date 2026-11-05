import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { CLIENTS, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The Settings screens work on the SERVER's copy of the configuration: the browser's own database answers first
// with whatever this phone last saw, and an editor opened on that would later write it over newer data.
// Also: no question while a save is in the air, and no question asked twice.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const LEAVE = 'You have unsaved changes. Leave without saving? Your changes will be lost.';
const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

describe('waiting for the server\'s answer', () => {
  it('an editor opened on the browser\'s own copy shows Loading and copies nothing, then shows the newer data', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator/settings/extra', { source });
    await act(async () => { await pause(100); });
    act(() => { source.push({ fromServer: false }); });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('switch')).not.toBeInTheDocument();
    // The server holds a NEWER document: Brioche has been switched off elsewhere.
    source.config = configOf({ extraDough: { brioche: false } });
    act(() => { source.push({ fromServer: true }); });
    expect(await main().findByRole('switch', { name: 'Brioche' }, LOAD)).not.toBeChecked();
  });

  it('the Clients editor shows the newer clients, not the cached ones', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator/settings/clients', { source });
    await act(async () => { await pause(100); });
    act(() => { source.push({ fromServer: false }); });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: '+ Add client' })).not.toBeInTheDocument();
    source.config = configOf({ clients: [...CLIENTS, { id: 'nova', name: 'Bakery Nova', products: [] }] });
    act(() => { source.push({ fromServer: true }); });
    expect(await main().findByText('Bakery Nova', undefined, LOAD)).toBeInTheDocument();
  });

  it('says the Calculator could not be loaded when the configuration fails while waiting', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.refuse.config = true;
    renderCalculator('/calculator/settings/extra', { source });
    expect(await screen.findByText('The Calculator could not be loaded. Check the connection and reopen it.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('the hub\'s two switches are disabled until the server has answered', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator/settings', { source });
    await act(async () => { await pause(100); });
    act(() => { source.push({ fromServer: false }); });
    for (const item of await main().findAllByRole('switch', undefined, LOAD)) expect(item).toBeDisabled();
    act(() => { source.push({ fromServer: true }); });
    await waitFor(() => { for (const item of main().getAllByRole('switch')) expect(item).toBeEnabled(); });
  });
});

describe('leaving while a save is in the air', () => {
  it('Extra dough: the browser\'s Back asks nothing and stays until the save settles', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    const view = renderCalculator('/calculator/settings/extra', { source });
    await main().findByRole('heading', { level: 2 }, LOAD);
    source.holdConfigSaves();
    await view.user.click(main().getAllByRole('switch')[0] as HTMLElement);
    await view.user.click(main().getByRole('button', { name: 'Save' }));
    await view.user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    act(() => { void view.router.navigate('/more'); });
    await pause(50);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(pathOf(view)).toBe('/calculator/settings/extra');
    act(() => { source.settleConfigSaves(); });
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
  });

  it('Clients: the same', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    const view = renderCalculator('/calculator/settings/clients/roma', { source });
    const name = await main().findByRole('textbox', { name: 'Client name' }, LOAD);
    source.holdConfigSaves();
    await view.user.type(name, '!');
    await view.user.click(main().getByRole('button', { name: 'Save' }));
    await view.user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    act(() => { void view.router.navigate('/more'); });
    await pause(50);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(pathOf(view)).toBe('/calculator/settings/clients/roma');
    act(() => { source.settleConfigSaves(); });
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/clients'); });
  });

  it('Recipes: the same', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    const view = renderCalculator('/calculator/settings/recipes/focaccia', { source });
    const name = await main().findByRole('textbox', { name: 'Recipe name' }, LOAD);
    source.holdConfigSaves();
    await view.user.type(name, '!');
    await view.user.click(main().getByRole('button', { name: 'Save' }));
    await view.user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    act(() => { void view.router.navigate('/more'); });
    await pause(50);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(pathOf(view)).toBe('/calculator/settings/recipes/focaccia');
    act(() => { source.settleConfigSaves(); });
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/recipes'); });
  });
});

describe('the leave question is asked once', () => {
  it('a store update between «Cancel» and the router\'s commit does not ask again', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    const view = renderCalculator('/calculator/settings/extra', { source });
    await main().findByRole('heading', { level: 2 }, LOAD);
    await view.user.click(main().getAllByRole('switch')[0] as HTMLElement);
    act(() => { void view.router.navigate('/more'); });
    const dialog = await question(LEAVE);
    let shown = 0;
    const watcher = new MutationObserver(() => {
      if (screen.queryAllByRole('alertdialog').length > 0) shown += 1;
    });
    await act(async () => {
      within(dialog).getByRole('button', { name: 'Cancel' }).click();
      // The configuration changes (another phone saved) before the router has published that it stopped blocking.
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
      source.config = configOf({ clients: [...CLIENTS, { id: 'nova', name: 'Bakery Nova', products: [] }] });
      source.push();
      watcher.observe(document.body, { childList: true, subtree: true });
      await pause(150);
    });
    watcher.disconnect();
    expect(pathOf(view)).toBe('/calculator/settings/extra');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(shown).toBe(0);
  });
});
