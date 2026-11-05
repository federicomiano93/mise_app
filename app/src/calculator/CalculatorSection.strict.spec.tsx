import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { BRIOCHE, FOCACCIA, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The app runs under React's StrictMode in development: every component is mounted, unmounted and mounted
// again, and every effect runs twice. The store is started, stopped and started again by its provider, and the
// new-day sweep runs twice — none of that may double a watcher, lose the note or clear a tab twice.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./CalculatorSection');
}, 60_000);

afterAll(() => {
  configure({ reactStrictMode: false });
});

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('revealed-brioche', '1');
  vi.spyOn(Date, 'now').mockReturnValue(at(12, 10));
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));

describe('under StrictMode: the Calculator', () => {
  it('draws the tabs, takes a number and shows the recipe', async () => {
    const { user } = renderCalculator('/calculator/brioche', {
      source: fakeCalculatorSource({ config: configOf({ recipes: [FOCACCIA, BRIOCHE] }) }),
    });
    const box = await main().findByLabelText('Total dough (g)', undefined, LOAD);
    await user.click(box);
    await user.keyboard('1000');
    expect(main().getByText('1,000 g raw')).toBeInTheDocument();
    expect(window.localStorage.getItem('total-brioche')).toBe('1000');
    expect(main().getAllByRole('tab')).toHaveLength(2);
  });

  it('keeps the «new day» note once, and clears the tab once', async () => {
    window.localStorage.setItem('total-brioche', '900');
    window.localStorage.setItem('touched-brioche', String(at(11, 15)));
    renderCalculator('/calculator/brioche', {
      source: fakeCalculatorSource({ config: configOf({ recipes: [FOCACCIA, BRIOCHE] }) }),
    });
    expect(await main().findByText('Fields cleared — this is a new day.', undefined, LOAD)).toBeInTheDocument();
    expect(main().getAllByText('Fields cleared — this is a new day.')).toHaveLength(1);
    expect(main().getByLabelText('Total dough (g)')).toHaveValue(0);
    expect(window.localStorage.getItem('total-brioche')).toBeNull();
  });
});

describe('under StrictMode: Settings', () => {
  it('saves a switch once, and an editing screen once, with the question asked once', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    const { user, router } = renderCalculator('/calculator/settings', { source });
    await user.click(await main().findByRole('switch', { name: 'Ask which day the dough is for' }, LOAD));
    await vi.waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });

    await user.click(main().getByRole('button', { name: /^Extra dough/ }));
    await user.click(await main().findByRole('switch', { name: 'Brioche' }, LOAD));
    await user.click(main().getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Save these changes?' }, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => { expect(router.state.location.pathname).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toHaveLength(2);
    expect(source.savedConfigs[1]).toMatchObject({ askDoughDay: false, extraDough: { brioche: false } });
  });
});

describe('under StrictMode: the Dough history editors', () => {
  it('Add dough writes one log, with the question asked once', async () => {
    const source = fakeCalculatorSource({ config: configOf({ recipes: [FOCACCIA, BRIOCHE] }) });
    const { user, router } = renderCalculator('/calculator/log/new', { source });
    await user.click(await main().findByRole('button', { name: 'Brioche' }, LOAD));
    await user.click(main().getByRole('button', { name: 'Today' }));
    await user.click(main().getAllByRole('button', { name: 'Save' }).at(-1)!);
    const dialog = await screen.findByRole('alertdialog', { name: 'Save this dough?' }, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => { expect(router.state.location.pathname).toBe('/calculator/log'); });
    expect(source.saved).toHaveLength(1);
  });

  it('Edit dough takes its copy once: what is typed survives, and Save appends one version', async () => {
    const log = {
      id: 'hand', bakery: 'bakery', dough: 'Focaccia', recipeId: 'focaccia', forDay: 'today', origin: 'manual',
      createdAtMs: at(12, 9),
      versions: [{
        kind: 'create', calculatedBy: 'Marco', at: { date: 'Monday 12 October', time: '9:30 AM' }, occasional: [], text: '',
        items: [{ id: 'tray', name: 'Focaccia tray', clientName: 'Cafe Roma', qty: 4, weightG: 500, kind: 'number', crate: { show: false, perBox: 20 } }],
        sheet: { dough: 'Focaccia', recipeId: 'focaccia', param: null, total_g: 2000, extra_g: 0, ingredients: [], divisor: null, crates: [] },
        recipe: null,
      }],
    };
    const source = fakeCalculatorSource({ config: configOf({ recipes: [FOCACCIA, BRIOCHE], logRetentionHours: 24 }), logs: [log] });
    const { user, router } = renderCalculator('/calculator/log/hand/edit', { source });
    const by = await main().findByLabelText('Calculated by', undefined, LOAD);
    await user.type(by, '!');
    expect(by).toHaveValue('Marco!');
    await user.click(main().getAllByRole('button', { name: 'Save' }).at(-1)!);
    const dialog = await screen.findByRole('alertdialog', { name: 'Save these changes as a new version?' }, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => { expect(router.state.location.pathname).toBe('/calculator/log/hand'); });
    expect(source.saved).toHaveLength(1);
    expect((source.saved[0] as unknown as { versions: unknown[] }).versions).toHaveLength(2);
  });
});
