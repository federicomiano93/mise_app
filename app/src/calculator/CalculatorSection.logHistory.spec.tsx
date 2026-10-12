import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { NOW, logOf, sheetOf, versionOf } from '../testing/logFixtures';
import { LOAD, configOf, renderCalculator, split } from '../testing/renderCalculator';

// A log's version history (newest first, one version drawn like the log, restore on top), and the tablet's split
// (the list beside whatever is open).

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

// Three versions: the first made by Marco, an edit by Anna, and the first one restored on top of them.
const chain = () => logOf('a', {
  versions: [
    versionOf({ calculatedBy: 'Marco', sheet: sheetOf('Focaccia', { total_g: 2000 }) }),
    versionOf({
      kind: 'edit', calculatedBy: 'Anna', at: { date: 'Monday 12 October', time: '9:45 AM' },
      items: [{ id: 'tray', name: 'Focaccia tray', clientName: 'Cafe Roma', qty: 6, weightG: 500, kind: 'number' }],
      sheet: sheetOf('Focaccia', { total_g: 3000 }),
    }),
    versionOf({
      kind: 'restore', restoredFrom: 0, calculatedBy: 'Marco', at: { date: 'Monday 12 October', time: '9:50 AM' },
      sheet: sheetOf('Focaccia', { total_g: 2000 }),
    }),
  ],
});

async function open(path: string, logs = [chain()], lang: 'en' | 'it' = 'en') {
  const source = fakeCalculatorSource({ config: configOf({ logRetentionHours: 24 }), logs });
  const view = renderCalculator(path, { source, lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  return { ...view, source };
}

describe('the version history', () => {
  it('is opened from the log\'s History button, and lists the versions newest first', async () => {
    const view = await open('/calculator/log/a');
    await view.user.click(await main().findByRole('button', { name: 'History' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log/a/history');
    const title = await main().findByRole('heading', { level: 2, name: 'Focaccia — edit history' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    const rows = main().getAllByRole('button').filter(button => /^v\d/.test(button.textContent ?? ''));
    expect(rows.map(row => row.querySelector('span > span')?.textContent)).toEqual([
      'v3 · Restored from v1 · current', 'v2 · Edited', 'v1 · Created',
    ]);
    expect(rows[1]).toHaveTextContent('Monday 12 October — 9:45 AM · Anna');
    expect(rows[2]).toHaveTextContent('Monday 12 October — 9:30 AM · Marco');
  });

  it('hands the focus back to History on Back', async () => {
    const view = await open('/calculator/log/a');
    await view.user.click(await main().findByRole('button', { name: 'History' }, LOAD));
    await view.user.click(await backButton());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log/a'); });
    expect(await main().findByRole('button', { name: 'History' })).toHaveFocus();
  });

  it('says «Dough not found.» for the history of a log that is not there', async () => {
    await open('/calculator/log/nope/history');
    expect(await main().findByText('Dough not found.', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('one version', () => {
  it('is drawn like the log: day, date, author, the order of THAT version and its sheet', async () => {
    const view = await open('/calculator/log/a/history');
    await view.user.click(await main().findByRole('button', { name: /^v2 · Edited/ }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log/a/history/2');
    expect(await main().findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD)).toBeInTheDocument();
    expect(main().getByText('v2 · Edited')).toBeInTheDocument();
    expect(main().getByText('Calculated by Anna')).toBeInTheDocument();
    expect(main().getByText('Monday 12 October — 9:45 AM')).toBeInTheDocument();
    expect(main().getByText('3,000 g', { selector: 'span' })).toBeInTheDocument();
    expect(main().getByText('6 pz')).toBeInTheDocument();
  });

  it('offers Restore for a version that is not the current one, and none for the current one', async () => {
    await open('/calculator/log/a/history/1');
    expect(await main().findByRole('button', { name: 'Restore this version' }, LOAD)).toBeInTheDocument();
  });

  it('offers no Restore on the current version', async () => {
    await open('/calculator/log/a/history/3');
    await main().findByText('v3 · Restored from v1 · current', undefined, LOAD);
    expect(main().queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
  });

  it('asks before restoring, and does nothing when the answer is no', async () => {
    const view = await open('/calculator/log/a/history/1');
    await view.user.click(await main().findByRole('button', { name: 'Restore this version' }, LOAD));
    const dialog = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(dialog.getByText('Restore this version? It is added on top as the new current version — the history is kept.')).toBeInTheDocument();
    await view.user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(view.source.saved).toEqual([]);
    expect(pathOf(view)).toBe('/calculator/log/a/history/1');
  });

  it('restores by adding a copy on top, never by cutting the chain, then returns to the history with its title focused', async () => {
    const view = await open('/calculator/log/a/history');
    await view.user.click(await main().findByRole('button', { name: /^v1 · Created/ }, LOAD));
    await view.user.click(await main().findByRole('button', { name: 'Restore this version' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Restore' }));
    await waitFor(() => { expect(view.source.saved).toHaveLength(1); });
    const saved = view.source.saved[0] as unknown as { versions: { kind: string; restoredFrom?: number; calculatedBy: string }[] };
    expect(saved.versions).toHaveLength(4);
    expect(saved.versions[3]).toMatchObject({ kind: 'restore', restoredFrom: 0, calculatedBy: 'Marco' });
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log/a/history'); });
    const title = await main().findByRole('heading', { level: 2, name: 'Focaccia — edit history' }, LOAD);
    await waitFor(() => { expect(title).toHaveFocus(); });
    expect(await main().findByText('v4 · Restored from v1 · current', undefined, LOAD)).toBeInTheDocument();
  });

  it('stays on the version when the log is full, the store having said why', async () => {
    const full = logOf('a', { versions: Array.from({ length: 100 }, (_, i) => versionOf({ kind: i === 0 ? 'create' : 'edit' })) });
    const view = await open('/calculator/log/a/history/1', [full]);
    await view.user.click(await main().findByRole('button', { name: 'Restore this version' }, LOAD));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Focaccia’s log is full: no more changes can be saved to it.', undefined, LOAD)).toBeInTheDocument();
    expect(pathOf(view)).toBe('/calculator/log/a/history/1');
    expect(view.source.saved).toEqual([]);
  });

  it('goes back to the history for a version number the log does not have', async () => {
    const view = await open('/calculator/log/a/history/9');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log/a/history'); });
  });

  it('speaks Italian', async () => {
    const view = await open('/calculator/log/a/history', [chain()], 'it');
    expect(await main().findByRole('heading', { level: 2, name: 'Focaccia — storico modifiche' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: /^v3 · Ripristinata dalla v1 · attuale/ })).toBeInTheDocument();
    expect(main().getByRole('button', { name: /^v2 · Modificata/ })).toBeInTheDocument();
    await view.user.click(main().getByRole('button', { name: /^v1 · Creata/ }));
    expect(await main().findByRole('button', { name: 'Ripristina questa versione' }, LOAD)).toBeInTheDocument();
  });
});

describe('on the tablet\'s split', () => {
  const two = () => [
    logOf('a', { dough: 'Focaccia A', createdAtMs: NOW - 60_000 }),
    logOf('b', { dough: 'Focaccia B', createdAtMs: NOW - 120_000 }),
  ];

  it('shows the list and says what to do on the right while nothing is open', async () => {
    await open('/calculator/log', two());
    expect(await main().findByRole('button', { name: 'Focaccia A' }, LOAD)).toBeInTheDocument();
    expect(main().getByText('Tap a log to see it')).toBeInTheDocument();
  });

  it('keeps the list on screen beside the log that is open, and drops the prompt', async () => {
    split();
    const view = await open('/calculator/log', two());
    await view.user.click(await main().findByRole('button', { name: 'Focaccia A' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log/a');
    expect(await main().findByRole('heading', { level: 2, name: 'Focaccia A' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Focaccia B' })).toBeInTheDocument();
    expect(main().queryByText('Tap a log to see it')).not.toBeInTheDocument();
  });

  it('opens the first log by pushing and the next by replacing, so Back still goes to the list', async () => {
    split();
    const view = await open('/calculator/log', two());
    await view.user.click(await main().findByRole('button', { name: 'Focaccia A' }, LOAD));
    expect(view.router.state.historyAction).toBe('PUSH');
    await view.user.click(main().getByRole('button', { name: 'Focaccia B' }));
    expect(pathOf(view)).toBe('/calculator/log/b');
    expect(view.router.state.historyAction).toBe('REPLACE');
    await view.user.click(await backButton());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    expect(await main().findByText('Tap a log to see it', undefined, LOAD)).toBeInTheDocument();
  });

  it('picks another log from inside a history without leaving a path back through the first', async () => {
    split();
    const view = await open('/calculator/log', two());
    await view.user.click(await main().findByRole('button', { name: 'Focaccia A' }, LOAD));
    await view.user.click(await main().findByRole('button', { name: 'History' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log/a/history');
    await view.user.click(main().getByRole('button', { name: 'Focaccia B' }));
    expect(pathOf(view)).toBe('/calculator/log/b');
    // Back from the replacing log goes to the list (there is nothing behind it that is the list but the entry itself).
    await view.user.click(await backButton());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
  });

  it('marks the open log\'s card', async () => {
    split();
    await open('/calculator/log/a', two());
    const card = (await main().findByRole('button', { name: 'Focaccia A' }, LOAD)).closest('li');
    expect(card).toHaveAttribute('data-open', 'true');
    expect(main().getByRole('button', { name: 'Focaccia B' }).closest('li')).toHaveAttribute('data-open', 'false');
  });

  it('draws the open log, its history and a version on the right, the list staying put', async () => {
    split();
    const view = await open('/calculator/log/a/history/2', [chain()]);
    expect(await main().findByRole('heading', { level: 2, name: 'Focaccia' }, LOAD)).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 2, name: 'Dough history' })).toBeInTheDocument();
    expect(main().getByText('Calculated by Anna')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/calculator/log/a/history/2');
  });
});
