import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakePastriesSource } from '../testing/fakePastriesSource';
import type { FakePastriesSource } from '../testing/fakePastriesSource';
import { holdConfirmations } from '../testing/holdAnswers';
import { WORK_DATE, dayDoc, freezeClock, logDoc, renderPastries } from '../testing/renderPastries';

// «Copy day»: the picker, the questions asked after it, and the editor it opens pre-filled. Everything
// runs against the real store on an in-memory source; the clock is Wednesday 14 October 2026, 21:00,
// so the day being proved for is Thursday and tonight's work date is 2026-10-14.

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
// Thursday: the day that gets copied, with a note on one row.
const THURSDAY = [['Cornetti', 24, '9x3'], ['Krapfen', 12], ['Sfogliatelle', 8]] as const;
const FRIDAY = [['Brioche', 6], ['Bomboloni', 4]] as const;
const COPIED = 'The list of Thursday has been copied here. Check it, then tap Save to keep it.';

const dialog = (name: string) => screen.findByRole('alertdialog', { name });
const copyButton = () => screen.getByRole('button', { name: 'Copy day' });
const nameBoxes = () => screen.getAllByRole('combobox', { name: 'Pastry name' }) as HTMLInputElement[];
const qtyBoxes = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];
const rowNotes = () => screen.getAllByRole('textbox', { name: /^Note for / }) as HTMLInputElement[];
const standingNote = () => screen.getByRole('textbox', { name: /^Note — / }) as HTMLTextAreaElement;
const region = () => document.querySelector('[role="status"][class*="region"]') as HTMLElement;
const aFrame = () => new Promise(resolve => { setTimeout(resolve, 60); });

// The rows as the editor shows them: [name, quantity, note].
const rowsShown = () => nameBoxes().map((box, index) => [box.value, qtyBoxes()[index]?.value, rowNotes()[index]?.value]);

function seeded(options: { friday?: boolean; recordedFriday?: boolean; fridayNote?: string } = {}): FakePastriesSource {
  return fakePastriesSource({
    days: [
      dayDoc('Thursday', THURSDAY),
      ...(options.friday ? [dayDoc('Friday', FRIDAY, options.fridayNote ?? '')] : [dayDoc('Friday', [], options.fridayNote ?? '')]),
    ],
    logs: options.recordedFriday ? [logDoc('Friday', FRIDAY)] : [],
  });
}

// The day, with both first answers in: Confirm is enabled, or the day is recorded and shows Edit.
async function openDay(source: FakePastriesSource, day = 'Thursday') {
  const view = renderPastries(`/pastries/${day}`, { source });
  await screen.findByRole('tabpanel', undefined, LOAD);
  await vi.waitFor(() => {
    const confirmButton = screen.queryByRole('button', { name: 'Confirm' });
    const editButton = screen.queryByRole('button', { name: 'Edit' });
    expect(confirmButton !== null ? !confirmButton.hasAttribute('disabled') : editButton !== null).toBe(true);
  }, LOAD);
  return view;
}

// Pressing «Copy day» and choosing a target; stops at the first question after the picker.
async function pickTarget(user: ReturnType<typeof renderPastries>['user'], target?: string) {
  await user.click(copyButton());
  const picker = await dialog('Copy the list of Thursday?');
  if (target) await user.click(within(picker).getByRole('radio', { name: new RegExp(`^${target}`) }));
  await user.click(within(picker).getByRole('button', { name: 'Continue' }));
}

describe('Copy day: the button', () => {
  it('sits beside Records at the end of the day, with its icon hidden from assistive technology', async () => {
    await openDay(seeded());
    const button = copyButton();
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button.parentElement).toBe(screen.getByRole('link', { name: 'Records' }).parentElement);
  });

  it('is there even on an empty day, and says so when there is nothing to copy', async () => {
    const { user } = await openDay(seeded(), 'Friday');
    await user.click(copyButton());
    expect(await within(region()).findByText('The list of Friday is empty: there is nothing to copy.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks to try again while the answers are not all in', async () => {
    const source = seeded();
    holdConfirmations(source);
    const { user } = renderPastries('/pastries/Thursday', { source });
    await screen.findByRole('button', { name: /^Cornetti/ }, LOAD);
    await user.click(copyButton());
    expect(await within(region()).findByText('The list hasn’t arrived yet — try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('Copy day: the picker', () => {
  it('lists the six other days, the next first and chosen, each with its count', async () => {
    const { user } = await openDay(seeded({ friday: true }));
    await user.click(copyButton());
    const picker = await dialog('Copy the list of Thursday?');
    expect(picker).toHaveAccessibleDescription('Choose the day to copy it onto. Quantities and notes go with it.');

    const group = within(picker).getByRole('radiogroup', { name: 'Copy onto' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map(radio => radio.value)).toEqual(['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday']);
    expect(radios.map(radio => radio.checked)).toEqual([true, false, false, false, false, false]);
    expect(radios[0]).toHaveAccessibleName(/^Friday\s*2 pastries$/);
    expect(radios[1]).toHaveAccessibleName(/^Saturday\s*Nothing$/);
    // The radios share one group.
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1);

    await user.click(radios[2] as HTMLElement);
    expect(radios.map(radio => radio.checked)).toEqual([false, false, true, false, false, false]);
    expect(within(picker).getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('writes nothing and goes nowhere on Cancel', async () => {
    const source = seeded();
    const { router, user } = await openDay(source);
    await user.click(copyButton());
    await user.click(within(await dialog('Copy the list of Thursday?')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/pastries/Thursday');
    expect(source.saveDay).not.toHaveBeenCalled();
  });

  it('ignores a second tap while the picker is open', async () => {
    const { user } = await openDay(seeded());
    const button = copyButton();
    await user.click(button);
    const picker = await dialog('Copy the list of Thursday?');
    // The page behind the dialog is inert for a real tap; the handler is called directly. Were the
    // guard missing, the second question would answer the first with «no» and Continue would do nothing.
    act(() => { button.click(); });
    await user.click(within(picker).getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });
  });
});

describe('Copy day: onto an empty day', () => {
  it('opens the target\'s editor with the source\'s rows and notes, the target\'s own standing note and a copied notice', async () => {
    const source = seeded({ fridayNote: 'Friday closes early.' });
    const { router, user } = await openDay(source);
    await pickTarget(user);

    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });
    expect(router.state.location.pathname).toBe('/pastries/Friday/edit');
    expect(rowsShown()).toEqual([['Cornetti', '24', '9x3'], ['Krapfen', '12', ''], ['Sfogliatelle', '8', '']]);
    expect(standingNote().value).toBe('Friday closes early.');
    // The notice is a live region that was on the page empty and then filled.
    expect(await screen.findByText(COPIED)).toHaveAttribute('role', 'status');
    expect(source.saveDay).not.toHaveBeenCalled();
  });

  it('is unsaved from the start: the line shows, the session is busy, and Back asks first', async () => {
    const source = seeded();
    const { router, user } = await openDay(source);
    await pickTarget(user);
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await waitFor(() => { expect(isBusy()).toBe(true); });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    const ask = await dialog('Discard changes?');
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/pastries/Friday/edit');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
    expect(source.saveDay).not.toHaveBeenCalled();
    expect(source.days.get('Friday')?.items).toEqual([]);
    await waitFor(() => { expect(isBusy()).toBe(false); });
    // The button that started it takes the focus back.
    await aFrame();
    expect(copyButton()).toHaveFocus();
  });

  it('saves the copy on Save, with the notes, and lands on the target day', async () => {
    const source = seeded({ fridayNote: 'Friday closes early.' });
    const { router, user } = await openDay(source);
    await pickTarget(user);
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save Friday?')).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(source.saveDay).toHaveBeenCalledTimes(1); });
    expect(source.saveDay).toHaveBeenCalledWith(
      'Friday',
      [{ name: 'Cornetti', qty: 24, note: '9x3' }, { name: 'Krapfen', qty: 12 }, { name: 'Sfogliatelle', qty: 8 }],
      'Friday closes early.',
    );
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Friday'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
    expect(await within(region()).findByText('Friday saved.')).toBeInTheDocument();
    // Nothing was recorded, so nothing was granted.
    expect(window.localStorage.getItem('pastries-edit-Friday')).toBeNull();
    // The pencil takes the focus, as after any other save.
    await aFrame();
    expect(screen.getByRole('button', { name: 'Edit Friday' })).toHaveFocus();
    expect(isBusy()).toBe(false);
  });
});

describe('Copy day: onto a day that already has a list', () => {
  const replaceTitle = 'Replace the list of Friday?';

  it('asks to replace it; Cancel stops and nothing opens', async () => {
    const { router, user } = await openDay(seeded({ friday: true }));
    await pickTarget(user);
    const ask = await dialog(replaceTitle);
    expect(ask).toHaveAccessibleDescription('The list of Friday already has 2 pastries. It will be replaced by the list of Thursday. Nothing is saved until you tap Save.');
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await aFrame();
    expect(router.state.location.pathname).toBe('/pastries/Thursday');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('opens the editor with the copy once Replace is pressed', async () => {
    const { router, user } = await openDay(seeded({ friday: true }));
    await pickTarget(user);
    await user.click(within(await dialog(replaceTitle)).getByRole('button', { name: 'Replace' }));
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });
    expect(router.state.location.pathname).toBe('/pastries/Friday/edit');
    expect(rowsShown().map(([name]) => name)).toEqual(['Cornetti', 'Krapfen', 'Sfogliatelle']);
  });
});

describe('Copy day: onto a recorded day', () => {
  const lockTitle = 'Edit Friday?';
  const replaceTitle = 'Replace the list of Friday?';
  const recorded = () => seeded({ friday: true, recordedFriday: true, fridayNote: 'Friday closes early.' });

  // Friday has rows AND is recorded, so both questions come: replace, then the lock.
  async function toLockQuestion() {
    const source = recorded();
    const view = await openDay(source);
    await pickTarget(view.user);
    await view.user.click(within(await dialog(replaceTitle)).getByRole('button', { name: 'Replace' }));
    return { ...view, source, ask: await dialog(lockTitle) };
  }

  it('asks the lock question, and Cancel stops without granting anything', async () => {
    const { router, user, ask } = await toLockQuestion();
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await aFrame();
    expect(router.state.location.pathname).toBe('/pastries/Thursday');
    expect(window.localStorage.getItem('pastries-edit-Friday')).toBeNull();
  });

  // ⚠️ THE DEFECT OF THE CURRENT APP, fixed there in ae7a415a: a copy thrown away must not leave a
  // recorded day open.
  it('opens the copy WITHOUT granting; a discarded copy leaves the recorded day locked', async () => {
    const { router, user, ask } = await toLockQuestion();
    await user.click(within(ask).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });
    expect(window.localStorage.getItem('pastries-edit-Friday')).toBeNull();
    expect(rowsShown().map(([name]) => name)).toEqual(['Cornetti', 'Krapfen', 'Sfogliatelle']);
    // The editor does not ask the question a second time.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await dialog('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Thursday'); });

    expect(window.localStorage.getItem('pastries-edit-Friday')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /^Friday( |$)/ }));
    await waitFor(() => { expect(within(screen.getByRole('tabpanel')).getByText('Confirmed')).toBeVisible(); });
  });

  it('grants and then saves on Save, the notes in the payload, and lands on the unlocked target', async () => {
    const { source, router, user, ask } = await toLockQuestion();
    await user.click(within(ask).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save Friday?')).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(router.state.location.pathname).toBe('/pastries/Friday'); });
    expect(source.saveDay).toHaveBeenCalledWith(
      'Friday',
      [{ name: 'Cornetti', qty: 24, note: '9x3' }, { name: 'Krapfen', qty: 12 }, { name: 'Sfogliatelle', qty: 8 }],
      'Friday closes early.',
    );
    expect(window.localStorage.getItem('pastries-edit-Friday')).toBe(WORK_DATE);
    await screen.findByRole('tabpanel');
    expect(await screen.findByRole('button', { name: /^Cornetti/ })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getByText('9x3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible();
  });
});

describe('Copy day: the answers are looked at again after every question', () => {
  it('says there is nothing to copy when the source is emptied while the picker is open', async () => {
    const source = seeded();
    const { router, user } = await openDay(source);
    await user.click(copyButton());
    const picker = await dialog('Copy the list of Thursday?');
    source.days.set('Thursday', dayDoc('Thursday', []));
    act(() => { source.push(); });
    await user.click(within(picker).getByRole('button', { name: 'Continue' }));

    expect(await within(region()).findByText('The list of Thursday is empty: there is nothing to copy.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/pastries/Thursday');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks to replace a target that was empty when the picker opened and has rows now', async () => {
    const source = seeded();
    const { user } = await openDay(source);
    await user.click(copyButton());
    const picker = await dialog('Copy the list of Thursday?');
    source.days.set('Friday', dayDoc('Friday', FRIDAY));
    act(() => { source.push(); });
    await user.click(within(picker).getByRole('button', { name: 'Continue' }));
    expect(await dialog('Replace the list of Friday?')).toBeInTheDocument();
  });

  it('asks the lock question too when the target is confirmed while the replace question is open', async () => {
    const source = seeded({ friday: true });
    const { router, user } = await openDay(source);
    await pickTarget(user);
    const replace = await dialog('Replace the list of Friday?');

    source.logs.set(`${WORK_DATE}_Friday`, logDoc('Friday', FRIDAY));
    act(() => { source.push(); });
    await user.click(within(replace).getByRole('button', { name: 'Replace' }));

    const lock = await dialog('Edit Friday?');
    expect(router.state.location.pathname).toBe('/pastries/Thursday');
    await user.click(within(lock).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });
    expect(window.localStorage.getItem('pastries-edit-Friday')).toBeNull();
  });

  it('stops silently when the person has moved to another day during a question', async () => {
    const { router, user } = await openDay(seeded({ friday: true }));
    await pickTarget(user);
    const replace = await dialog('Replace the list of Friday?');
    act(() => { void router.navigate('/pastries/Monday', { replace: true }); });
    await user.click(within(replace).getByRole('button', { name: 'Replace' }));
    await aFrame();
    expect(router.state.location.pathname).toBe('/pastries/Monday');
  });
});

describe('Copy day: the editor opened by its address with a copy request', () => {
  const entry = (editAgreedOn: string | null, from = 'Thursday') => [
    { pathname: '/pastries/Friday/edit', state: { copy: { from, editAgreedOn } } },
  ];
  const recorded = () => seeded({ friday: true, recordedFriday: true });

  it('asks the lock question again when the old yes is from another work date', async () => {
    renderPastries('', { source: recorded(), entries: entry('2026-10-13') });
    expect(await dialog('Edit Friday?')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Edit Friday' })).not.toBeInTheDocument();
  });

  it('opens at once, without a question, when the yes is from tonight\'s work date', async () => {
    renderPastries('', { source: recorded(), entries: entry(WORK_DATE) });
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' }, LOAD);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowsShown().map(([name]) => name)).toEqual(['Cornetti', 'Krapfen', 'Sfogliatelle']);
    expect(window.localStorage.getItem('pastries-edit-Friday')).toBeNull();
  });

  it('turns a Yes to the question into a copy that grants only on Save', async () => {
    const { user } = renderPastries('', { source: recorded(), entries: entry(null) });
    await user.click(within(await dialog('Edit Friday?')).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' });
    expect(window.localStorage.getItem('pastries-edit-Friday')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await dialog('Save Friday?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(window.localStorage.getItem('pastries-edit-Friday')).toBe(WORK_DATE); });
  });

  it('is an ordinary edit when the source day has no rows', async () => {
    renderPastries('', { source: seeded({ friday: true }), entries: entry(null, 'Saturday') });
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' }, LOAD);
    expect(rowsShown().map(([name]) => name)).toEqual(['Brioche', 'Bomboloni']);
    expect(screen.queryByText(COPIED)).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('is an ordinary edit when the state is not a copy request', async () => {
    renderPastries('', {
      source: seeded({ friday: true }),
      entries: [{ pathname: '/pastries/Friday/edit', state: { copy: { from: 'Nope', editAgreedOn: null } } }],
    });
    await screen.findByRole('heading', { level: 2, name: 'Edit Friday' }, LOAD);
    expect(rowsShown().map(([name]) => name)).toEqual(['Brioche', 'Bomboloni']);
  });
});

describe('Copy day: in Italian', () => {
  it('asks and explains in Italian', async () => {
    const { user } = renderPastries('/pastries/Thursday', { source: seeded(), lang: 'it' });
    await screen.findByRole('tabpanel', undefined, LOAD);
    await vi.waitFor(() => { expect(screen.getByRole('button', { name: 'Conferma' })).toBeEnabled(); }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Copia giorno' }));
    const picker = await screen.findByRole('alertdialog', { name: 'Vuoi copiare la lista di Giovedì?' });
    await user.click(within(picker).getByRole('button', { name: 'Continua' }));
    await screen.findByText('La lista di Giovedì è stata copiata qui. Controllala e tocca Salva per tenerla.');
  });
});
