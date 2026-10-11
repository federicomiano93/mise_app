import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { ACTION_EVENT } from '../telemetry/usage';
import { fakePastriesSource } from '../testing/fakePastriesSource';
import type { FakePastriesSource } from '../testing/fakePastriesSource';
import { holdDays } from '../testing/holdAnswers';
import { WORK_DATE, dayDoc, freezeClock, logDoc, renderPastries } from '../testing/renderPastries';
import type { PastriesStore } from './pastriesStore';

// A day's list, the one-number correction, Confirm and the lock. Everything runs against the real
// store on an in-memory source; the clock is Wednesday 14 October 2026, 21:00, so the day being
// proved for is Thursday and tonight's work date is 2026-10-14.

// The real store, handed out so a spec can make it answer «that row has changed» — which only a
// race between two renders can do, and a spec cannot stage a race.
const captured = vi.hoisted(() => ({ store: null as PastriesStore | null }));
vi.mock('./pastriesStore', async importOriginal => {
  const actual = await importOriginal<typeof import('./pastriesStore')>();
  return {
    ...actual,
    createPastriesStore: (...args: Parameters<typeof actual.createPastriesStore>) => {
      const store = actual.createPastriesStore(...args);
      captured.store = store;
      return store;
    },
  };
});

beforeAll(async () => { await import('./PastriesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };
const THURSDAY = [['Cornetti', 24], ['Krapfen', 12], ['Sfogliatelle', 8]] as const;

function seeded(note = '') {
  return fakePastriesSource({ days: [dayDoc('Thursday', THURSDAY, note)] });
}

// The row button of a pastry: its name and its number are one button.
const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const rowReady = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) }, LOAD);
const box = (name: string) => screen.getByRole('spinbutton', { name: `New quantity for ${name}` });
const tick = (name: string) => screen.queryByRole('button', { name: `Confirm the new quantity for ${name}` });
// A hidden element has no accessible name, so the label is the way to find it.
const hiddenTick = (name: string) => screen.getByLabelText(`Confirm the new quantity for ${name}`);
const confirmButton = () => screen.queryByRole('button', { name: 'Confirm' });
const editButton = () => screen.queryByRole('button', { name: 'Edit' });
// The «Confirmed» mark is always built and hidden while the day is open, so ask whether it shows.
// (The day's tab says «Confirmed» as well; this is the one in the panel.)
const doneMark = () => within(screen.getByRole('tabpanel')).getByText('Confirmed');
const dialog = (name: string) => screen.findByRole('alertdialog', { name });
const region = () => document.querySelector('[role="status"][class*="region"]');

// What the list shows now, as «Cornetti 24» pairs.
const rowsShown = () => screen.getAllByRole('listitem').map(item => item.firstElementChild?.textContent);

async function open(source: FakePastriesSource = seeded(), path = '/pastries') {
  const view = renderPastries(path, { source });
  await rowReady('Cornetti');
  return view;
}

describe('a day\'s list', () => {
  it('shows each pastry with its number, in the order of the list', async () => {
    await open();
    expect(rowsShown()).toEqual(['Cornetti24', 'Krapfen12', 'Sfogliatelle8']);
  });

  it('is a list of plain buttons: nothing is a field until a row is tapped', async () => {
    await open();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(row('Cornetti')).toHaveAttribute('aria-expanded', 'false');
  });

  it('says so when the day is empty, and points at the pencil', async () => {
    renderPastries('/pastries');
    expect(await screen.findByText('Nothing to prove for Thursday yet.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Tap the pencil to add.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows the standing note under the list, with its line breaks', async () => {
    await open(seeded('Butter is low.\nCheck the fridge.'));
    expect(screen.getByText('Note')).toBeInTheDocument();
    const note = screen.getByText(/Butter is low\./);
    expect(note.textContent).toBe('Butter is low.\nCheck the fridge.');
  });

  it('shows no note block when there is no note', async () => {
    await open();
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
  });

  it('shows another day\'s list when the day changes', async () => {
    const source = fakePastriesSource({
      days: [dayDoc('Thursday', THURSDAY), dayDoc('Monday', [['Brioche', 6]])],
    });
    const { user } = await open(source);
    await user.click(screen.getByRole('tab', { name: /^Monday/ }));
    expect(await rowReady('Brioche')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cornetti/ })).not.toBeInTheDocument();
  });

  it('follows another phone\'s change in place', async () => {
    const source = seeded();
    await open(source);
    source.days.set('Thursday', dayDoc('Thursday', [['Cornetti', 30], ['Krapfen', 12], ['Sfogliatelle', 8]]));
    act(() => { source.push(); });
    expect(rowsShown()).toEqual(['Cornetti30', 'Krapfen12', 'Sfogliatelle8']);
  });

  it('draws the numbers in same-width digits, and bigger on the split', async () => {
    await open();
    const css = Object.values(import.meta.glob<string>('./PastryRow.module.css', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
    expect(css).toMatch(/\.qty\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/@media \(min-width: 1000px\)[\s\S]*\.qty\s*\{[^}]*font-size:\s*var\(--fs-3xl\)/);
  });

  it('keeps the note\'s line breaks in the stylesheet too', () => {
    const css = Object.values(import.meta.glob<string>('./DayPanel.module.css', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
    expect(css).toMatch(/\.noteText\s*\{[^}]*white-space:\s*pre-line/);
  });
});

describe('correcting one number', () => {
  it('opens an EMPTY box under the tapped row, focused, with the usual hint and no tick', async () => {
    const { user } = await open();
    await user.click(row('Cornetti'));

    const input = box('Cornetti');
    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute('placeholder', '0');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '9999');
    expect(input).toHaveFocus();
    expect(row('Cornetti')).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAccessibleDescription('type a number');
    // The tick is always built and hidden until the number is usable.
    expect(tick('Cornetti')).not.toBeInTheDocument();
    expect(hiddenTick('Cornetti')).toHaveAttribute('hidden');
  });

  it('shows the current number before the arrow', async () => {
    const { user } = await open();
    await user.click(row('Cornetti'));
    expect(screen.getByText('24 →')).toBeInTheDocument();
  });

  it.each([
    ['24', 'same as now', false],
    ['0', 'must be at least 1', false],
    ['-4', 'must be at least 1', false],
    ['10000', 'too many', false],
    ['30', '', true],
    ['1', '', true],
    ['9999', '', true],
  ])('typing %s says «%s» and the tick is shown: %s', async (typed, hint, usable) => {
    const { user } = await open();
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), typed);

    expect(tick('Cornetti') !== null).toBe(usable);
    if (hint) expect(box('Cornetti')).toHaveAccessibleDescription(hint);
    else expect(box('Cornetti')).not.toHaveAccessibleDescription();
  });

  it('writes the number on the tick, says so, and closes the row', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30');
    await user.click(tick('Cornetti')!);

    expect(await screen.findByText('Cornetti: 30.')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(rowsShown()).toEqual(['Cornetti30', 'Krapfen12', 'Sfogliatelle8']);
    await waitFor(() => { expect(source.saveDay).toHaveBeenCalledTimes(1); });
    expect(source.days.get('Thursday')?.items).toEqual([
      { name: 'Cornetti', qty: 30 }, { name: 'Krapfen', qty: 12 }, { name: 'Sfogliatelle', qty: 8 },
    ]);
  });

  it('writes the number on Enter', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(row('Krapfen'));
    await user.type(box('Krapfen'), '20{Enter}');

    expect(await screen.findByText('Krapfen: 20.')).toBeInTheDocument();
    expect(rowsShown()).toEqual(['Cornetti24', 'Krapfen20', 'Sfogliatelle8']);
  });

  it('does nothing on Enter when the number is not usable', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(row('Krapfen'));
    await user.type(box('Krapfen'), '12{Enter}');

    expect(source.saveDay).not.toHaveBeenCalled();
    expect(box('Krapfen')).toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();
  });

  it('keeps the other rows\' numbers and the note when one number is written', async () => {
    const source = seeded('Butter is low.');
    const { user } = await open(source);
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30{Enter}');
    await waitFor(() => { expect(source.saveDay).toHaveBeenCalledTimes(1); });
    expect(source.saveDay).toHaveBeenCalledWith(
      'Thursday',
      [{ name: 'Cornetti', qty: 30 }, { name: 'Krapfen', qty: 12 }, { name: 'Sfogliatelle', qty: 8 }],
      'Butter is low.',
    );
  });

  it('refuses a row that is no longer the one typed into, and says so', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30');
    vi.spyOn(captured.store!, 'setItemQuantity').mockReturnValueOnce(false);
    await user.click(tick('Cornetti')!);

    expect(await screen.findByText('That row has changed — check the list.')).toBeInTheDocument();
    expect(screen.queryByText('Cornetti: 30.')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(rowsShown()).toEqual(['Cornetti24', 'Krapfen12', 'Sfogliatelle8']);
  });

  it('has one row open at a time', async () => {
    const { user } = await open();
    await user.click(row('Cornetti'));
    await user.click(row('Krapfen'));

    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    expect(box('Krapfen')).toHaveFocus();
    expect(row('Cornetti')).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the open row when it is tapped again', async () => {
    const { user } = await open();
    await user.click(row('Cornetti'));
    await user.click(row('Cornetti'));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('gives a typed number back when the row is opened again', async () => {
    const { user } = await open();
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30');
    await user.click(row('Cornetti'));
    await user.click(row('Cornetti'));
    expect(box('Cornetti')).toHaveValue(30);
  });

  it('drops the typed number once it is written', async () => {
    const { user } = await open();
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30{Enter}');
    await user.click(row('Cornetti'));
    expect(box('Cornetti')).toHaveValue(null);
  });

  it('holds a reload the app starts by itself while a number is typed, and not otherwise', async () => {
    const { user } = await open();
    expect(isBusy()).toBe(false);
    await user.click(row('Cornetti'));
    expect(isBusy()).toBe(false);
    await user.type(box('Cornetti'), '3');
    expect(isBusy()).toBe(true);
    await user.clear(box('Cornetti'));
    expect(isBusy()).toBe(false);
    await user.type(box('Cornetti'), '30{Enter}');
    expect(isBusy()).toBe(false);
  });

  describe('when another phone writes while a number is being typed', () => {
    it('keeps the typed number, the open row and the focus', async () => {
      const source = seeded();
      const { user } = await open(source);
      await user.click(row('Cornetti'));
      await user.type(box('Cornetti'), '30');

      source.days.set('Thursday', dayDoc('Thursday', [['Cornetti', 24], ['Krapfen', 15], ['Sfogliatelle', 8]]));
      act(() => { source.push(); });

      expect(rowsShown()).toEqual(['Cornetti24', 'Krapfen15', 'Sfogliatelle8']);
      expect(box('Cornetti')).toHaveValue(30);
      expect(box('Cornetti')).toHaveFocus();
      expect(tick('Cornetti')).toBeInTheDocument();
    });

    it('keeps the number with its pastry when the list is reordered, not with its position', async () => {
      const source = seeded();
      const { user } = await open(source);
      await user.click(row('Krapfen'));
      await user.type(box('Krapfen'), '20');

      source.days.set('Thursday', dayDoc('Thursday', [['Sfogliatelle', 8], ['Krapfen', 12], ['Cornetti', 24]]));
      act(() => { source.push(); });

      expect(rowsShown()).toEqual(['Sfogliatelle8', 'Krapfen12', 'Cornetti24']);
      expect(box('Krapfen')).toHaveValue(20);
      // And the write lands on the right row, whatever position it moved to.
      await user.click(tick('Krapfen')!);
      await waitFor(() => { expect(source.saveDay).toHaveBeenCalledTimes(1); });
      expect(source.saveDay).toHaveBeenCalledWith(
        'Thursday',
        [{ name: 'Sfogliatelle', qty: 8 }, { name: 'Krapfen', qty: 20 }, { name: 'Cornetti', qty: 24 }],
        '',
      );
    });

    // ⚠️ A row keyed by its place is rebuilt when an earlier one goes: the number survives (kept by
    // name) but the box is a new element, the focus drops to <body> and the phone's keyboard closes.
    it('keeps the very same box, with its focus and text, when a row ABOVE it is taken off the list', async () => {
      const source = seeded();
      const { user } = await open(source);
      await user.click(row('Sfogliatelle'));
      await user.type(box('Sfogliatelle'), '30');
      const before = box('Sfogliatelle');

      source.days.set('Thursday', dayDoc('Thursday', [['Krapfen', 12], ['Sfogliatelle', 8]]));
      act(() => { source.push(); });

      expect(rowsShown()).toEqual(['Krapfen12', 'Sfogliatelle8']);
      expect(box('Sfogliatelle')).toBe(before);
      expect(box('Sfogliatelle')).toHaveFocus();
      expect(box('Sfogliatelle')).toHaveValue(30);
    });

    // A reordered row is the same element in a new place (React moves it and puts the focus back):
    // keyed by its place it would be rebuilt, and the box would lose the focus.
    it('keeps the very same box, with its focus and text, when the list is reordered', async () => {
      const source = seeded();
      const { user } = await open(source);
      await user.click(row('Cornetti'));
      await user.type(box('Cornetti'), '30');
      const before = box('Cornetti');

      source.days.set('Thursday', dayDoc('Thursday', [['Krapfen', 12], ['Sfogliatelle', 8], ['Cornetti', 24]]));
      act(() => { source.push(); });

      expect(rowsShown()).toEqual(['Krapfen12', 'Sfogliatelle8', 'Cornetti24']);
      expect(box('Cornetti')).toBe(before);
      expect(box('Cornetti')).toHaveFocus();
      expect(box('Cornetti')).toHaveValue(30);
    });

    it('does not take the focus for the box when the person had left it', async () => {
      const source = seeded();
      const { user } = await open(source);
      await user.click(row('Krapfen'));
      await user.type(box('Krapfen'), '20');
      const pencil = screen.getByRole('button', { name: 'Edit Thursday' });
      act(() => { pencil.focus(); });
      expect(box('Krapfen')).not.toHaveFocus();

      source.days.set('Thursday', dayDoc('Thursday', [['Sfogliatelle', 8], ['Krapfen', 12], ['Cornetti', 24]]));
      act(() => { source.push(); });

      expect(pencil).toHaveFocus();
    });

    it('closes the box when its row is taken off the list', async () => {
      const source = seeded();
      const { user } = await open(source);
      await user.click(row('Cornetti'));
      await user.type(box('Cornetti'), '30');

      source.days.set('Thursday', dayDoc('Thursday', [['Krapfen', 12], ['Sfogliatelle', 8]]));
      act(() => { source.push(); });

      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
      expect(rowsShown()).toEqual(['Krapfen12', 'Sfogliatelle8']);
    });

    it('does not bring the box back if the row comes back later', async () => {
      const source = seeded();
      const { user } = await open(source);
      await user.click(row('Cornetti'));
      source.days.set('Thursday', dayDoc('Thursday', [['Krapfen', 12]]));
      act(() => { source.push(); });
      source.days.set('Thursday', dayDoc('Thursday', THURSDAY));
      act(() => { source.push(); });
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });
  });
});

describe('Confirm', () => {
  it('shows a big Confirm button and no «Confirmed» mark on a day that is not recorded', async () => {
    await open();
    expect(confirmButton()).toBeInTheDocument();
    expect(doneMark()).not.toBeVisible();
    expect(editButton()).not.toBeInTheDocument();
  });

  it('asks first, with both sentences, reading tonight\'s record once', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(confirmButton()!);

    const ask = await dialog('Confirm Thursday?');
    expect(within(ask).getByText('Keep this list as a record for Thursday?').tagName).toBe('P');
    expect(within(ask).getByText('Thursday will show as done. You can still change it — it will ask first.').tagName).toBe('P');
    expect(within(ask).getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(source.getLog).toHaveBeenCalledTimes(1);
    expect(source.getLog).toHaveBeenCalledWith(`${WORK_DATE}_Thursday`);
    // Nothing is written until the answer.
    expect(source.confirmLog).not.toHaveBeenCalled();
  });

  it('says the record will be replaced when tonight already has one', async () => {
    window.localStorage.setItem('pastries-edit-Thursday', WORK_DATE);
    const source = fakePastriesSource({ days: [dayDoc('Thursday', THURSDAY)], logs: [logDoc('Thursday', [['Cornetti', 10]])] });
    const { user } = await open(source);
    await user.click(confirmButton()!);

    const ask = await dialog('Confirm Thursday?');
    expect(within(ask).getByText('Keep this list as a record for Thursday?')).toBeInTheDocument();
    expect(within(ask).getByText('Tonight’s record for Thursday will be replaced.')).toBeInTheDocument();
    expect(within(ask).queryByText(/will show as done/)).not.toBeInTheDocument();
  });

  it('asks about an empty list in its own words, and records it', async () => {
    const source = fakePastriesSource();
    const { user } = renderPastries('/pastries', { source });
    await screen.findByText('Nothing to prove for Thursday yet.', undefined, LOAD);
    await user.click(confirmButton()!);

    const ask = await dialog('Confirm Thursday?');
    expect(within(ask).getByText('Thursday has nothing to prove. Record that?')).toBeInTheDocument();
    expect(within(ask).getByText(/will show as done/)).toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Thursday recorded.')).toBeInTheDocument();
    expect(source.logs.get(`${WORK_DATE}_Thursday`)).toMatchObject({ items: [] });
  });

  it('records the list, ticks the day, says so, and tells the usage record', async () => {
    const heard: string[] = [];
    const listener = (event: Event) => { heard.push(String((event as CustomEvent).detail)); };
    window.addEventListener(ACTION_EVENT, listener);
    try {
      const source = seeded('Butter is low.');
      const { user } = await open(source);
      await user.click(confirmButton()!);
      await user.click(within(await dialog('Confirm Thursday?')).getByRole('button', { name: 'Confirm' }));

      expect(await screen.findByText('Thursday recorded.')).toBeInTheDocument();
      expect(source.confirmLog).toHaveBeenCalledTimes(1);
      const record = source.logs.get(`${WORK_DATE}_Thursday`);
      expect(record).toMatchObject({
        date: WORK_DATE,
        day: 'Thursday',
        note: 'Butter is low.',
        items: [{ name: 'Cornetti', qty: 24 }, { name: 'Krapfen', qty: 12 }, { name: 'Sfogliatelle', qty: 8 }],
      });
      expect(heard).toEqual(['pastry-day-confirmed']);
      // The «Confirmed» mark and Edit take Confirm's place.
      expect(doneMark()).toBeVisible();
      expect(editButton()).toBeInTheDocument();
      expect(confirmButton()).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^Thursday/ })).toHaveAccessibleName(/Confirmed/);
    } finally {
      window.removeEventListener(ACTION_EVENT, listener);
    }
  });

  it('records nothing and says nothing on Cancel', async () => {
    const heard: string[] = [];
    const listener = (event: Event) => { heard.push(String((event as CustomEvent).detail)); };
    window.addEventListener(ACTION_EVENT, listener);
    try {
      const source = seeded();
      const { user } = await open(source);
      await user.click(confirmButton()!);
      await user.click(within(await dialog('Confirm Thursday?')).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(source.confirmLog).not.toHaveBeenCalled();
      expect(heard).toEqual([]);
      expect(region()).toBeEmptyDOMElement();
      expect(confirmButton()).toBeInTheDocument();
    } finally {
      window.removeEventListener(ACTION_EVENT, listener);
    }
  });

  it('ignores a second tap while the first is still being asked', async () => {
    const source = seeded();
    vi.mocked(source.getLog).mockImplementationOnce(() => new Promise(resolve => { setTimeout(() => { resolve(null); }, 50); }));
    const { user } = await open(source);
    const button = confirmButton()!;
    await user.click(button);
    await user.click(button);

    await dialog('Confirm Thursday?');
    expect(source.getLog).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  });

  it('can be tapped again after the question was answered', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(confirmButton()!);
    await user.click(within(await dialog('Confirm Thursday?')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    await user.click(confirmButton()!);
    await dialog('Confirm Thursday?');
    expect(source.getLog).toHaveBeenCalledTimes(2);
  });

  it('says so, and stays unconfirmed, when the record could not be written', async () => {
    const source = seeded();
    source.refuse.confirmLog = true;
    const { user } = await open(source);
    await user.click(confirmButton()!);
    await user.click(within(await dialog('Confirm Thursday?')).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Couldn’t record Thursday — check your connection.')).toBeInTheDocument();
    expect(screen.queryByText('Thursday recorded.')).not.toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();
    expect(editButton()).not.toBeInTheDocument();
  });

  it('goes ahead without the replace warning when the read of tonight\'s record fails', async () => {
    const source = seeded();
    vi.mocked(source.getLog).mockRejectedValueOnce(new Error('offline'));
    const { user } = await open(source);
    await user.click(confirmButton()!);

    const ask = await dialog('Confirm Thursday?');
    expect(within(ask).getByText(/will show as done/)).toBeInTheDocument();
  });
});

describe('the lock on a recorded day', () => {
  const recorded = () => fakePastriesSource({
    days: [dayDoc('Thursday', THURSDAY)],
    logs: [logDoc('Thursday', THURSDAY)],
  });

  async function openLocked() {
    const view = await open(recorded());
    await waitFor(() => { expect(editButton()).toBeInTheDocument(); });
    return view;
  }

  it('shows «Confirmed» and Edit instead of Confirm', async () => {
    await openLocked();
    expect(doneMark()).toBeVisible();
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it('asks before a tapped row opens, in the day\'s words', async () => {
    const { user } = await openLocked();
    await user.click(row('Cornetti'));

    const ask = await dialog('Edit Thursday?');
    expect(ask).toHaveAccessibleDescription('Thursday is already recorded for tonight. Edit these quantities?');
    expect(within(ask).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('stays locked on Cancel: no box, no permission stored', async () => {
    const { user } = await openLocked();
    await user.click(row('Cornetti'));
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('pastries-edit-Thursday')).toBeNull();
    expect(editButton()).toBeInTheDocument();
  });

  it('grants the permission on Edit and opens the row that was tapped, with the focus in its box', async () => {
    const { user } = await openLocked();
    await user.click(row('Krapfen'));
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Edit' }));

    expect(await screen.findByRole('spinbutton', { name: 'New quantity for Krapfen' })).toHaveFocus();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    expect(window.localStorage.getItem('pastries-edit-Thursday')).toBe(WORK_DATE);
    // Unlocked: Confirm is back, the mark is gone.
    expect(confirmButton()).toBeInTheDocument();
    expect(doneMark()).not.toBeVisible();
  });

  it('does not ask again for the next row once editing was allowed', async () => {
    const { user } = await openLocked();
    await user.click(row('Krapfen'));
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('spinbutton');
    await user.click(row('Cornetti'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box('Cornetti')).toBeInTheDocument();
  });

  it('asks before the pencil opens the editor, and goes nowhere on Cancel', async () => {
    const { user, router } = await openLocked();
    await user.click(screen.getByRole('button', { name: 'Edit Thursday' }));
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/pastries');
    expect(window.localStorage.getItem('pastries-edit-Thursday')).toBeNull();
  });

  it('opens the editor from the pencil once the question is answered with Edit', async () => {
    const { user, router } = await openLocked();
    await user.click(screen.getByRole('button', { name: 'Edit Thursday' }));
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Edit' }));

    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday/edit'); });
    expect(window.localStorage.getItem('pastries-edit-Thursday')).toBe(WORK_DATE);
  });

  it('asks on the Edit button too, then only unlocks the list: no editor, no row opened', async () => {
    const { user, router } = await openLocked();
    await user.click(editButton()!);
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Edit' }));

    await waitFor(() => { expect(confirmButton()).toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/pastries');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('pastries-edit-Thursday')).toBe(WORK_DATE);
  });

  it('is a recorded day for tonight only: a record from another night locks nothing', async () => {
    const source = fakePastriesSource({
      days: [dayDoc('Thursday', THURSDAY)],
      logs: [logDoc('Thursday', THURSDAY, '2026-10-13')],
    });
    const { user } = await open(source);
    await user.click(row('Cornetti'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box('Cornetti')).toBeInTheDocument();
  });

  it('does not ask before the pencil opens the editor on a day that is not recorded', async () => {
    const { user, router } = await open();
    await user.click(screen.getByRole('button', { name: 'Edit Thursday' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday/edit'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // The lock follows the clock: the grant names tonight's work date and is spent at 4am.
  it('locks a day recorded after 4am even though last night\'s permission is still stored', async () => {
    const source = recorded();
    window.localStorage.setItem('pastries-edit-Thursday', WORK_DATE);
    // By its address: coming back after 4am moves the day `/pastries` opens on (it is Friday's list
    // that is proved for then), but not a day somebody asked for by name.
    await open(source, '/pastries/Thursday');
    expect(confirmButton()).toBeInTheDocument();

    vi.setSystemTime(new Date(2026, 9, 15, 5, 0, 0));
    source.logs.clear();
    source.logs.set('2026-10-15_Thursday', logDoc('Thursday', THURSDAY, '2026-10-15'));
    // Back to the foreground: the store notices the work date has moved.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => { expect(editButton()).toBeInTheDocument(); });
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it('closes an open row when a colleague confirms the day', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30');
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();

    source.logs.set(`${WORK_DATE}_Thursday`, logDoc('Thursday', THURSDAY));
    act(() => { source.push(); });

    await waitFor(() => { expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument(); });
    expect(editButton()).toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();
    expect(isBusy()).toBe(false);
  });
});

// ⚠️ UNTIL THE DAYS HAVE ANSWERED the list is the phone's old copy, possibly days old: it is drawn, but
// a tick on a row or a Confirm from it could write or record a list nobody has any more.
describe('before the days have answered', () => {
  function oldCopyOnThePhone() {
    window.localStorage.setItem('pastries-days', JSON.stringify({ Thursday: { items: THURSDAY.map(([name, qty]) => ({ name, qty })), note: '' } }));
    const source = seeded();
    return { source, ...holdDays(source) };
  }

  it('draws the old copy at once, but Confirm is disabled and a row does not open', async () => {
    const { source } = oldCopyOnThePhone();
    const { user } = renderPastries('/pastries', { source });
    await rowReady('Cornetti');

    expect(rowsShown()).toEqual(['Cornetti24', 'Krapfen12', 'Sfogliatelle8']);
    expect(confirmButton()).toBeDisabled();
    expect(row('Cornetti')).toHaveAttribute('aria-disabled', 'true');

    await user.click(row('Cornetti'));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(row('Cornetti')).toHaveAttribute('aria-expanded', 'false');
    await user.click(confirmButton()!);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.getLog).not.toHaveBeenCalled();
  });

  it('keeps a row reachable by the keyboard while it waits: aria-disabled, never disabled', async () => {
    const { source } = oldCopyOnThePhone();
    renderPastries('/pastries', { source });
    await rowReady('Cornetti');
    expect(row('Cornetti')).not.toBeDisabled();
  });

  it('opens a row and confirms as soon as the first answer is in', async () => {
    const { source, answer } = oldCopyOnThePhone();
    const { user } = renderPastries('/pastries', { source });
    await rowReady('Cornetti');
    expect(confirmButton()).toBeDisabled();

    act(() => { answer(); });
    await waitFor(() => { expect(confirmButton()).toBeEnabled(); });
    expect(row('Cornetti')).not.toHaveAttribute('aria-disabled');

    await user.click(row('Cornetti'));
    expect(box('Cornetti')).toBeInTheDocument();
    await user.click(confirmButton()!);
    expect(await dialog('Confirm Thursday?')).toBeInTheDocument();
  });

  it('counts the stream dying as an answer, so a phone with no connection can still work', async () => {
    const { source, fail } = oldCopyOnThePhone();
    const { user } = renderPastries('/pastries', { source });
    await rowReady('Cornetti');
    expect(confirmButton()).toBeDisabled();

    act(() => { fail(); });
    await waitFor(() => { expect(confirmButton()).toBeEnabled(); });
    await user.click(row('Cornetti'));
    expect(box('Cornetti')).toBeInTheDocument();
  });
});

// ⚠️ THE BUTTON THAT WAS PRESSED HIDES ITSELF, and a hidden element cannot keep the focus: it would
// fall to <body>. The focus goes to the control that takes its place — but only the press that
// causes the swap asks for it.
describe('where the focus goes when a bottom button hides itself', () => {
  // The dialog gives the focus back to its opener a frame after it closes, if the focus is nowhere.
  const aFrame = () => new Promise(resolve => { setTimeout(resolve, 60); });
  const recorded = () => fakePastriesSource({
    days: [dayDoc('Thursday', THURSDAY)],
    logs: [logDoc('Thursday', THURSDAY)],
  });

  it('puts it on the Edit button of the confirmed row when Confirm lands', async () => {
    const { user } = await open(seeded());
    await user.click(confirmButton()!);
    await user.click(within(await dialog('Confirm Thursday?')).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Thursday recorded.')).toBeInTheDocument();
    await aFrame();
    expect(editButton()).toBeInTheDocument();
    expect(editButton()).toHaveFocus();
  });

  it('leaves it on Confirm when the record could not be written and Confirm stays', async () => {
    const source = seeded();
    source.refuse.confirmLog = true;
    const { user } = await open(source);
    await user.click(confirmButton()!);
    await user.click(within(await dialog('Confirm Thursday?')).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Couldn’t record Thursday — check your connection.')).toBeInTheDocument();
    await aFrame();
    expect(confirmButton()).toHaveFocus();
  });

  it('puts it on Confirm when the Edit button unlocks the day', async () => {
    const { user } = await open(recorded());
    await waitFor(() => { expect(editButton()).toBeInTheDocument(); });
    await user.click(editButton()!);
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Edit' }));

    await waitFor(() => { expect(confirmButton()).toBeInTheDocument(); });
    await aFrame();
    expect(confirmButton()).toHaveFocus();
  });

  it('keeps it on the Edit button when the question is answered with Cancel', async () => {
    const { user } = await open(recorded());
    await waitFor(() => { expect(editButton()).toBeInTheDocument(); });
    await user.click(editButton()!);
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Cancel' }));

    await aFrame();
    expect(editButton()).toHaveFocus();
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it('does not move it to Confirm when the day is unlocked from a row: the box has it', async () => {
    const { user } = await open(recorded());
    await waitFor(() => { expect(editButton()).toBeInTheDocument(); });
    await user.click(row('Krapfen'));
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Edit' }));

    expect(await screen.findByRole('spinbutton', { name: 'New quantity for Krapfen' })).toHaveFocus();
    await aFrame();
    expect(box('Krapfen')).toHaveFocus();
    expect(confirmButton()).not.toHaveFocus();
  });

  it('moves nobody\'s focus when a colleague confirms the day', async () => {
    const source = seeded();
    const { user } = await open(source);
    const records = screen.getByRole('link', { name: 'Records' });
    await user.click(row('Cornetti'));
    act(() => { records.focus(); });

    source.logs.set(`${WORK_DATE}_Thursday`, logDoc('Thursday', THURSDAY));
    act(() => { source.push(); });

    await waitFor(() => { expect(editButton()).toBeInTheDocument(); });
    await aFrame();
    expect(records).toHaveFocus();
    expect(editButton()).not.toHaveFocus();
  });

  it('moves nothing when the focus was nowhere and a colleague confirms the day', async () => {
    const source = seeded();
    await open(source);
    expect(document.body).toHaveFocus();

    source.logs.set(`${WORK_DATE}_Thursday`, logDoc('Thursday', THURSDAY));
    act(() => { source.push(); });

    await waitFor(() => { expect(editButton()).toBeInTheDocument(); });
    await aFrame();
    expect(document.body).toHaveFocus();
  });

  it('leaves the focus where the person put it when they moved on while the record was being written', async () => {
    const source = seeded();
    let land: () => void = () => undefined;
    vi.mocked(source.confirmLog).mockImplementationOnce((id, build) => new Promise<void>(resolve => {
      land = () => {
        const { id: _id, ...payload } = build(null);
        source.logs.set(id, { ...payload, id, bakery: 'bakery' });
        source.push();
        resolve();
      };
    }));
    const { user } = await open(source);
    await user.click(confirmButton()!);
    await user.click(within(await dialog('Confirm Thursday?')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => { expect(source.confirmLog).toHaveBeenCalled(); });
    await aFrame();
    const records = screen.getByRole('link', { name: 'Records' });
    act(() => { records.focus(); });

    await act(async () => { land(); await Promise.resolve(); });

    expect(await screen.findByText('Thursday recorded.')).toBeInTheDocument();
    await aFrame();
    expect(records).toHaveFocus();
  });
});

describe('what the store reports', () => {
  it('says a refused save in the person\'s words, and puts the number back', async () => {
    const source = seeded();
    source.refuse.saveDay = true;
    const { user } = await open(source);
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30{Enter}');

    expect(await screen.findByText('Couldn’t save Thursday — check your connection.')).toBeInTheDocument();
    await waitFor(() => { expect(rowsShown()).toEqual(['Cornetti24', 'Krapfen12', 'Sfogliatelle8']); });
  });

  it('says a broken live stream, in the live region that was already there', async () => {
    const source = seeded();
    await open(source);
    const before = region();
    act(() => { source.breakStreams(); });

    expect(await screen.findByText('Live sync interrupted — this list may be out of date.')).toBeInTheDocument();
    expect(region()).toBe(before);
    expect(before?.textContent).toBe('Live sync interrupted — this list may be out of date.');
  });

  it('clears the message by itself', async () => {
    const source = seeded();
    const { user } = await open(source);
    await user.click(row('Cornetti'));
    await user.type(box('Cornetti'), '30{Enter}');
    expect(await screen.findByText('Cornetti: 30.')).toBeInTheDocument();
    await waitFor(() => { expect(region()).toBeEmptyDOMElement(); }, { timeout: 5000 });
  }, 10_000);
});

describe('in Italian', () => {
  it('asks about a recorded day, and about Confirm, in Italian', async () => {
    const source = fakePastriesSource({
      days: [dayDoc('Thursday', THURSDAY, 'Burro in esaurimento.')],
      logs: [logDoc('Thursday', THURSDAY)],
    });
    const { user } = renderPastries('/pastries', { source, lang: 'it' });
    await screen.findByRole('button', { name: /^Cornetti/ }, LOAD);
    expect(screen.getByRole('heading', { level: 2, name: 'Giovedì' })).toBeInTheDocument();
    expect(screen.getByText('Nota')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Cornetti/ }));
    const ask = await dialog('Modificare Giovedì?');
    expect(ask).toHaveAccessibleDescription('La lista di Giovedì è già registrata per stanotte. Modificare queste quantità?');
    await user.click(within(ask).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(within(screen.getByRole('tabpanel')).getByText('Confermato')).toBeVisible();
  });

  it('says a refused save in Italian', async () => {
    const source = seeded();
    source.refuse.saveDay = true;
    const { user } = renderPastries('/pastries', { source, lang: 'it' });
    await screen.findByRole('button', { name: /^Cornetti/ }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Cornetti/ }));
    await user.type(screen.getByRole('spinbutton', { name: 'Nuova quantità per Cornetti' }), '30{Enter}');

    expect(await screen.findByText('Non è stato possibile salvare Giovedì — controlla la connessione.')).toBeInTheDocument();
  });
});
