import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MAX_ITEMS } from '@mise/shared/pastries-model';
import { isBusy } from '../session/busy';
import { fakePastriesSource } from '../testing/fakePastriesSource';
import type { FakePastriesSource } from '../testing/fakePastriesSource';
import { dayDoc, freezeClock, logDoc, renderPastries } from '../testing/renderPastries';

// The editor of a day: the working copy, the rows, the notice for a blocked save, Save, and every
// way out. Everything runs against the real store on an in-memory source; the clock is Wednesday
// 14 October 2026, 21:00, so the day being proved for is Thursday.

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

const seeded = (note = '') => fakePastriesSource({ days: [dayDoc('Thursday', THURSDAY, note)] });

const dialog = (name: string) => screen.findByRole('alertdialog', { name });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const nameBoxes = () => screen.getAllByRole('combobox', { name: /^(Pastry name|Nome della pasta)$/ }) as HTMLInputElement[];
const qtyBoxes = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];
const noteBox = () => screen.getByRole('textbox', { name: /^(Note|Nota) — / }) as HTMLTextAreaElement;
// hidden: true — while a question is open the page behind it is out of the accessibility tree.
const alertRegion = () => screen.getByRole('alert', { hidden: true });
const tab = (label: string) => screen.getByRole('tab', { name: new RegExp(`^${label}( |$)`) });
const region = () => document.querySelector('[role="status"][class*="region"]');
// The editor's own card: a day's tab says «3 pastries» as well, so the count is looked up inside it.
const card = () => screen.getByRole('region', { name: /^(Edit|Modifica) / });

// The rows as the editor shows them: [name, quantity] pairs.
const rowsShown = () => nameBoxes().map((box, index) => [box.value, qtyBoxes()[index]?.value]);

async function openByAddress(source: FakePastriesSource = seeded(), day = 'Thursday', lang: 'en' | 'it' = 'en') {
  const view = renderPastries(`/pastries/${day}/edit`, { source, lang });
  await screen.findByRole('heading', { level: 2, name: lang === 'it' ? /^Modifica / : /^Edit / }, LOAD);
  return view;
}

async function openFromDay(source: FakePastriesSource = seeded(), day = 'Thursday') {
  const view = renderPastries(`/pastries/${day}`, { source });
  await screen.findByRole('tabpanel', undefined, LOAD);
  await view.user.click(screen.getByRole('button', { name: `Edit ${day}` }));
  await screen.findByRole('heading', { level: 2, name: `Edit ${day}` });
  return view;
}

// A source whose seven days have not answered yet: the answer (or the failure) comes when the spec
// says so. This is a phone that was just reloaded on the editor's address with nothing stored.
function lateSource() {
  const source = seeded();
  const original = vi.mocked(source.watchDays).getMockImplementation();
  const waiting: { answer: () => void; fail: () => void }[] = [];
  vi.mocked(source.watchDays).mockImplementation((onChange, onError) => {
    let stop: (() => void) | undefined;
    waiting.push({ answer: () => { stop = original?.(onChange, onError); }, fail: () => onError(new Error('unavailable')) });
    return () => stop?.();
  });
  return {
    source,
    answer: () => waiting.forEach(each => each.answer()),
    fail: () => waiting.forEach(each => each.fail()),
  };
}

describe('the editor: opening it', () => {
  // ⚠️ THE EDITOR COPIES THE DAY ONCE: opened before the day is there, it would copy an empty one
  // and a Save would write it over the real list.
  it('waits for the day when its address is opened before the seven days have answered', async () => {
    const { source, answer } = lateSource();
    renderPastries('/pastries/Thursday/edit', { source });
    await screen.findByRole('tablist', { name: 'Days' }, LOAD);

    expect(document.querySelector('[aria-busy="true"]')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('heading', { level: 2, name: 'Edit Thursday' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    act(() => { answer(); });
    await screen.findByRole('heading', { level: 2, name: 'Edit Thursday' });
    expect(rowsShown()).toEqual([['Cornetti', '24'], ['Krapfen', '12'], ['Sfogliatelle', '8']]);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('opens on what there is when the seven days cannot be read, rather than waiting for ever', async () => {
    const { source, fail } = lateSource();
    renderPastries('/pastries/Thursday/edit', { source });
    await screen.findByRole('tablist', { name: 'Days' }, LOAD);
    expect(screen.queryByRole('heading', { level: 2, name: 'Edit Thursday' })).not.toBeInTheDocument();

    act(() => { fail(); });
    await screen.findByRole('heading', { level: 2, name: 'Edit Thursday' });
    expect(rowsShown()).toEqual([['', '']]);
    expect(await within(region() as HTMLElement).findByText('Live sync interrupted — this list may be out of date.')).toBeInTheDocument();
  });

  it('opens from the pencil, with the day\'s rows and note in the working copy', async () => {
    const { router } = await openFromDay(seeded('Butter is low.\nCheck the fridge.'));
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
    expect(rowsShown()).toEqual([['Cornetti', '24'], ['Krapfen', '12'], ['Sfogliatelle', '8']]);
    expect(noteBox().value).toBe('Butter is low.\nCheck the fridge.');
  });

  it('opens from the pencil of a confirmed day once the question is answered with Edit', async () => {
    const source = fakePastriesSource({ days: [dayDoc('Thursday', THURSDAY)], logs: [logDoc('Thursday', THURSDAY)] });
    const { router, user } = renderPastries('/pastries/Thursday', { source });
    await vi.waitFor(() => { expect(within(screen.getByRole('tabpanel')).getByText('Confirmed')).toBeVisible(); }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Edit Thursday' }));
    await user.click(within(await dialog('Edit Thursday?')).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { level: 2, name: 'Edit Thursday' });
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
    expect(rowsShown()).toHaveLength(3);
  });

  it('opens an empty day on one empty row, with an empty note', async () => {
    await openByAddress(fakePastriesSource());
    expect(rowsShown()).toEqual([['', '']]);
    expect(noteBox().value).toBe('');
    expect(within(card()).getByText('0 pastries')).toBeInTheDocument();
  });

  it('is the right pane of the split: the seven days stay, the day itself does not', async () => {
    await openByAddress();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pastries');
  });

  it('puts the focus on its title when it is opened from the day', async () => {
    await openFromDay();
    expect(screen.getByRole('heading', { level: 2, name: 'Edit Thursday' })).toHaveFocus();
  });

  it('has the Back button, the title, and a Save with its icon at the top', async () => {
    await openByAddress();
    expect(within(card()).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('says how many pastries would be saved, as the rows change', async () => {
    const { user } = await openByAddress();
    expect(within(card()).getByText('3 pastries')).toBeInTheDocument();
    expect(screen.getByText('To prove for Thursday')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^Remove / })[0] as HTMLElement);
    await user.click(within(await dialog('Remove this pastry?')).getByRole('button', { name: 'Remove' }));
    expect(await within(card()).findByText('2 pastries')).toBeInTheDocument();
  });

  it('counts one pastry as «1 pastry», and a blank row as nothing', async () => {
    await openByAddress(fakePastriesSource({ days: [dayDoc('Thursday', [['Cornetti', 4]])] }));
    expect(within(card()).getByText('1 pastry')).toBeInTheDocument();
  });
});

describe('the editor: typing', () => {
  it('saves nothing while typing: the working copy is the only thing that changes', async () => {
    const source = seeded();
    const { user } = await openByAddress(source);
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.clear(qtyBoxes()[1] as HTMLElement);
    await user.type(qtyBoxes()[1] as HTMLElement, '99');
    expect(rowsShown()).toEqual([['Cornetti!', '24'], ['Krapfen', '99'], ['Sfogliatelle', '8']]);
    expect(source.saveDay).not.toHaveBeenCalled();
    expect(source.days.get('Thursday')?.items).toEqual(THURSDAY.map(([name, qty]) => ({ name, qty })));
  });

  it('keeps an emptied quantity empty, instead of snapping it to 0', async () => {
    const { user } = await openByAddress();
    await user.clear(qtyBoxes()[0] as HTMLElement);
    expect(qtyBoxes()[0]?.value).toBe('');
  });

  // ⚠️ A SNAPSHOT FROM ANOTHER PHONE MUST NOT REPAINT THE EDITOR: it holds what somebody is typing.
  it('does not repaint when another phone changes the day', async () => {
    const source = seeded('mine');
    const { user } = await openByAddress(source);
    await user.type(nameBoxes()[0] as HTMLElement, '?');

    source.days.set('Thursday', dayDoc('Thursday', [['Brioche', 6]], 'theirs'));
    act(() => { source.push(); });

    expect(rowsShown()).toEqual([['Cornetti?', '24'], ['Krapfen', '12'], ['Sfogliatelle', '8']]);
    expect(noteBox().value).toBe('mine');
  });

  it('does not repaint an editor nobody has typed in either', async () => {
    const source = seeded();
    await openByAddress(source);
    source.days.set('Thursday', dayDoc('Thursday', [['Brioche', 6]]));
    act(() => { source.push(); });
    expect(rowsShown()).toHaveLength(3);
  });

  it('suggests the names on the other six days, sorted, each once', async () => {
    const source = fakePastriesSource({
      days: [
        dayDoc('Thursday', [['Cornetti', 24]]),
        dayDoc('Monday', [['Zeppole', 3], ['Brioche', 6]]),
        dayDoc('Friday', [['Brioche', 2], ['Cornetti', 5], ['Apple turnover', 4]]),
      ],
    });
    await openByAddress(source);
    const list = document.getElementById(nameBoxes()[0]?.getAttribute('list') ?? '');
    expect(list?.tagName).toBe('DATALIST');
    // Cornetti is on Friday too, so it is suggested although it is this day's own.
    expect([...list?.querySelectorAll('option') ?? []].map(option => option.getAttribute('value')))
      .toEqual(['Apple turnover', 'Brioche', 'Cornetti', 'Zeppole']);
  });

  it('does not suggest a name that is only on this day', async () => {
    await openByAddress(seeded());
    const list = document.getElementById(nameBoxes()[0]?.getAttribute('list') ?? '');
    expect(list?.querySelectorAll('option')).toHaveLength(0);
  });

  it('gives the name box its limits, and turns the browser\'s own suggestions off', async () => {
    await openByAddress();
    const box = nameBoxes()[0] as HTMLInputElement;
    expect(box).toHaveAttribute('maxlength', '80');
    expect(box).toHaveAttribute('placeholder', 'Pastry');
    expect(box).toHaveAttribute('autocomplete', 'off');
    const qty = qtyBoxes()[0] as HTMLInputElement;
    expect(qty).toHaveAttribute('min', '0');
    expect(qty).toHaveAttribute('max', '9999');
    expect(qty).toHaveAttribute('placeholder', '0');
    expect(qty).toHaveAttribute('inputmode', 'numeric');
    expect(noteBox()).toHaveAttribute('maxlength', '500');
    expect(noteBox()).toHaveAttribute('rows', '4');
    expect(noteBox()).toHaveAttribute('placeholder', 'Anything worth remembering about this day…');
  });

  it('labels the boxes of a row by what is in it, and by «this row» when it is empty', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    expect(screen.getByRole('spinbutton', { name: 'How many pastries' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove this row' })).toBeInTheDocument();
    await user.type(nameBoxes()[0] as HTMLElement, 'Krapfen');
    expect(screen.getByRole('spinbutton', { name: 'How many Krapfen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Krapfen' })).toBeInTheDocument();
  });

  it('labels the note with where it stays, and keeps its line breaks', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    expect(screen.getByLabelText('Note — stays on Thursday until you change it')).toBe(noteBox());
    await user.type(noteBox(), 'One{Enter}Two');
    expect(noteBox().value).toBe('One\nTwo');
  });

  it('says «Unsaved changes» once anything is touched, the note included', async () => {
    const { user } = await openByAddress();
    const line = () => document.querySelector('[class*="dirty"]');
    expect(line()).toBeEmptyDOMElement();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    await user.type(noteBox(), 'x');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(line()).toHaveAttribute('role', 'status');
  });
});

describe('the editor: adding and removing rows', () => {
  it('«Add pastry» adds an empty row and puts the cursor in its name box', async () => {
    const { user } = await openByAddress();
    await user.click(screen.getByRole('button', { name: 'Add pastry' }));
    expect(rowsShown()).toHaveLength(4);
    expect(rowsShown()[3]).toEqual(['', '']);
    await waitFor(() => { expect(nameBoxes()[3]).toHaveFocus(); });
  });

  it('removes an untouched row without a question', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.click(screen.getByRole('button', { name: 'Add pastry' }));
    expect(rowsShown()).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Remove this row' })[1] as HTMLElement);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowsShown()).toHaveLength(1);
  });

  it('asks before removing a row with something in it, and Cancel keeps it', async () => {
    const { user } = await openByAddress();
    await user.click(screen.getByRole('button', { name: 'Remove Krapfen' }));
    const ask = await dialog('Remove this pastry?');
    expect(ask).toHaveAccessibleDescription('Remove Krapfen from Thursday?');
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(rowsShown()).toHaveLength(3);
  });

  it('removes it on Remove, and leaves the others as they were', async () => {
    const { user } = await openByAddress();
    await user.click(screen.getByRole('button', { name: 'Remove Krapfen' }));
    await user.click(within(await dialog('Remove this pastry?')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(rowsShown()).toEqual([['Cornetti', '24'], ['Sfogliatelle', '8']]); });
  });

  it('asks about a row that has only a number in it', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.type(qtyBoxes()[0] as HTMLElement, '5');
    await user.click(screen.getByRole('button', { name: 'Remove this row' }));
    const ask = await dialog('Remove this pastry?');
    expect(ask).toHaveAccessibleDescription('Remove this row from Thursday?');
  });

  it('leaves one empty row when the last row is removed', async () => {
    const { user } = await openByAddress(fakePastriesSource({ days: [dayDoc('Thursday', [['Cornetti', 4]])] }));
    await user.click(screen.getByRole('button', { name: 'Remove Cornetti' }));
    await user.click(within(await dialog('Remove this pastry?')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(rowsShown()).toEqual([['', '']]); });
  });

  it('puts the focus on the row that took the removed one\'s place', async () => {
    const { user } = await openByAddress();
    await user.click(screen.getByRole('button', { name: 'Remove Krapfen' }));
    await user.click(within(await dialog('Remove this pastry?')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => { expect(nameBoxes()[1]).toHaveFocus(); });
    expect(nameBoxes()[1]?.value).toBe('Sfogliatelle');
  });

  // The page behind a dialog is out of reach of a finger, but not of a stray event: the handler
  // guards the tap that does get in. A second question would REPLACE the first one, so the proof is
  // that the dialog still talks about the row it was opened for.
  it('does nothing on a tap on another bin while a question is open', async () => {
    const { user } = await openByAddress();
    const krapfen = screen.getByRole('button', { name: 'Remove Krapfen' });
    const cornetti = screen.getByRole('button', { name: 'Remove Cornetti' });
    await user.click(krapfen);
    await dialog('Remove this pastry?');
    fireEvent.click(cornetti);
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription('Remove Krapfen from Thursday?');
  });
});

describe('the editor: a blocked save', () => {
  async function trySave(user: ReturnType<typeof renderPastries>['user']) {
    await user.click(saveButton());
  }

  it('is blocked by the same name twice: the notice, the red box, the line, the focus', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.type(nameBoxes()[0] as HTMLElement, 'Cornetti');
    await user.type(qtyBoxes()[0] as HTMLElement, '5');
    await user.click(screen.getByRole('button', { name: 'Add pastry' }));
    await user.type(nameBoxes()[1] as HTMLElement, 'cornetti');
    await user.type(qtyBoxes()[1] as HTMLElement, '3');
    await trySave(user);

    const sentence = 'cornetti is on this list twice.';
    expect(alertRegion()).toHaveTextContent(sentence);
    const wrong = nameBoxes()[1] as HTMLInputElement;
    expect(wrong).toHaveAttribute('aria-invalid', 'true');
    expect(wrong.className).toMatch(/isError/);
    expect(wrong).toHaveFocus();
    // The same sentence under the row, tied to the box.
    const line = document.getElementById(wrong.getAttribute('aria-describedby') ?? '');
    expect(line).toHaveTextContent(sentence);
    expect(nameBoxes()[0]).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is blocked by a name with no number: the quantity box is the one pointed at', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.type(nameBoxes()[0] as HTMLElement, 'Krapfen');
    await trySave(user);

    expect(alertRegion()).toHaveTextContent('How many Krapfen?');
    const qty = qtyBoxes()[0] as HTMLInputElement;
    expect(qty).toHaveAttribute('aria-invalid', 'true');
    expect(qty.className).toMatch(/isError/);
    expect(qty).toHaveFocus();
    expect(nameBoxes()[0]).not.toHaveAttribute('aria-invalid');
    expect(document.getElementById(qty.getAttribute('aria-describedby') ?? '')).toHaveTextContent('How many Krapfen?');
  });

  it('is blocked by a name over 80 characters: the name box', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    // The box refuses a typed 81st character; a pasted one is what gets through.
    fireEvent.change(nameBoxes()[0] as HTMLElement, { target: { value: 'x'.repeat(81) } });
    fireEvent.change(qtyBoxes()[0] as HTMLElement, { target: { value: '4' } });
    await trySave(user);

    expect(alertRegion()).toHaveTextContent('That name is too long.');
    expect(nameBoxes()[0]).toHaveAttribute('aria-invalid', 'true');
    expect(nameBoxes()[0]).toHaveFocus();
  });

  it('is blocked by a quantity over 9999: the quantity box, said as «9999»', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.type(nameBoxes()[0] as HTMLElement, 'Cornetti');
    await user.type(qtyBoxes()[0] as HTMLElement, '10000');
    await trySave(user);

    expect(alertRegion()).toHaveTextContent('9999 is the most this can hold.');
    expect(qtyBoxes()[0]).toHaveAttribute('aria-invalid', 'true');
    expect(qtyBoxes()[0]).toHaveFocus();
  });

  it('is blocked by more rows than a day can hold: the notice only, no box', async () => {
    const full = Array.from({ length: MAX_ITEMS }, (_, index) => [`Pastry ${index + 1}`, 1] as const);
    const { user } = await openByAddress(fakePastriesSource({ days: [dayDoc('Thursday', full)] }));
    expect(rowsShown()).toHaveLength(MAX_ITEMS);
    await user.click(screen.getByRole('button', { name: 'Add pastry' }));
    await trySave(user);

    expect(alertRegion()).toHaveTextContent('That is more pastries than one day can hold.');
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  }, 30_000);

  it('does not block on a blank row, or on an empty list', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.click(screen.getByRole('button', { name: 'Add pastry' }));
    await trySave(user);
    expect(await dialog('Save Thursday?')).toBeInTheDocument();
    expect(alertRegion()).toBeEmptyDOMElement();
  });

  it('has its notice on the page, empty, before there is anything to say', async () => {
    await openByAddress();
    expect(alertRegion()).toBeEmptyDOMElement();
  });

  it('checks again as the person types, and clears the notice when the problem is fixed', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.type(nameBoxes()[0] as HTMLElement, 'Krapfen');
    await trySave(user);
    expect(alertRegion()).toHaveTextContent('How many Krapfen?');

    // Still wrong, and the sentence follows the name as it changes.
    await user.type(nameBoxes()[0] as HTMLElement, 's');
    expect(alertRegion()).toHaveTextContent('How many Krapfens?');

    await user.type(qtyBoxes()[0] as HTMLElement, '6');
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(qtyBoxes()[0]).not.toHaveAttribute('aria-invalid');
    expect(qtyBoxes()[0]).not.toHaveAttribute('aria-describedby');
    expect(qtyBoxes()[0]?.className).not.toMatch(/isError/);
  });

  it('shows nothing before a first try to save, however wrong the list is', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.type(nameBoxes()[0] as HTMLElement, 'Krapfen');
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it('scrolls the wrong box into view', async () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const { user } = await openByAddress(fakePastriesSource());
      await user.type(nameBoxes()[0] as HTMLElement, 'Krapfen');
      await trySave(user);
      expect(scroll).toHaveBeenCalled();
      expect(scroll.mock.contexts.at(-1)).toBe(qtyBoxes()[0]);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('the editor: Save', () => {
  it('asks «Save Thursday?» with the number of pastries, many', async () => {
    const { user } = await openByAddress();
    await user.click(saveButton());
    const ask = await dialog('Save Thursday?');
    expect(ask).toHaveAccessibleDescription('Save these 3 pastries for Thursday?');
    expect(within(ask).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('asks it for one pastry in the singular', async () => {
    const { user } = await openByAddress(fakePastriesSource({ days: [dayDoc('Thursday', [['Cornetti', 4]])] }));
    await user.click(saveButton());
    expect(await dialog('Save Thursday?')).toHaveAccessibleDescription('Save this pastry for Thursday?');
  });

  it('asks it for an empty list in its own words', async () => {
    const { user } = await openByAddress(fakePastriesSource());
    await user.click(saveButton());
    expect(await dialog('Save Thursday?')).toHaveAccessibleDescription('Thursday will have nothing to prove. Save that?');
  });

  it('stays in the editor, with the edits, on Cancel', async () => {
    const source = seeded();
    const { router, user } = await openByAddress(source);
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(saveButton());
    await user.click(within(await dialog('Save Thursday?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
    expect(nameBoxes()[0]?.value).toBe('Cornetti!');
    expect(source.saveDay).not.toHaveBeenCalled();
  });

  it('writes the cleaned rows and the cleaned note, says so, and returns to the day', async () => {
    const source = seeded();
    const { router, user } = await openByAddress(source);
    await user.clear(nameBoxes()[1] as HTMLElement);
    await user.clear(qtyBoxes()[1] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Add pastry' }));
    await user.type(nameBoxes()[3] as HTMLElement, '  Brioche  ');
    await user.type(qtyBoxes()[3] as HTMLElement, '6');
    await user.type(noteBox(), '  Check the fridge.  ');
    await user.click(saveButton());
    await user.click(within(await dialog('Save Thursday?')).getByRole('button', { name: 'Save' }));

    // The blank row was dropped, the name trimmed, the note trimmed.
    await waitFor(() => { expect(source.saveDay).toHaveBeenCalledTimes(1); });
    expect(source.saveDay).toHaveBeenCalledWith(
      'Thursday',
      [{ name: 'Cornetti', qty: 24 }, { name: 'Sfogliatelle', qty: 8 }, { name: 'Brioche', qty: 6 }],
      'Check the fridge.',
    );
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
    expect(await within(region() as HTMLElement).findByText('Thursday saved.')).toBeInTheDocument();
    // The day shows the new list.
    expect(screen.getByRole('button', { name: /^Brioche/ })).toBeInTheDocument();
  });

  it('keeps the note that was there when the note is left alone', async () => {
    const source = seeded('Standing note');
    const { user } = await openByAddress(source);
    await user.type(qtyBoxes()[0] as HTMLElement, '0');
    await user.click(saveButton());
    await user.click(within(await dialog('Save Thursday?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.saveDay).toHaveBeenCalled(); });
    expect(vi.mocked(source.saveDay).mock.calls[0]?.[2]).toBe('Standing note');
  });

  it('saves an emptied list as an empty day, and clears the note when it is emptied', async () => {
    const source = seeded('Old note');
    const { user } = await openByAddress(source);
    for (const name of ['Cornetti', 'Krapfen', 'Sfogliatelle']) {
      await user.click(screen.getByRole('button', { name: `Remove ${name}` }));
      await user.click(within(await dialog('Remove this pastry?')).getByRole('button', { name: 'Remove' }));
    }
    await waitFor(() => { expect(rowsShown()).toEqual([['', '']]); });
    await user.clear(noteBox());
    await user.click(saveButton());
    await user.click(within(await dialog('Save Thursday?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.saveDay).toHaveBeenCalledWith('Thursday', [], ''); });
  });

  it('leaves without the discard question once saved', async () => {
    const { router, user } = await openByAddress();
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(saveButton());
    await user.click(within(await dialog('Save Thursday?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(screen.queryByRole('alertdialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
  });

  it('puts the focus back on the pencil that opened the editor', async () => {
    const { user } = await openFromDay();
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(saveButton());
    await user.click(within(await dialog('Save Thursday?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit Thursday' })).toHaveFocus(); });
  });

  // As above: the second Save would ask a new question, counting the rows as they are by then.
  it('does nothing on a second tap on Save while the question is open', async () => {
    const { user } = await openByAddress();
    const save = saveButton();
    const third = nameBoxes()[2] as HTMLInputElement;
    await user.click(save);
    await dialog('Save Thursday?');
    fireEvent.change(third, { target: { value: '' } });
    fireEvent.click(save);
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription('Save these 3 pastries for Thursday?');
  });
});

describe('the editor: leaving with unsaved changes', () => {
  const discardTitle = 'Discard changes?';
  const discardMessage = 'You have unsaved changes to Thursday. Discard them?';

  it('asks on the Back button, in the words of the parity list', async () => {
    const { user } = await openFromDay();
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const ask = await dialog(discardTitle);
    expect(ask).toHaveAccessibleDescription(discardMessage);
    expect(within(ask).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('stays, with the edits, on Cancel', async () => {
    const { router, user } = await openFromDay();
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog(discardTitle)).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
    expect(nameBoxes()[0]?.value).toBe('Cornetti!');
    // And it still asks the next time.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await dialog(discardTitle)).toBeInTheDocument();
  });

  it('leaves WITHOUT saving on Discard', async () => {
    const source = seeded();
    const { router, user } = await openFromDay(source);
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog(discardTitle)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(source.saveDay).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /^Cornetti/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cornetti!/ })).not.toBeInTheDocument();
  });

  it('asks when a day is picked from the list of days', async () => {
    const { router, user } = await openByAddress();
    await user.type(noteBox(), 'x');
    await user.click(tab('Monday'));
    expect(await dialog(discardTitle)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');

    await user.click(within(await dialog(discardTitle)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Monday'); });
  });

  it('asks when another section is picked in the rail', async () => {
    const { router, user } = await openByAddress();
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Orders' }));
    await user.click(within(await dialog(discardTitle)).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');

    await user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Orders' }));
    await user.click(within(await dialog(discardTitle)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders'); });
  });

  it('asks when another section is picked in the tab bar', async () => {
    const { router, user } = await openByAddress();
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Orders' }));
    expect(await dialog(discardTitle)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
  });

  it('asks on the browser\'s own Back', async () => {
    const { router, user } = await openFromDay();
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    act(() => { void router.navigate(-1); });
    const ask = await dialog(discardTitle);
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
    await user.click(within(ask).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
  });

  it('asks when the note alone was changed', async () => {
    const { user } = await openFromDay();
    await user.type(noteBox(), 'x');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await dialog(discardTitle)).toBeInTheDocument();
  });

  it('asks nothing when nothing was touched', async () => {
    const { router, user } = await openFromDay();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks nothing when the day picked is the one being edited', async () => {
    const { router, user } = await openByAddress();
    await user.type(noteBox(), 'x');
    await user.click(tab('Thursday'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/pastries/Thursday/edit');
  });
});

describe('the editor: Back', () => {
  it('steps back through the history when it was opened from the day', async () => {
    const { router, user } = await openFromDay();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(router.state.historyAction).toBe('POP');
  });

  it('goes to the day, replacing the editor, when it was opened by its address', async () => {
    const { router, user } = await openByAddress();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('gives the pencil the focus back', async () => {
    const { user } = await openFromDay();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit Thursday' })).toHaveFocus(); });
  });

  // A Back that was answered «Cancel» left the editor open: the next day panel to appear (a day
  // picked from the list) must not grab the focus meant for a pencil nobody is returning to.
  it('does not hand the focus to a later day after a Back that was cancelled', async () => {
    const { router, user } = await openFromDay();
    await user.type(noteBox(), 'x');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    await user.click(tab('Monday'));
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Monday'); });
    await screen.findByRole('tabpanel');
    expect(screen.getByRole('button', { name: 'Edit Monday' })).not.toHaveFocus();
  });
});

describe('the editor: the session must not reload under unsaved edits', () => {
  it('is busy from the first change until it is saved', async () => {
    const { user } = await openByAddress();
    expect(isBusy()).toBe(false);
    await user.type(nameBoxes()[0] as HTMLElement, '!');
    expect(isBusy()).toBe(true);
    await user.click(saveButton());
    await user.click(within(await dialog('Save Thursday?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('is busy while the discard question is open, and free once discarded', async () => {
    const { user } = await openFromDay();
    await user.type(noteBox(), 'x');
    expect(isBusy()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(isBusy()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });
});

describe('the editor: in Italian', () => {
  const ITALIAN_THURSDAY = fakePastriesSource({ days: [dayDoc('Thursday', [['Cornetti', 24], ['Krapfen', 12]])] });

  it('says the title, the heading of the rows, the count and the labels in Italian', async () => {
    await openByAddress(ITALIAN_THURSDAY, 'Thursday', 'it');
    expect(screen.getByRole('heading', { level: 2, name: 'Modifica Giovedì' })).toBeInTheDocument();
    expect(screen.getByText('Da mettere per Giovedì')).toBeInTheDocument();
    expect(within(card()).getByText('2 paste')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Indietro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva' })).toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: 'Nome della pasta' })).toHaveLength(2);
    expect(screen.getByRole('spinbutton', { name: 'Quanti Cornetti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rimuovi Cornetti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi pasta' })).toBeInTheDocument();
    expect(nameBoxes()[0]).toHaveAttribute('placeholder', 'Pasta');
    expect(screen.getByLabelText('Nota — resta su Giovedì finché non la cambi')).toBe(noteBox());
    expect(noteBox()).toHaveAttribute('placeholder', 'Qualcosa da ricordare su questa giornata…');
  });

  it('names the empty row\'s boxes in Italian', async () => {
    await openByAddress(fakePastriesSource(), 'Thursday', 'it');
    expect(screen.getByRole('spinbutton', { name: 'Quante paste' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rimuovi questa riga' })).toBeInTheDocument();
  });

  it('says «Unsaved changes», the blocked-save notice and the questions in Italian', async () => {
    const source = fakePastriesSource({ days: [dayDoc('Thursday', [['Cornetti', 24]])] });
    const { user } = await openByAddress(source, 'Thursday', 'it');
    await user.click(screen.getByRole('button', { name: 'Aggiungi pasta' }));
    await user.type(nameBoxes()[1] as HTMLElement, 'cornetti');
    await user.type(qtyBoxes()[1] as HTMLElement, '3');
    expect(screen.getByText('Modifiche non salvate')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(alertRegion()).toHaveTextContent('cornetti è due volte in questa lista.');

    await user.clear(nameBoxes()[1] as HTMLElement);
    await user.clear(qtyBoxes()[1] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await dialog('Vuoi salvare Giovedì?')).toHaveAccessibleDescription('Vuoi salvare questa pasta per Giovedì?');
    await user.click(within(await dialog('Vuoi salvare Giovedì?')).getByRole('button', { name: 'Annulla' }));

    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    const ask = await dialog('Vuoi scartare le modifiche?');
    expect(ask).toHaveAccessibleDescription('Hai modifiche non salvate per Giovedì. Vuoi scartarle?');
    expect(within(ask).getByRole('button', { name: 'Scarta' })).toBeInTheDocument();
  });

  it('says the number limit as «9999» in Italian too', async () => {
    const { user } = await openByAddress(fakePastriesSource(), 'Thursday', 'it');
    await user.type(nameBoxes()[0] as HTMLElement, 'Cornetti');
    await user.type(qtyBoxes()[0] as HTMLElement, '10000');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(alertRegion()).toHaveTextContent('9999 è il massimo che può contenere.');
  });
});
