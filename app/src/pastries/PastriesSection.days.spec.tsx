import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { WEEKDAYS } from '@mise/shared/pastries-model';
import { fakePastriesSource } from '../testing/fakePastriesSource';
import { dayDoc, freezeClock, logDoc, renderPastries } from '../testing/renderPastries';
import { SCREEN_EVENT } from '../telemetry/usage';

// The frame of Pastries and its days: which day opens, the days' tab list, and what each day shows.
// jsdom applies no media query and none of the module CSS, so the strip and the split are the same
// buttons here; what differs between them is CSS only (split.spec.ts reads it).

// The section is its own chunk, fetched on first use: load it once so no spec waits for the
// transform.
beforeAll(async () => { await import('./PastriesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };
const days = () => screen.findByRole('tablist', { name: 'Days' }, LOAD);
const tab = (name: string) => screen.getByRole('tab', { name });
const selectedTab = () => screen.getByRole('tab', { selected: true });
const panel = () => screen.getByRole('tabpanel');

describe('Pastries: which day opens', () => {
  it('opens on the day being proved for: tomorrow, said so', async () => {
    renderPastries('/pastries');
    await days();
    expect(selectedTab()).toHaveAccessibleName('Thursday');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Thursday' })).toBeInTheDocument();
    expect(within(panel()).getByText('Tomorrow · to prove')).toBeInTheDocument();
  });

  it('opens on the next day once the work day has rolled over at 4am', async () => {
    freezeClock(new Date(2026, 9, 15, 5, 0, 0));
    renderPastries('/pastries');
    await days();
    expect(selectedTab()).toHaveAccessibleName('Friday');
  });

  it('is still the work day before 4am: 02:00 opens on the same day as the evening before', async () => {
    freezeClock(new Date(2026, 9, 15, 2, 0, 0));
    renderPastries('/pastries');
    await days();
    expect(selectedTab()).toHaveAccessibleName('Thursday');
  });

  it('subtitles every other day «To prove»', async () => {
    renderPastries('/pastries/Monday');
    await days();
    expect(within(panel()).getByText('To prove')).toBeInTheDocument();
    expect(within(panel()).queryByText('Tomorrow · to prove')).not.toBeInTheDocument();
  });

  it('opens on the day in the address', async () => {
    renderPastries('/pastries/Tuesday');
    await days();
    expect(selectedTab()).toHaveAccessibleName('Tuesday');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Tuesday' })).toBeInTheDocument();
  });

  // The marked day must not jump under a finger at 4am: it is worked out when Pastries opens.
  it('keeps the opening day marked after 4am passes while it is open', async () => {
    const { user } = renderPastries('/pastries');
    await days();
    expect(tab('Thursday')).toHaveAccessibleDescription(/Tomorrow/);

    vi.setSystemTime(new Date(2026, 9, 15, 5, 0, 0));
    await user.click(tab('Friday'));
    await user.click(tab('Thursday'));

    expect(tab('Thursday')).toHaveAccessibleDescription(/Tomorrow/);
    expect(tab('Friday')).not.toHaveAccessibleDescription(/Tomorrow/);
    expect(within(panel()).getByText('Tomorrow · to prove')).toBeInTheDocument();
  });

  it.each(['/pastries/Funday', '/pastries/tuesday', '/pastries/Tuesday/delete', '/pastries/records/edit'])(
    'sends %s back to the start of Pastries',
    async path => {
      const { router } = renderPastries(path);
      await days();
      expect(router.state.location.pathname).toBe('/pastries');
      expect(selectedTab()).toHaveAccessibleName('Thursday');
    },
  );
});

describe('Pastries: the days', () => {
  it('lists the seven days, Monday first, as a tab list with a name', async () => {
    renderPastries();
    const list = await days();
    expect(within(list).getAllByRole('tab').map(node => node.getAttribute('aria-label')))
      .toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  });

  it('draws the short label from the dictionary and names the tab by the full weekday', async () => {
    renderPastries();
    await days();
    expect(within(tab('Wednesday')).getByText('Wed')).toBeInTheDocument();
    expect(tab('Wednesday')).toHaveAccessibleName('Wednesday');
  });

  it('puts only the selected day in the Tab order', async () => {
    renderPastries('/pastries/Tuesday');
    await days();
    const stops = screen.getAllByRole('tab').filter(node => node.tabIndex === 0);
    expect(stops).toEqual([tab('Tuesday')]);
  });

  it('ties the selected day to its panel and the panel to the day', async () => {
    renderPastries('/pastries/Tuesday');
    await days();
    expect(tab('Tuesday')).toHaveAttribute('aria-controls', panel().id);
    expect(panel()).toHaveAttribute('aria-labelledby', tab('Tuesday').id);
    expect(tab('Monday')).not.toHaveAttribute('aria-controls');
  });

  // At 296px seven days do not fit and the strip scrolls sideways: the chosen day must not wait
  // off its edge. (jsdom has no scrollIntoView, so there is one to watch.)
  it('brings the chosen day into view', async () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      renderPastries('/pastries/Sunday');
      await days();
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      expect(scroll.mock.contexts.at(-1)).toBe(tab('Sunday'));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('is a row on a phone and a column on the split', async () => {
    renderPastries();
    expect(await days()).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('says vertical on the split', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
    renderPastries();
    expect(await days()).toHaveAttribute('aria-orientation', 'vertical');
  });

  describe('counts, markers and quieter empty days', () => {
    it('says how many kinds of pastry each day holds', async () => {
      const source = fakePastriesSource({
        days: [
          dayDoc('Monday', [['Cornetti', 24], ['Krapfen', 12], ['Brioche', 8]]),
          dayDoc('Tuesday', [['Cornetti', 10]]),
        ],
      });
      renderPastries('/pastries', { source });
      await days();
      await vi.waitFor(() => { expect(tab('Monday')).toHaveAccessibleDescription('3 pastries'); });
      expect(tab('Tuesday')).toHaveAccessibleDescription('1 pastry');
      expect(tab('Wednesday')).toHaveAccessibleDescription('Nothing yet');
      expect(within(tab('Monday')).getByText('3', { selector: 'span[aria-hidden]' })).toBeInTheDocument();
    });

    it('draws an empty day quieter, and a day with something in it as usual', async () => {
      renderPastries('/pastries', { source: fakePastriesSource({ days: [dayDoc('Monday', [['Cornetti', 24]])] }) });
      await days();
      await vi.waitFor(() => { expect(tab('Monday')).toHaveAttribute('data-empty', 'false'); });
      expect(tab('Tuesday')).toHaveAttribute('data-empty', 'true');
    });

    it('marks the opening day, and says so in its description', async () => {
      renderPastries();
      await days();
      expect(tab('Thursday')).toHaveAccessibleDescription(/Tomorrow/);
      expect(within(tab('Thursday')).getByText('Tomorrow')).toBeInTheDocument();
      expect(tab('Friday')).not.toHaveAccessibleDescription(/Tomorrow/);
    });

    it('ticks a day that is recorded tonight', async () => {
      renderPastries('/pastries', { source: fakePastriesSource({ logs: [logDoc('Monday', [['Cornetti', 24]])] }) });
      await days();
      await vi.waitFor(() => { expect(tab('Monday')).toHaveAccessibleDescription(/Confirmed/); });
      expect(tab('Tuesday')).not.toHaveAccessibleDescription(/Confirmed/);
      expect(within(tab('Monday')).getByText('Confirmed')).toBeInTheDocument();
    });

    it('follows the data as it changes, in place', async () => {
      const source = fakePastriesSource();
      renderPastries('/pastries', { source });
      await days();
      expect(tab('Tuesday')).toHaveAccessibleDescription('Nothing yet');

      source.days.set('Tuesday', dayDoc('Tuesday', [['Cornetti', 24], ['Krapfen', 6]]));
      act(() => { source.push(); });

      expect(tab('Tuesday')).toHaveAccessibleDescription('2 pastries');
    });
  });
});

describe('Pastries: picking a day', () => {
  it('replaces the address instead of adding to the history', async () => {
    const { router, user } = renderPastries('/pastries');
    await days();
    await user.click(tab('Tuesday'));
    expect(router.state.location.pathname).toBe('/pastries/Tuesday');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(selectedTab()).toHaveAccessibleName('Tuesday');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Tuesday' })).toBeInTheDocument();
  });

  it('lets Back leave Pastries in one step, however many days were looked at', async () => {
    const { router, user } = renderPastries('/orders');
    await user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Pastries' }));
    await days();
    await user.click(tab('Tuesday'));
    await user.click(tab('Wednesday'));
    await user.click(tab('Sunday'));
    expect(router.state.location.pathname).toBe('/pastries/Sunday');

    await act(async () => { await router.navigate(-1); });

    expect(router.state.location.pathname).toBe('/orders');
  });

  it('does nothing when the day picked is the one shown', async () => {
    const { router, user } = renderPastries('/pastries');
    await days();
    const before = router.state.location.key;
    await user.click(tab('Thursday'));
    expect(router.state.location.key).toBe(before);
  });

  it('keeps the focus on the day that was pressed, not on the page title or in the panel', async () => {
    const { user } = renderPastries('/pastries');
    await days();
    await user.click(tab('Tuesday'));
    expect(tab('Tuesday')).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
  });
});

describe('Pastries: the days with the keyboard', () => {
  async function focusTab(name: string) {
    const view = renderPastries('/pastries/Wednesday');
    await days();
    act(() => { tab(name).focus(); });
    return view;
  }

  it.each([
    ['{ArrowRight}', 'Thursday'],
    ['{ArrowDown}', 'Thursday'],
    ['{ArrowLeft}', 'Tuesday'],
    ['{ArrowUp}', 'Tuesday'],
    ['{Home}', 'Monday'],
    ['{End}', 'Sunday'],
  ])('%s from Wednesday selects %s and moves the focus there', async (keys, expected) => {
    const { user } = await focusTab('Wednesday');
    await user.keyboard(keys);
    expect(selectedTab()).toHaveAccessibleName(expected);
    expect(tab(expected)).toHaveFocus();
    expect(tab(expected).tabIndex).toBe(0);
    expect(tab('Wednesday').tabIndex).toBe(-1);
  });

  it('wraps from Sunday to Monday and from Monday to Sunday', async () => {
    const { user } = renderPastries('/pastries/Sunday');
    await days();
    act(() => { tab('Sunday').focus(); });
    await user.keyboard('{ArrowRight}');
    expect(selectedTab()).toHaveAccessibleName('Monday');
    expect(tab('Monday')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(selectedTab()).toHaveAccessibleName('Sunday');
    expect(tab('Sunday')).toHaveFocus();
  });

  it('keeps working key after key, because the focus stays in the list', async () => {
    const { user, router } = await focusTab('Wednesday');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(tab('Saturday')).toHaveFocus();
    expect(router.state.location.pathname).toBe('/pastries/Saturday');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('leaves the browser\'s own shortcuts alone (Alt+Left is Back)', async () => {
    const { user, router } = await focusTab('Wednesday');
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    expect(router.state.location.pathname).toBe('/pastries/Wednesday');
    expect(selectedTab()).toHaveAccessibleName('Wednesday');
  });

  it('does not take the Tab key', async () => {
    const { user } = await focusTab('Wednesday');
    await user.tab();
    expect(tab('Wednesday')).not.toHaveFocus();
    expect(selectedTab()).toHaveAccessibleName('Wednesday');
  });
});

describe('Pastries: the status message', () => {
  it('has its live region on the page, empty, before anything is said', async () => {
    renderPastries();
    await days();
    const region = document.querySelector('[role="status"][class*="region"]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
  });
});

describe('Pastries: in Italian', () => {
  it('draws the days, the short labels and the subtitle in Italian', async () => {
    renderPastries('/pastries', { lang: 'it' });
    const list = await screen.findByRole('tablist', { name: 'Giorni' }, LOAD);
    expect(within(list).getAllByRole('tab').map(node => node.getAttribute('aria-label')))
      .toEqual(['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']);
    expect(within(tab('Giovedì')).getByText('Gio')).toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName('Giovedì');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Giovedì' })).toBeInTheDocument();
    expect(within(panel()).getByText('Domani · da mettere')).toBeInTheDocument();
    expect(tab('Giovedì')).toHaveAccessibleDescription('Ancora niente, Domani');
  });

  it('says the count in Italian, one and many', async () => {
    renderPastries('/pastries', {
      lang: 'it',
      source: fakePastriesSource({
        days: [dayDoc('Monday', [['Cornetti', 4]]), dayDoc('Tuesday', [['Cornetti', 4], ['Krapfen', 2]])],
      }),
    });
    await screen.findByRole('tablist', { name: 'Giorni' }, LOAD);
    await vi.waitFor(() => { expect(tab('Lunedì')).toHaveAccessibleDescription('1 pasta'); });
    expect(tab('Martedì')).toHaveAccessibleDescription('2 paste');
  });
});

describe('Pastries: what the usage record hears', () => {
  let heard: string[];
  const listener = (event: Event) => { heard.push(String((event as CustomEvent).detail)); };

  beforeEach(() => {
    heard = [];
    window.addEventListener(SCREEN_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(SCREEN_EVENT, listener);
  });

  it('names the section `pastries` and does not count a day picked as a new screen', async () => {
    const { user } = renderPastries('/pastries');
    await days();
    await user.click(tab('Tuesday'));
    await user.click(tab('Wednesday'));
    expect(heard.filter(name => name.startsWith('pastries'))).toEqual(['pastries', 'pastries', 'pastries']);
    expect(new Set(heard)).toEqual(new Set(['pastries']));
  });

  it('names Records and the editor as screens of their own', async () => {
    const { user } = renderPastries('/pastries');
    await days();
    await user.click(screen.getByRole('link', { name: 'Records' }));
    await screen.findByRole('heading', { level: 2, name: 'Records' });
    expect(heard.at(-1)).toBe('pastries-records');
  });
});

describe('Pastries: the screens that arrive in the next slice', () => {
  it('opens Records from the day, says it is coming, and Back returns to the same day', async () => {
    const { router, user } = renderPastries('/pastries/Tuesday');
    await days();
    await user.click(screen.getByRole('link', { name: 'Records' }));

    expect(router.state.location.pathname).toBe('/pastries/records');
    expect(await screen.findByText('Records will arrive in the next step of Mise 2.')).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    // No day is chosen on Records, but the list is still one stop of the keyboard.
    expect(screen.queryByRole('tab', { selected: true })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').filter(node => node.tabIndex === 0)).toEqual([tab('Thursday')]);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/pastries/Tuesday');
    expect(selectedTab()).toHaveAccessibleName('Tuesday');
  });

  it('opens the editor of a day, says it is coming, and Back returns to the day', async () => {
    const { router, user } = renderPastries('/pastries/Tuesday');
    await days();
    await user.click(screen.getByRole('button', { name: 'Edit Tuesday' }));

    expect(router.state.location.pathname).toBe('/pastries/Tuesday/edit');
    expect(await screen.findByText('Editing Tuesday will arrive in the next step of Mise 2.')).toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName('Tuesday');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/pastries/Tuesday');
  });

  it('goes to the day when Records was opened by its address and there is nothing to go back to', async () => {
    const { router, user } = renderPastries('/pastries/records');
    await days();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/pastries');
  });

  it('picks a day from Records, replacing it', async () => {
    const { router, user } = renderPastries('/pastries/records');
    await days();
    await user.click(tab('Friday'));
    expect(router.state.location.pathname).toBe('/pastries/Friday');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Friday' })).toBeInTheDocument();
  });

  it('is the same list of days on the editor', async () => {
    renderPastries('/pastries/Sunday/edit');
    await days();
    expect(screen.getAllByRole('tab')).toHaveLength(WEEKDAYS.length);
    expect(selectedTab()).toHaveAccessibleName('Sunday');
    expect(selectedTab()).not.toHaveAttribute('aria-controls');
  });
});
