import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { AT, NOW, logOf, sheetOf, versionOf } from '../testing/logFixtures';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The Dough history: the door from the work view, the list (what it hides, newest first, one card per log), one
// log read-only, deleting it, and a log that is not there.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
// ⚠️ jsdom applies no media query, so the list stays in the page behind a log it has opened (a phone hides it with
// CSS): the screen's own Back is the LAST one in the page.
const back = () => main().getAllByRole('button', { name: 'Back' }).at(-1)!;
const backButton = async () => {
  await main().findAllByRole('button', { name: 'Back' }, LOAD);
  return back();
};
type View = ReturnType<typeof renderCalculator>;
const pathOf = (view: View) => view.router.state.location.pathname;
const cardNames = () => main().queryAllByRole('listitem').map(item => within(item).getAllByRole('button')[0]?.textContent);

const config = () => configOf({ logVisibility: { brioche: false }, logRetentionHours: 24 });

async function openList(logs: ({ id: string } & Record<string, unknown>)[] = [], lang: 'en' | 'it' = 'en', path = '/calculator/log') {
  const source = fakeCalculatorSource({ config: config(), logs });
  const view = renderCalculator(path, { source, lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  return { ...view, source };
}

describe('the door from the work view', () => {
  it('is a «Dough history» button beside Settings, and opens the list one level down', async () => {
    const view = renderCalculator('/calculator', { source: fakeCalculatorSource({ config: config() }) });
    await view.user.click(await main().findByRole('button', { name: 'Dough history' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log');
    const title = await main().findByRole('heading', { level: 2, name: 'Dough history' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    // One h1 for the whole screen: the section's name.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('hands the focus back to the door on Back', async () => {
    const view = renderCalculator('/calculator', { source: fakeCalculatorSource({ config: config() }) });
    await view.user.click(await main().findByRole('button', { name: 'Dough history' }, LOAD));
    await view.user.click(await backButton());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(await main().findByRole('button', { name: 'Dough history' })).toHaveFocus();
  });

  it('is there with the tabs of any recipe', async () => {
    renderCalculator('/calculator/brioche', { source: fakeCalculatorSource({ config: config() }) });
    expect(await main().findByRole('button', { name: 'Dough history' }, LOAD)).toBeInTheDocument();
  });

  it('is not there while the Calculator is still loading', async () => {
    const held = fakeCalculatorSource({ config: config() });
    held.hold();
    renderCalculator('/calculator', { source: held });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Dough history' })).not.toBeInTheDocument();
  });
});

describe('the list', () => {
  it('shows the logs newest first, each one card', async () => {
    await openList([
      logOf('a', { dough: 'Focaccia A', createdAtMs: NOW - 300_000 }),
      logOf('b', { dough: 'Focaccia B', createdAtMs: NOW - 60_000 }),
      logOf('c', { dough: 'Focaccia C', createdAtMs: NOW - 120_000 }),
    ]);
    await main().findByRole('button', { name: 'Focaccia B' }, LOAD);
    expect(cardNames()).toEqual(['Focaccia B', 'Focaccia C', 'Focaccia A']);
  });

  it('hides a recipe the settings hide, and a log past its window', async () => {
    await openList([
      logOf('fresh', { dough: 'Focaccia fresh' }),
      logOf('hidden', { dough: 'Brioche', recipeId: 'brioche' }),
      logOf('stale', { dough: 'Focaccia stale', createdAtMs: NOW - 72 * 3600_000 }),
    ]);
    await main().findByRole('button', { name: 'Focaccia fresh' }, LOAD);
    expect(cardNames()).toEqual(['Focaccia fresh']);
  });

  it('says «nothing saved yet» when there are no logs at all', async () => {
    await openList([]);
    expect(await main().findByText('The dough history is empty. Calculate and confirm a dough to save it here.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says «all hidden» when there are logs and the settings hide every one', async () => {
    await openList([logOf('hidden', { dough: 'Brioche', recipeId: 'brioche' })]);
    expect(await main().findByText(/^Nothing to show in the dough history right now/, undefined, LOAD)).toBeInTheDocument();
  });

  it('says «Loading…» rather than «nothing saved» while the answer is on its way', async () => {
    const source = fakeCalculatorSource({ config: config(), logs: [logOf('a')] });
    source.hold();
    renderCalculator('/calculator/log', { source });
    expect(await main().findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByText(/dough history is empty/)).not.toBeInTheDocument();
  });

  it('draws a card with its dough, day, date, author, version count and order, and no action buttons', async () => {
    await openList([logOf('a', {
      versions: [
        versionOf({ calculatedBy: 'Marco' }),
        versionOf({ kind: 'edit', calculatedBy: 'Marco', text: 'x' }),
      ],
    })]);
    const card = within(await main().findByRole('listitem', undefined, LOAD));
    expect(card.getByRole('button', { name: 'Focaccia' })).toBeInTheDocument();
    expect(card.getByText('Today')).toBeInTheDocument();
    expect(card.getByText('Monday 12 October — 9:30 AM')).toBeInTheDocument();
    expect(card.getByText('by Marco')).toBeInTheDocument();
    expect(card.getByText('v2 · edited')).toBeInTheDocument();
    expect(card.getByText('Cafe Roma')).toBeInTheDocument();
    expect(card.getByText('Focaccia tray:', { exact: false })).toBeInTheDocument();
    expect(card.getAllByRole('button')).toHaveLength(1);
  });

  it('names the card button by the dough alone and describes it with the rest', async () => {
    await openList([logOf('a', { versions: [versionOf({ calculatedBy: 'Marco' })] })]);
    const button = await main().findByRole('button', { name: 'Focaccia' }, LOAD);
    expect(button).toHaveAccessibleDescription(/Monday 12 October — 9:30 AM/);
    expect(button).toHaveAccessibleDescription(/by Marco/);
  });

  it('shows the day a dough is for in words, and the one made yesterday for today', async () => {
    await openList([
      logOf('t', { dough: 'For tomorrow', forDay: 'tomorrow', createdAtMs: NOW - 60_000 }),
      logOf('y', { dough: 'Made yesterday', createdAtMs: NOW - 26 * 3600_000 }),
    ]);
    await main().findByRole('button', { name: 'For tomorrow' }, LOAD);
    const items = main().getAllByRole('listitem');
    expect(within(items[0]!).getByText('Today for tomorrow')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Yesterday')).toBeInTheDocument();
  });

  it('draws a legacy log from its saved text, with no sheet', async () => {
    await openList([logOf('old', {
      versions: [{ kind: 'create', legacy: true, at: AT, text: 'Bar Sole:\n  Cheese: 2 kg\nCafe Roma:\n  Tray: 3 pz' }],
    })]);
    const card = within(await main().findByRole('listitem', undefined, LOAD));
    expect(card.getByText('Bar Sole')).toBeInTheDocument();
    expect(card.getByText('Cheese: 2 kg')).toBeInTheDocument();
    expect(card.getByText('Tray: 3 pz')).toBeInTheDocument();
  });

  it('writes «occasional» clients, trays and extra dough, and «No products entered»', async () => {
    await openList([
      logOf('full', {
        dough: 'Full',
        versions: [versionOf({
          items: [{ id: 'z', name: 'Zero line', clientName: 'Cafe Roma', qty: 0, weightG: 100, kind: 'number' }],
          occasional: [{ name: 'Walk-in', products: [{ name: 'Loaf', qty: 2, weightG: 400, unit: 'kg' }] }],
          sheet: sheetOf('Full', { trays: 5, trayWeight_g: 1000, total_g: 5600, extra_g: 300 }),
        })],
        createdAtMs: NOW - 30_000,
      }),
      logOf('none', { dough: 'None', versions: [versionOf({ items: [], sheet: sheetOf('None') })], createdAtMs: NOW - 90_000 }),
    ]);
    const [full, none] = await main().findAllByRole('listitem', undefined, LOAD);
    expect(within(full!).getByText('Walk-in · occasional')).toBeInTheDocument();
    expect(within(full!).getByText('Loaf:', { exact: false })).toBeInTheDocument();
    expect(within(full!).getByText('5 trays × 1,000 g')).toBeInTheDocument();
    expect(within(full!).getByText('+ 600 g typed by hand')).toBeInTheDocument();
    expect(within(full!).getByText('Extra dough: 300 g')).toBeInTheDocument();
    expect(within(full!).queryByText('Zero line:', { exact: false })).not.toBeInTheDocument();
    expect(within(none!).getByText('No products entered.')).toBeInTheDocument();
  });

  it('skips a log it cannot draw and keeps the rest', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openList([
      logOf('bad', { dough: { not: 'a string' }, createdAtMs: NOW - 30_000 }),
      logOf('good', { dough: 'Focaccia good' }),
      logOf('worse', { versions: 'nonsense', dough: 'Focaccia worse', createdAtMs: NOW - 90_000 }),
    ]);
    await main().findByRole('button', { name: 'Focaccia good' }, LOAD);
    expect(cardNames()).toContain('Focaccia good');
    expect(main().getByRole('heading', { level: 2, name: 'Dough history' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('offers «Add dough» at the top, which opens the Add address one level down', async () => {
    const view = await openList([logOf('a')]);
    const add = await main().findByRole('button', { name: 'Add dough' }, LOAD);
    await view.user.click(add);
    expect(pathOf(view)).toBe('/calculator/log/new');
    expect(await main().findByRole('heading', { level: 2, name: 'Add dough' }, LOAD)).toBeInTheDocument();
    await view.user.click(back());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    expect(await main().findByRole('button', { name: 'Add dough' })).toHaveFocus();
  });
});

describe('one log', () => {
  it('opens from its card: the dough and day in the bar, then date, author, order and the sheet it was saved with', async () => {
    const view = await openList([logOf('a', {
      versions: [versionOf({
        calculatedBy: 'Marco',
        sheet: sheetOf('Focaccia', {
          divisor: { names: ['Focaccia tray'], total: 1500, n: 3, result: 500 },
          crates: [{ name: 'Focaccia tray', count: 0.4, eachBoxG: 5000 }],
        }),
      })],
    })]);
    await view.user.click(await main().findByRole('button', { name: 'Focaccia' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log/a');
    const title = await main().findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    expect(main().getAllByText('Calculated by Marco')).toHaveLength(1);
    // The day it is for sits under the title (and on its card in the list beside it).
    expect(main().getAllByText('Today')).toHaveLength(2);
    const sheet = within(main().getByRole('region', { name: 'Focaccia dough' }));
    expect(sheet.getByText('Flour')).toBeInTheDocument();
    expect(sheet.getByText('1,200 g')).toBeInTheDocument();
    expect(sheet.getByText('Total dough')).toBeInTheDocument();
    expect(sheet.getByText('2,000 g', { selector: 'span' })).toBeInTheDocument();
    expect(sheet.getAllByText('Focaccia tray')).toHaveLength(2);
    expect(sheet.getByText('1,500 g')).toBeInTheDocument();
    expect(sheet.getByText('3')).toBeInTheDocument();
    expect(sheet.getByText('500 g')).toBeInTheDocument();
    expect(sheet.getByText('0.4 box')).toBeInTheDocument();
    expect(sheet.getByText('5,000g each box')).toBeInTheDocument();
    // Read-only: the sheet holds no field at all.
    expect(sheet.queryByRole('combobox')).not.toBeInTheDocument();
    expect(sheet.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('hands the focus back to the card on Back', async () => {
    const view = await openList([logOf('a')]);
    await view.user.click(await main().findByRole('button', { name: 'Focaccia' }, LOAD));
    await view.user.click(await backButton());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    expect(await main().findByRole('button', { name: 'Focaccia' })).toHaveFocus();
  });

  it('steps back to the list by REPLACING the entry when it was opened by its address', async () => {
    const view = await openList([logOf('a')], 'en', '/calculator/log/a');
    await view.user.click(await backButton());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    expect(view.router.state.historyAction).toBe('REPLACE');
  });

  it('offers Edit only for a log made by hand', async () => {
    await openList([logOf('calc'), logOf('hand', { origin: 'manual', dough: 'Focaccia by hand' })], 'en', '/calculator/log/hand');
    expect(await main().findByRole('button', { name: 'Edit' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('shows no Edit for a log the calculator made', async () => {
    await openList([logOf('calc')], 'en', '/calculator/log/calc');
    await main().findByRole('button', { name: 'History' }, LOAD);
    expect(main().queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('opens Edit on its address', async () => {
    const view = await openList([logOf('hand', { origin: 'manual' })], 'en', '/calculator/log/hand');
    await view.user.click(await main().findByRole('button', { name: 'Edit' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log/hand/edit');
  });

  it('draws a log made by hand like any other', async () => {
    await openList([logOf('hand', { origin: 'manual', versions: [versionOf({ calculatedBy: 'Anna' })] })], 'en', '/calculator/log/hand');
    expect(await main().findByText('Calculated by Anna', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('deleting a log', () => {
  it('is a small icon named «Delete dough», which asks with the dough\'s name first', async () => {
    const view = await openList([logOf('a')], 'en', '/calculator/log/a');
    await view.user.click(await main().findByRole('button', { name: 'Delete dough' }, LOAD));
    const dialog = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(dialog.getByText('Delete the dough “Focaccia”? This cannot be undone.')).toBeInTheDocument();
    await view.user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(view.source.deletedIds).toEqual([]);
    await waitFor(() => { expect(main().getByRole('button', { name: 'Delete dough' })).toHaveFocus(); });
  });

  it('removes the log and lands on the list, the title holding the focus', async () => {
    const view = await openList([logOf('a'), logOf('b', { dough: 'Focaccia B', createdAtMs: NOW - 120_000 })]);
    await view.user.click(await main().findByRole('button', { name: 'Focaccia' }, LOAD));
    await view.user.click(await main().findByRole('button', { name: 'Delete dough' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(view.source.deletedIds).toEqual(['a']); });
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    await waitFor(() => { expect(cardNames()).toEqual(['Focaccia B']); });
    expect(main().getByRole('heading', { level: 2, name: 'Dough history' })).toHaveFocus();
  });

  it('lands on the list by replacing when the log was opened by its address', async () => {
    const view = await openList([logOf('a')], 'en', '/calculator/log/a');
    await view.user.click(await main().findByRole('button', { name: 'Delete dough' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    expect(view.router.state.historyAction).toBe('REPLACE');
  });
});

describe('a log that is not there', () => {
  it('says «Dough not found.» with the way back, once the logs have arrived', async () => {
    const view = await openList([logOf('a')], 'en', '/calculator/log/nope');
    expect(await main().findByText('Dough not found.', undefined, LOAD)).toBeInTheDocument();
    await view.user.click(back());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
  });

  it('says «Loading…», not «not found», while the logs are on their way', async () => {
    const source = fakeCalculatorSource({ config: config(), logs: [logOf('a')] });
    source.hold();
    renderCalculator('/calculator/log/a', { source });
    expect((await main().findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(main().queryByText('Dough not found.')).not.toBeInTheDocument();
  });

  it('shows «Dough not found.» when it is deleted on another phone while open, never a crash', async () => {
    const view = await openList([logOf('a')], 'en', '/calculator/log/a');
    await main().findByRole('button', { name: 'History' }, LOAD);
    view.source.logs.delete('a');
    view.source.push();
    expect(await main().findByText('Dough not found.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/didn.t load/)).not.toBeInTheDocument();
  });

  it('sends an address of another shape under the Dough history back to the list', async () => {
    const view = await openList([logOf('a')], 'en', '/calculator/log/a/nonsense/more');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
  });
});

describe('in Italian', () => {
  it('speaks Italian on the list and on a log', async () => {
    const view = await openList([
      logOf('a', { versions: [versionOf({ calculatedBy: 'Marco' }), versionOf({ kind: 'edit', calculatedBy: 'Marco' })] }),
    ], 'it');
    expect(await main().findByRole('heading', { level: 2, name: 'Storico impasti' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Aggiungi impasto' })).toBeInTheDocument();
    const card = within(main().getByRole('listitem'));
    expect(card.getByText('Oggi')).toBeInTheDocument();
    expect(card.getByText('calcolato da Marco')).toBeInTheDocument();
    expect(card.getByText('v2 · modificato')).toBeInTheDocument();

    await view.user.click(card.getByRole('button', { name: 'Focaccia' }));
    expect(await main().findByRole('button', { name: 'Storico' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Elimina impasto' })).toBeInTheDocument();
    expect(main().getByText('Calcolato da Marco')).toBeInTheDocument();
    expect(main().getByRole('region', { name: 'Impasto Focaccia' })).toBeInTheDocument();
  });

  it('names the door in Italian', async () => {
    renderCalculator('/calculator', { source: fakeCalculatorSource({ config: config() }), lang: 'it' });
    expect(await main().findByRole('button', { name: 'Storico impasti' }, LOAD)).toBeInTheDocument();
  });
});
