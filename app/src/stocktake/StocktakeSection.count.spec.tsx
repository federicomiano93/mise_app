import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import {
  closedMonthDoc, freezeClock, ingredient, monthDoc, renderStocktake,
} from '../testing/renderStocktake';

// The count box on every row: what it shows, when it is typable, what leaving it does, and what a
// snapshot from another phone must never do to it.

beforeAll(async () => { await import('./StocktakeSection'); }, 60_000);

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
// The save is sent 700ms after the last change; this is the real clock.
const SAVED = { timeout: 4000 };

const INGREDIENTS = [
  ingredient('flour', { name: 'Farina', category: 'Dispensa' }),
  ingredient('sugar', { name: 'Zucchero', category: 'Dispensa' }),
  ingredient('butter', { name: 'Burro', category: 'Frigo' }),
];

function source(months = [monthDoc('2026-10')]) {
  return fakeStocktakeSource({ months, ingredients: INGREDIENTS });
}

const boxOf = (name: string) => screen.getByRole('textbox', { name: `How many of ${name} are left` });
const enabled = (name: string) => waitFor(() => { expect(boxOf(name)).toBeEnabled(); }, LOAD);

async function loaded(fake = source(), path = '/stocktake/2026-10', options: Parameters<typeof renderStocktake>[1] = {}) {
  const view = renderStocktake(path, { ...options, source: fake });
  await screen.findAllByRole('heading', { level: 3 }, LOAD);
  return { ...view, fake };
}

describe('a count box', () => {
  it('is a text box with the decimal keyboard, never a number field', async () => {
    await loaded();
    const box = boxOf('Farina');
    expect(box).toHaveAttribute('type', 'text');
    expect(box).toHaveAttribute('inputmode', 'decimal');
    expect(box).toHaveAttribute('autocomplete', 'off');
    expect(box).toHaveAttribute('enterkeyhint', 'next');
  });

  it('is empty for a count nobody has made, and shows a zero that was counted', async () => {
    await loaded(source([monthDoc('2026-10', { closing: { sugar: 0 } })]));
    expect(boxOf('Farina')).toHaveValue('');
    expect(boxOf('Zucchero')).toHaveValue('0');
  });

  it('shows the month\'s closing count', async () => {
    await loaded(source([monthDoc('2026-10', { closing: { flour: 8.25 } })]));
    expect(boxOf('Farina')).toHaveValue('8.25');
  });

  // The v1.107.0 defect: a grouped «1,234.5» cannot be read back, and «1,234» edited to «1,235» was
  // taken for 1.235. The box never groups — and not after an update from another phone either.
  it.each([
    ['en', 1234.5, '1234.5', 98765.25, '98765.25'],
    ['it', 1234.5, '1234,5', 98765.25, '98765,25'],
  ] as const)('never shows a thousands separator (%s)', async (lang, value, text, later, laterText) => {
    const fake = source([monthDoc('2026-10', { closing: { flour: value } })]);
    renderStocktake('/stocktake/2026-10', { source: fake, lang });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    const name = lang === 'it' ? 'Quanti ne restano di Farina' : 'How many of Farina are left';
    expect(screen.getByRole('textbox', { name })).toHaveValue(text);

    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: later } }));
    fake.push();
    await waitFor(() => { expect(screen.getByRole('textbox', { name })).toHaveValue(laterText); });
  });

  it('shows another phone\'s count when the box does not have the focus', async () => {
    const { fake } = await loaded();
    fake.months.set('2026-10', monthDoc('2026-10', { closing: { butter: 5 } }));
    fake.push();
    await waitFor(() => { expect(boxOf('Burro')).toHaveValue('5'); });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });
});

describe('a count box: when it can be typed into', () => {
  it('is shut on a closed month, whose note says so', async () => {
    const fake = source([closedMonthDoc('2026-09', { names: { flour: 'Farina', sugar: 'Zucchero' }, closing: { flour: 3 } })]);
    await loaded(fake, '/stocktake/2026-09');
    await waitFor(() => { expect(screen.getByText('This month is closed: its figures no longer change.')).toBeInTheDocument(); });
    expect(boxOf('Farina')).toBeDisabled();
    expect(boxOf('Farina')).toHaveValue('3');
    expect(boxOf('Zucchero')).toBeDisabled();
  });

  it('is shut until the month has answered, and opens when it does', async () => {
    const fake = source();
    fake.hold();
    renderStocktake('/stocktake/2026-10', { source: fake });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    expect(boxOf('Farina')).toBeDisabled();
    expect(boxOf('Burro')).toBeDisabled();

    act(() => { fake.release(); });
    await enabled('Farina');
    expect(boxOf('Burro')).toBeEnabled();
  });

  // A count must never be written into a month that turns out to be closed: the answer that says so
  // can arrive after the first paint.
  it('shuts when the month turns out to be closed after the first paint', async () => {
    const fake = source([monthDoc('2026-10')]);
    const { user } = await loaded(fake);
    await enabled('Farina');

    fake.months.set('2026-10', closedMonthDoc('2026-10', { names: { flour: 'Farina' }, closing: { flour: 1 } }));
    act(() => { fake.push(); });

    await waitFor(() => { expect(boxOf('Farina')).toBeDisabled(); });
    expect(screen.getByText('This month is closed: its figures no longer change.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carry forward' })).not.toBeInTheDocument();
    await user.click(boxOf('Farina'));
    expect(boxOf('Farina')).not.toHaveFocus();
  });

  // A month closed on another phone while somebody is half-way through a number: the box shuts and
  // shows the month's figure, and the half-typed text does not come back if the month is reopened.
  it('forgets a half-typed number when the month is closed under it', async () => {
    const fake = source([monthDoc('2026-10', { closing: { flour: 8 } })]);
    const { user } = await loaded(fake);
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Farina'), '5');

    fake.months.set('2026-10', closedMonthDoc('2026-10', { names: { flour: 'Farina' }, closing: { flour: 8 } }));
    act(() => { fake.push(); });
    await waitFor(() => { expect(boxOf('Farina')).toBeDisabled(); });
    expect(boxOf('Farina')).toHaveValue('8');

    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: 8 } }));
    act(() => { fake.push(); });
    await waitFor(() => { expect(boxOf('Farina')).toBeEnabled(); });
    expect(boxOf('Farina')).toHaveValue('8');
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
  });

  it('opens for whoever runs the place when the month\'s stream fails: the phone\'s own copy is all there is', async () => {
    const fake = source();
    fake.refuse.watchMonth = true;
    await loaded(fake);
    await enabled('Farina');
  });
});

describe('a count box: leaving it saves the count', () => {
  it('commits what was typed when the box is left, and the summary moves at once', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    expect(screen.getByText('0 of 3')).toBeInTheDocument();

    await user.type(boxOf('Farina'), '12');
    // Still being typed: nothing counted yet.
    expect(screen.getByText('0 of 3')).toBeInTheDocument();
    await user.tab();

    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(boxOf('Farina')).toHaveValue('12');
    expect(within(boxOf('Farina').closest('li') as HTMLElement).getByText('No opening figure yet')).toBeInTheDocument();

    // And goes up 700ms after the last change, as one merge.
    expect(fake.saved).toHaveLength(0);
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.monthId).toBe('2026-10');
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 12 });
    expect(fake.saved[0]?.patch.month).toBe('2026-10');
  });

  it('sends two counts made within the delay as ONE write', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '2');
    await user.type(boxOf('Zucchero'), '3');
    await user.type(boxOf('Burro'), '4');
    await user.tab();

    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 2, sugar: 3, butter: 4 });
  });

  it('reads a comma as the decimal point, and writes the number back the language\'s way', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '3,5');
    await user.tab();
    expect(boxOf('Farina')).toHaveValue('3.5');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 3.5 });
  });

  it('writes a decimal comma in Italian', async () => {
    const fake = source();
    const { user } = await loaded(fake, '/stocktake/2026-10', { lang: 'it' });
    await waitFor(() => { expect(screen.getByRole('textbox', { name: 'Quanti ne restano di Farina' })).toBeEnabled(); }, LOAD);
    await user.type(screen.getByRole('textbox', { name: 'Quanti ne restano di Farina' }), '3.5');
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Quanti ne restano di Farina' })).toHaveValue('3,5');
  });

  it('keeps a zero, which is a real answer', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '0');
    await user.tab();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(boxOf('Farina')).toHaveValue('0');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 0 });
  });

  it('sends a removal when the box is emptied, as a nested map, in the same write', async () => {
    const fake = source([monthDoc('2026-10', { closing: { flour: 8, butter: 2 } })]);
    const { user } = await loaded(fake);
    await enabled('Farina');
    expect(screen.getByText('2 of 3')).toBeInTheDocument();

    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Zucchero'), '5');
    await user.tab();

    expect(boxOf('Farina')).toHaveValue('');
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ sugar: 5 });
    expect(fake.saved[0]?.clear).toEqual({ closing: { flour: true } });
    expect(fake.months.get('2026-10')?.closing).toEqual({ butter: 2, sugar: 5 });
  });

  it('does not count junk as a number: a box left with letters in it is not counted', async () => {
    const { user } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), 'abc');
    await user.tab();
    expect(boxOf('Farina')).toHaveValue('');
    expect(screen.getByText('0 of 3')).toBeInTheDocument();
  });

  it('refuses a negative count rather than turning it into a zero: the box shows the saved number again', async () => {
    const { user, fake } = await loaded(source([monthDoc('2026-10', { closing: { flour: 4 } })]));
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Farina'), '-2');
    await user.tab();
    expect(boxOf('Farina')).toHaveValue('4');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
  });

  it('sends nothing for a box that was entered and left unchanged', async () => {
    const { user, fake } = await loaded(source([monthDoc('2026-10', { closing: { flour: 8 } })]));
    await enabled('Farina');
    await user.click(boxOf('Farina'));
    await user.tab();
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
  });

  it('sends nothing for a number typed and typed back', async () => {
    const { user, fake } = await loaded(source([monthDoc('2026-10', { closing: { flour: 8 } })]));
    await enabled('Farina');
    await user.type(boxOf('Farina'), '9');
    await user.type(boxOf('Farina'), '{Backspace}');
    await user.tab();
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
  });

  it('says so, and keeps the number, when the write is refused', async () => {
    const fake = source();
    fake.refuse.save = true;
    const { user } = await loaded(fake);
    await enabled('Farina');
    await user.type(boxOf('Farina'), '6');
    await user.tab();

    expect(await screen.findByText(
      'Not saved online yet. The count is safe on this phone and goes up on its own.',
      undefined,
      SAVED,
    )).toBeInTheDocument();
    // Never rolled back: the number somebody walked across a storeroom to read stays.
    expect(boxOf('Farina')).toHaveValue('6');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('keeps the count in the phone\'s own copy at once', async () => {
    const { user } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '6');
    await user.tab();
    const stored = JSON.parse(window.localStorage.getItem('inventory-bakery-2026-10') ?? '{}') as { closing?: unknown };
    expect(stored.closing).toEqual({ flour: 6 });
  });
});

// ⚠️ TEXT THAT CANNOT BE READ IS NOT AN EMPTIED BOX: the store turns «5 kg», «1/2» and «-2» into
// «nobody has counted this», and that removes the entry, so junk typed over a saved 5 deleted the
// count. It is refused instead, and the box shows the saved number again.
describe('a count box: text that cannot be read does not wipe a saved count', () => {
  const FIVE = () => source([monthDoc('2026-10', { closing: { flour: 5 } })]);

  it.each([['5 kg'], ['1/2'], ['-2'], ['abc']])('keeps the 5 when «%s» is typed over it and the box is left', async text => {
    const { user, fake } = await loaded(FIVE());
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Farina'), text);
    await user.tab();

    expect(boxOf('Farina')).toHaveValue('5');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
    expect(fake.months.get('2026-10')?.closing).toEqual({ flour: 5 });
  });

  it('does not count it as unsent work either: nothing is left to lose', async () => {
    const { user } = await loaded(FIVE());
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Farina'), '5 kg');
    expect(isBusy()).toBe(true);
    await user.tab();
    expect(isBusy()).toBe(false);
  });

  it('on Enter keeps the box open, starting again from the saved number', async () => {
    const fake = source([monthDoc('2026-10', { closing: { butter: 2 } })]);
    const { user } = await loaded(fake);
    await enabled('Burro');
    await user.clear(boxOf('Burro'));
    await user.type(boxOf('Burro'), 'two{Enter}');
    // The last row: the focus stays, and the box says what the month holds.
    expect(boxOf('Burro')).toHaveFocus();
    expect(boxOf('Burro')).toHaveValue('2');
    expect(isBusy()).toBe(false);

    await user.type(boxOf('Burro'), '0');
    await user.tab();
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ butter: 20 });
  });

  it('writes nothing either when the screen is left with the unreadable text still in the box', async () => {
    const { router, user, fake } = await loaded(FIVE());
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Farina'), '5 kg');

    await act(async () => { await router.navigate('/orders'); });

    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
    expect(fake.months.get('2026-10')?.closing).toEqual({ flour: 5 });
  });

  it('still removes the count when the box is emptied', async () => {
    const { user, fake } = await loaded(FIVE());
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.tab();

    expect(boxOf('Farina')).toHaveValue('');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.clear).toEqual({ closing: { flour: true } });
  });

  it('treats a box holding only blanks as emptied, as it always did', async () => {
    const { user, fake } = await loaded(FIVE());
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Farina'), '  ');
    await user.tab();

    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.clear).toEqual({ closing: { flour: true } });
  });

  it('still saves a readable number typed over it, comma included', async () => {
    const { user, fake } = await loaded(FIVE());
    await enabled('Farina');
    await user.clear(boxOf('Farina'));
    await user.type(boxOf('Farina'), '3,5');
    await user.tab();

    expect(boxOf('Farina')).toHaveValue('3.5');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 3.5 });
  });
});

describe('a count box: Enter', () => {
  it('commits and moves to the next visible row\'s box, across the groups', async () => {
    const { user } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '2{Enter}');
    expect(boxOf('Zucchero')).toHaveFocus();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    await user.type(boxOf('Zucchero'), '3{Enter}');
    expect(boxOf('Burro')).toHaveFocus();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('commits on the last row and keeps the focus there', async () => {
    const { user, fake } = await loaded();
    await enabled('Burro');
    await user.type(boxOf('Burro'), '9{Enter}');
    expect(boxOf('Burro')).toHaveFocus();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ butter: 9 });
  });

  it('commits once: leaving the box after Enter writes nothing more', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Burro'), '9{Enter}');
    await user.tab();
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(vi.mocked(fake.saveMonthFields)).toHaveBeenCalledTimes(1);
  });

  it('skips the rows the search has filtered out', async () => {
    const { user } = await loaded();
    await enabled('Farina');
    await user.type(screen.getByRole('searchbox', { name: 'Search a product' }), 'r');
    // Farina, Burro and Zucchero all hold an «r»; narrow it to two.
    await user.clear(screen.getByRole('searchbox', { name: 'Search a product' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search a product' }), 'zucc');
    expect(screen.queryByRole('textbox', { name: 'How many of Farina are left' })).not.toBeInTheDocument();
    await user.type(boxOf('Zucchero'), '1{Enter}');
    expect(boxOf('Zucchero')).toHaveFocus();
  });

  it('does not send the keyboard\'s Enter to a form: nothing reloads', async () => {
    const { user } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '2{Enter}');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stocktake');
  });
});

describe('a count box: a box being typed into is never written into', () => {
  it('keeps what is being typed when another phone\'s count arrives, and saves it on leaving', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '3,');
    expect(boxOf('Farina')).toHaveFocus();

    // Another phone counts the flour, and another product, while this box is open.
    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: 99, butter: 5 } }));
    act(() => { fake.push(); });
    await waitFor(() => { expect(boxOf('Burro')).toHaveValue('5'); });

    // The other box moved; this one did not: its text and its caret are the person's own.
    expect(boxOf('Farina')).toHaveValue('3,');
    expect(boxOf('Farina')).toHaveFocus();

    await user.type(boxOf('Farina'), '5');
    expect(boxOf('Farina')).toHaveValue('3,5');
    await user.tab();
    expect(boxOf('Farina')).toHaveValue('3.5');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 3.5 });
  });

  it('does not overwrite another phone\'s count with a box that was only entered', async () => {
    const { user, fake } = await loaded(source([monthDoc('2026-10', { closing: { flour: 8 } })]));
    await enabled('Farina');
    await user.click(boxOf('Farina'));
    expect(boxOf('Farina')).toHaveValue('8');

    fake.months.set('2026-10', monthDoc('2026-10', { closing: { flour: 9 } }));
    act(() => { fake.push(); });
    // Not written into while it has the focus...
    expect(boxOf('Farina')).toHaveValue('8');

    await user.tab();
    // ...and, nothing typed, nothing written back over the 9 either.
    expect(boxOf('Farina')).toHaveValue('9');
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
  });

  it('does not lose the typed text when the list is redrawn by a snapshot of its own', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    const box = boxOf('Farina');
    await user.type(box, '4');
    act(() => { fake.push(); });
    act(() => { fake.push(); });
    expect(boxOf('Farina')).toBe(box);
    expect(box).toHaveValue('4');
    expect(box).toHaveFocus();
  });
});

describe('a count box: the session is busy while a number is unsaved', () => {
  it('is busy from the first character that changes the box until the count is on its way', async () => {
    const { user, fake } = await loaded();
    await enabled('Farina');
    expect(isBusy()).toBe(false);

    await user.type(boxOf('Farina'), '7');
    expect(isBusy()).toBe(true);

    // Typed back to what it was: nothing to lose.
    await user.type(boxOf('Farina'), '{Backspace}');
    expect(isBusy()).toBe(false);

    await user.type(boxOf('Farina'), '7');
    await user.tab();
    // Left, but not yet confirmed by the server: still unsaved.
    expect(isBusy()).toBe(true);
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });
});

describe('a count box: leaving with the box still open', () => {
  // iPhone Safari does not blur a box when a button is tapped, so a number typed just before a tap
  // on the rail must still reach the store.
  it('commits what was typed when the screen is left without the box losing focus first', async () => {
    const { router, user, fake } = await loaded();
    await enabled('Farina');
    await user.type(boxOf('Farina'), '5');

    await act(async () => { await router.navigate('/orders'); });

    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.monthId).toBe('2026-10');
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 5 });
  });

  // ⚠️ THE BOXES ARE THE SAME PRODUCTS IN EVERY MONTH. A number typed in September's box and not yet
  // committed must land in September, never in October's box that takes its place.
  it('commits to the month it was typed in when the month changes under the open box', async () => {
    const fake = source([monthDoc('2026-10'), monthDoc('2026-09')]);
    const { router, user } = await loaded(fake, '/stocktake/2026-09');
    await enabled('Farina');
    await user.type(boxOf('Farina'), '5');

    await act(async () => { await router.navigate('/stocktake/2026-10', { replace: true }); });
    await screen.findByRole('heading', { level: 2, name: 'October 2026' }, LOAD);
    await enabled('Farina');

    // The new month's box is its own: empty, not carrying the old draft.
    expect(boxOf('Farina')).toHaveValue('');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.monthId).toBe('2026-09');
    expect(fake.saved[0]?.patch.closing).toEqual({ flour: 5 });
    expect(fake.months.get('2026-10')?.closing).toBeUndefined();
  });
});
