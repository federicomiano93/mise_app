import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { BRIOCHE, FOCACCIA, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// A new work day empties yesterday's numbers: before a tab is first drawn, again when the app comes back to
// the foreground, never while it is on screen — and it says why, for twelve seconds, only for a tab it
// really cleared. The day rolls at 4 am. All the keys are the current app's.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

// Local time on purpose: the work day is counted in the phone's own clock.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

let now = 0;

beforeEach(() => {
  window.localStorage.clear();
  now = at(12, 10);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const stored = (key: string) => window.localStorage.getItem(key);
const NOTE = 'Fields cleared — this is a new day.';

// Everything the current app keeps for the focaccia tab, last used at `stamp`.
function seedFocaccia(stamp: number) {
  const keys: Record<string, string> = {
    'qty-roma::tray': '5', 'qty-roma::slab': '40', 'param-focaccia': '0.8', 'total-focaccia': '300',
    'trays-focaccia': '2', 'extra-focaccia': '1.5', 'extra-unit-focaccia': 'g', 'revealed-focaccia': '1',
    'lock-focaccia': JSON.stringify({ locked: true, logId: 'log-1' }),
    'touched-focaccia': String(stamp),
  };
  for (const [key, value] of Object.entries(keys)) window.localStorage.setItem(key, value);
  return Object.keys(keys);
}

async function open(path = '/calculator/focaccia', config: Record<string, unknown> = configOf({ recipes: [FOCACCIA, BRIOCHE] })) {
  const source = fakeCalculatorSource({ config });
  window.localStorage.setItem('calculator-config', JSON.stringify(config));
  const view = renderCalculator(path, { source });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  await waitFor(() => { expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); }, LOAD);
  return { ...view, source };
}

function comeBack() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

describe('opening the Calculator on a new work day', () => {
  it('has cleared a tab last used yesterday before anything is drawn: every key it kept is gone, the lock too', async () => {
    const keys = seedFocaccia(at(11, 15));
    await open();
    for (const key of keys) expect(stored(key), key).toBeNull();
    const roma = await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(within(roma).getByLabelText('Focaccia tray (500g)')).toHaveValue(0);
    expect(main().getByLabelText('Yeast %')).toHaveValue(0.5);
    expect(main().getByLabelText('Extra dough unit')).toHaveValue('kg');
    expect(main().queryByRole('region', { name: 'Focaccia dough' })).not.toBeInTheDocument();
  });

  it('says why, once', async () => {
    seedFocaccia(at(11, 15));
    await open();
    expect(await main().findByText(NOTE, undefined, LOAD)).toBeInTheDocument();
    expect(main().getAllByText(NOTE)).toHaveLength(1);
  });

  it('keeps a tab last used today', async () => {
    seedFocaccia(at(12, 8));
    await open();
    const roma = await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(within(roma).getByLabelText('Focaccia tray (500g)')).toHaveValue(5);
    expect(stored('lock-focaccia')).not.toBeNull();
    expect(main().queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('counts the work day from 4 am: a dough made at 23:30 and read at 01:00 is the same night\'s work', async () => {
    seedFocaccia(at(11, 23, 30));
    now = at(12, 1);
    await open();
    const roma = await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(within(roma).getByLabelText('Focaccia tray (500g)')).toHaveValue(5);
    expect(main().queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('…but read at 04:30 it is a new day', async () => {
    seedFocaccia(at(11, 23, 30));
    now = at(12, 4, 30);
    await open();
    expect(await main().findByText(NOTE, undefined, LOAD)).toBeInTheDocument();
    expect(stored('qty-roma::tray')).toBeNull();
  });

  it('says nothing for a tab nobody used: there was nothing to clear', async () => {
    await open();
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(main().queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('says it only on the tab it cleared', async () => {
    seedFocaccia(at(11, 15));
    window.localStorage.setItem('total-brioche', '900');
    window.localStorage.setItem('touched-brioche', String(at(12, 9)));
    const { user } = await open();
    expect(await main().findByText(NOTE, undefined, LOAD)).toBeInTheDocument();
    await user.click(main().getByRole('tab', { name: 'Brioche' }));
    expect(main().getByLabelText('Total dough (g)')).toHaveValue(900);
    expect(main().queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('forgets the tab with the same list the Reset will use: nothing but the keys of the tab', async () => {
    seedFocaccia(at(11, 15));
    window.localStorage.setItem('qty-roma::other', '3');
    window.localStorage.setItem('param-brioche', '4');
    window.localStorage.setItem('mise.calcZoomStep', '3');
    await open();
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(stored('param-brioche')).toBe('4');
    expect(stored('mise.calcZoomStep')).toBe('3');
    expect(stored('qty-roma::other')).toBe('3');
  });
});

describe('the note', () => {
  it('goes after twelve seconds', async () => {
    seedFocaccia(at(11, 15));
    await open();
    expect(await main().findByText(NOTE, undefined, LOAD)).toBeInTheDocument();
    // Testing Library's own waiting needs real timeouts, so they are faked only from here: the note's timer is
    // re-armed by the next redraw of the tab (here, a colleague's tab being cleared as the app comes back).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.localStorage.setItem('touched-brioche', String(at(11, 9)));
    now += 1_000;
    comeBack();
    act(() => { now += 10_999; vi.advanceTimersByTime(10_999); });
    expect(main().queryByText(NOTE)).toBeInTheDocument();
    act(() => { now += 2; vi.advanceTimersByTime(2); });
    expect(main().queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('survives the configuration arriving again in that time', async () => {
    seedFocaccia(at(11, 15));
    const { source } = await open();
    expect(await main().findByText(NOTE, undefined, LOAD)).toBeInTheDocument();
    act(() => { source.config = configOf({ recipes: [FOCACCIA, BRIOCHE], logRetentionHours: 48 }); source.push(); });
    expect(main().getByText(NOTE)).toBeInTheDocument();
    expect(main().getAllByText(NOTE)).toHaveLength(1);
  });

  it('is in Italian', async () => {
    seedFocaccia(at(11, 15));
    const config = configOf({ recipes: [FOCACCIA, BRIOCHE] });
    window.localStorage.setItem('calculator-config', JSON.stringify(config));
    renderCalculator('/calculator/focaccia', { source: fakeCalculatorSource({ config }), lang: 'it' });
    expect(await screen.findByText('Campi azzerati — è un giorno nuovo.', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('coming back to the app the next morning', () => {
  it('clears the tab on screen when the app comes back to the foreground', async () => {
    seedFocaccia(at(12, 9));
    await open();
    const roma = await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(within(roma).getByLabelText('Focaccia tray (500g)')).toHaveValue(5);

    now = at(13, 8);
    comeBack();
    expect(within(roma).getByLabelText('Focaccia tray (500g)')).toHaveValue(0);
    expect(stored('qty-roma::tray')).toBeNull();
    expect(stored('lock-focaccia')).toBeNull();
    expect(main().getByText(NOTE)).toBeInTheDocument();
  });

  it('NEVER empties a tab under somebody\'s fingers: time passing is not enough', async () => {
    seedFocaccia(at(12, 9));
    const { source } = await open();
    const roma = await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    now = at(13, 8);
    act(() => { source.push(); });
    expect(within(roma).getByLabelText('Focaccia tray (500g)')).toHaveValue(5);
    expect(stored('qty-roma::tray')).toBe('5');
  });

  it('does not clear when the app goes to the background', async () => {
    seedFocaccia(at(12, 9));
    await open();
    const roma = await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    now = at(13, 8);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(within(roma).getByLabelText('Focaccia tray (500g)')).toHaveValue(5);
  });

  // The current app's resetTabFields puts the divisor select back to 0 with the rest of the day's numbers.
  it('puts the divisor back to 0 with the rest of the numbers, so the next Confirm does not save yesterday\'s split', async () => {
    seedFocaccia(at(12, 9));
    window.localStorage.setItem('lock-focaccia', JSON.stringify({ locked: false, logId: null }));
    const config = configOf({ recipes: [FOCACCIA, BRIOCHE], divisorIncluded: { focaccia: ['tray'] } });
    const { user, source } = await open('/calculator/focaccia', config);
    await user.selectOptions(await main().findByLabelText('Number of crates', undefined, LOAD), '3');
    expect(main().getByLabelText('Number of crates')).toHaveValue('3');

    now = at(13, 8);
    comeBack();
    const roma = main().getByRole('region', { name: 'Cafe Roma' });
    expect(main().queryByLabelText('Number of crates')).not.toBeInTheDocument();
    await user.click(within(roma).getByLabelText('Focaccia tray (500g)'));
    await user.keyboard('4');
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Save this dough for:' })).getByRole('button', { name: 'Today' }));
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect(main().getByLabelText('Number of crates')).toHaveValue('0');
    expect((source.saved[0] as any).versions[0].sheet.divisor).toMatchObject({ n: 0 });
  });

  it('stops listening when the Calculator is left', async () => {
    seedFocaccia(at(12, 9));
    const { router } = await open();
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await act(async () => { await router.navigate('/more'); });
    now = at(13, 8);
    comeBack();
    expect(stored('qty-roma::tray')).toBe('5');
  });
});
