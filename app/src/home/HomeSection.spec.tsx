import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeTodosSource, permissionDenied } from '../testing/fakeTodosSource';
import type { FakeTodosSource } from '../testing/fakeTodosSource';
import { renderApp } from '../testing/renderApp';
import type { TodoItem } from './todosSource';

// Friday 6 November 2026, 09:00. Only Date is faked: user-event and the router keep their real timers.
const NOW = new Date(2026, 10, 6, 9, 0, 0);
const DAY_MS = 86_400_000;

let counter = 0;
function todo(text: string, day: string, extra: Partial<TodoItem> = {}): TodoItem {
  counter += 1;
  return { id: `t${counter}`, text, day, done: false, doneAtMs: null, createdAtMs: counter, ...extra };
}

function fixtures(): TodoItem[] {
  return [
    todo('Pay the electrician', '2026-11-03'),
    todo('Call the flour mill', '2026-11-06'),
    todo('Clean the oven', '2026-11-06', { done: true, doneAtMs: NOW.getTime() - 1000 }),
    todo('Check the delivery', '2026-11-07'),
    todo('Plan the week', '2026-11-09'),
    todo('Book the van', '2026-11-20'),
    todo('Send the invoice', '2026-11-02', { done: true, doneAtMs: NOW.getTime() - DAY_MS }),
    todo('Old tick', '2026-09-01', { done: true, doneAtMs: NOW.getTime() - 40 * DAY_MS }),
  ];
}

async function open(seed: TodoItem[] = fixtures(), options: NonNullable<Parameters<typeof renderApp>[1]> = {}) {
  const source = fakeTodosSource(seed);
  const view = renderApp('/home', { ...options, data: { todos: () => source } });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Da fare' : 'To do' });
  return { ...view, source };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const heading3 = (name: string | RegExp) => screen.getByRole('heading', { level: 3, name });
const dialog = (name: string) => screen.findByRole('dialog', { name });
const addButton = () => screen.getByRole('button', { name: 'Add' });
// A modal hides the rest of the page from assistive technology, so the rail is asked for by `hidden`.
const settingsLink = () => within(screen.getByRole('navigation', { name: 'All sections', hidden: true }))
  .getByRole('link', { name: 'Settings', hidden: true });

describe('Home: the card', () => {
  it('has the page title, the card title and one main', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(addButton()).toBeInTheDocument();
  });

  it('draws the groups in order: overdue, today, tomorrow, a later day of the week', async () => {
    await open();
    const titles = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(titles).toEqual(['Overdue', 'Today', 'Tomorrow', 'Monday 9 November']);
  });

  it('shows the overdue item with its day, and the ticked one of today struck in place', async () => {
    await open();
    const overdue = screen.getByRole('button', { name: /Pay the electrician/ });
    expect(overdue).toHaveTextContent('overdue · Tue 3 Nov');
    expect(screen.getByRole('checkbox', { name: 'Clean the oven' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Call the flour mill' })).not.toBeChecked();
  });

  it('folds «Later» and «Done» closed by default, with their counts, and opens them on a tap', async () => {
    const { user } = await open();
    const later = screen.getByText('Later (1)').closest('details') as HTMLDetailsElement;
    const done = screen.getByText('Done (1)').closest('details') as HTMLDetailsElement;
    expect(later.open).toBe(false);
    expect(done.open).toBe(false);

    await user.click(screen.getByText('Later (1)'));
    expect(later.open).toBe(true);
    expect(within(later).getByRole('button', { name: /Book the van/ })).toHaveTextContent('Fri 20 Nov');
    expect(within(done).getByRole('button', { name: /Send the invoice/ })).toHaveTextContent('Mon 2 Nov');
  });

  it('hides a ticked item older than 30 days', async () => {
    await open();
    expect(screen.queryByText('Old tick')).not.toBeInTheDocument();
  });

  it('says there is nothing to do for an empty list, and keeps Add', async () => {
    await open([]);
    expect(await screen.findByText('Nothing to do for now.')).toBeInTheDocument();
    expect(addButton()).toBeInTheDocument();
  });

  it('says the list does not load when the stream fails', async () => {
    const { source } = await open([]);
    source.breakStreams();
    expect(await screen.findByText('The list does not load. Check the connection.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to do for now.')).not.toBeInTheDocument();
  });

  it('is in Italian', async () => {
    await open(fixtures(), { lang: 'it' });
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeInTheDocument();
    expect(heading3('In ritardo')).toBeInTheDocument();
    expect(heading3('Oggi')).toBeInTheDocument();
    expect(heading3('Domani')).toBeInTheDocument();
    expect(heading3('Lunedì 9 novembre')).toBeInTheDocument();
    expect(screen.getByText('Più avanti (1)')).toBeInTheDocument();
    expect(screen.getByText('Fatte (1)')).toBeInTheDocument();
  });

  it('stops listening when the Home is left', async () => {
    const { user, source } = await open();
    expect(source.watching()).toBe(1);
    await user.click(within(screen.getByRole('navigation', { name: 'All sections' })).getByRole('link', { name: 'Settings' }));
    await waitFor(() => { expect(source.watching()).toBe(0); });
  });
});

describe('Home: ticking', () => {
  it('ticks and unticks in one tap, with no question', async () => {
    const { user, source } = await open();
    const box = screen.getByRole('checkbox', { name: 'Call the flour mill' });

    await user.click(box);
    expect(source.setDone).toHaveBeenCalledWith(expect.any(String), true);
    await waitFor(() => { expect(screen.getByRole('checkbox', { name: 'Call the flour mill' })).toBeChecked(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Call the flour mill' }));
    expect(source.setDone).toHaveBeenLastCalledWith(expect.any(String), false);
    await waitFor(() => { expect(screen.getByRole('checkbox', { name: 'Call the flour mill' })).not.toBeChecked(); });
  });

  it('moves a ticked item of a past day into «Done»', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Pay the electrician' }));
    await waitFor(() => { expect(screen.getByText('Done (2)')).toBeInTheDocument(); });
    expect(screen.queryByRole('heading', { level: 3, name: 'Overdue' })).not.toBeInTheDocument();
  });

  it('says so when a tick is refused', async () => {
    const { user, source } = await open();
    source.refuseWith = permissionDenied();
    await user.click(screen.getByRole('checkbox', { name: 'Call the flour mill' }));
    expect(await screen.findByText('Not saved: you have no access to this list.')).toBeInTheDocument();
  });

  it('says «not saved» for another failure', async () => {
    const { user, source } = await open();
    source.refuseWith = new Error('unavailable');
    await user.click(screen.getByRole('checkbox', { name: 'Call the flour mill' }));
    expect(await screen.findByText('Not saved. Try again.')).toBeInTheDocument();
  });
});

describe('Home: adding', () => {
  it('opens an empty form, with today chosen and a 200-character field', async () => {
    const { user } = await open();
    await user.click(addButton());

    const form = await dialog('New to-do');
    const field = within(form).getByRole('textbox', { name: 'What needs doing' });
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'E.g. call the flour mill');
    expect(field).toHaveAttribute('maxlength', '200');
    expect(field).toHaveFocus();
    expect(within(form).getByText('0 / 200')).toBeInTheDocument();
    expect(within(form).getByLabelText('Day')).toHaveValue('2026-11-06');
    expect(within(form).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('saves a new item for tomorrow, closes at once and gives the focus back to Add', async () => {
    const { user, source } = await open([]);
    await user.click(addButton());
    const form = await dialog('New to-do');

    await user.type(within(form).getByRole('textbox', { name: 'What needs doing' }), '  Order butter ');
    expect(within(form).getByText('15 / 200')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Tomorrow' }));
    expect(within(form).getByLabelText('Day')).toHaveValue('2026-11-07');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(source.add).toHaveBeenCalledWith('Order butter', '2026-11-07');
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New to-do' })).not.toBeInTheDocument(); });
    expect(await screen.findByRole('checkbox', { name: 'Order butter' })).toBeInTheDocument();
    expect(heading3('Tomorrow')).toBeInTheDocument();
    await waitFor(() => { expect(addButton()).toHaveFocus(); });
  });

  it('takes a day picked in the date field, a past one too', async () => {
    const { user, source } = await open([]);
    await user.click(addButton());
    const form = await dialog('New to-do');

    await user.type(within(form).getByRole('textbox', { name: 'What needs doing' }), 'Fix the scale');
    const day = within(form).getByLabelText('Day');
    fireEvent.change(day, { target: { value: '2026-11-01' } });
    expect(day).toHaveValue('2026-11-01');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(source.add).toHaveBeenCalledWith('Fix the scale', '2026-11-01');
    expect(await screen.findByRole('heading', { level: 3, name: 'Overdue' })).toBeInTheDocument();
  });

  it('blocks an empty or blank text, focuses the field and says why', async () => {
    const { user, source } = await open([]);
    await user.click(addButton());
    const form = await dialog('New to-do');
    const field = within(form).getByRole('textbox', { name: 'What needs doing' });

    await user.type(field, '   ');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(source.add).not.toHaveBeenCalled();
    expect(await within(form).findByText('Write what needs doing.')).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'New to-do' })).toBeInTheDocument();

    await user.type(field, 'Now it has words');
    expect(within(form).queryByText('Write what needs doing.')).not.toBeInTheDocument();
  });

  it('saves with Enter in the text field', async () => {
    const { user, source } = await open([]);
    await user.click(addButton());
    const form = await dialog('New to-do');

    await user.type(within(form).getByRole('textbox', { name: 'What needs doing' }), 'Quick one{Enter}');

    expect(source.add).toHaveBeenCalledWith('Quick one', '2026-11-06');
  });

  it('closes without a question when nothing was typed', async () => {
    const { user } = await open([]);
    await user.click(addButton());
    const form = await dialog('New to-do');

    await user.click(within(form).getByRole('button', { name: 'Back' }));

    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New to-do' })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(addButton()).toHaveFocus(); });
  });

  it('asks before throwing typing away: keep goes on, discard closes and writes nothing', async () => {
    const { user, source } = await open([]);
    await user.click(addButton());
    const form = await dialog('New to-do');
    await user.type(within(form).getByRole('textbox', { name: 'What needs doing' }), 'Half a thought');

    await user.click(within(form).getByRole('button', { name: 'Back' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'New to-do' })).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'What needs doing' })).toHaveValue('Half a thought');

    await user.click(within(form).getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));

    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New to-do' })).not.toBeInTheDocument(); });
    expect(source.add).not.toHaveBeenCalled();
  });

  it('asks before leaving the screen with typing in the form', async () => {
    const { user, router } = await open([]);
    await user.click(addButton());
    const form = await dialog('New to-do');
    await user.type(within(form).getByRole('textbox', { name: 'What needs doing' }), 'Half a thought');

    await user.click(settingsLink());

    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/home');

    await user.click(settingsLink());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
  });

  it('says «not saved» when the write is refused after the form has closed', async () => {
    const { user, source } = await open([]);
    source.refuseWith = permissionDenied();
    await user.click(addButton());
    const form = await dialog('New to-do');
    await user.type(within(form).getByRole('textbox', { name: 'What needs doing' }), 'Nobody lets me');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Not saved: you have no access to this list.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New to-do' })).not.toBeInTheDocument();
  });
});

describe('Home: editing and deleting', () => {
  it('opens the item in the form, saves the changes and gives the focus back to its row', async () => {
    const { user, source } = await open();
    await user.click(screen.getByRole('button', { name: /Call the flour mill/ }));

    const form = await dialog('Edit to-do');
    const field = within(form).getByRole('textbox', { name: 'What needs doing' });
    expect(field).toHaveValue('Call the flour mill');
    expect(within(form).getByLabelText('Day')).toHaveValue('2026-11-06');

    await user.clear(field);
    await user.type(field, 'Call the other mill');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(source.edit).toHaveBeenCalledWith(expect.any(String), 'Call the other mill', '2026-11-06');
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit to-do' })).not.toBeInTheDocument(); });
    const row = await screen.findByRole('button', { name: /Call the other mill/ });
    await waitFor(() => { expect(row).toHaveFocus(); });
  });

  it('writes nothing when Save is pressed with no change', async () => {
    const { user, source } = await open();
    await user.click(screen.getByRole('button', { name: /Call the flour mill/ }));
    const form = await dialog('Edit to-do');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(source.edit).not.toHaveBeenCalled();
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit to-do' })).not.toBeInTheDocument(); });
  });

  it('moves an item to another day', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: /Call the flour mill/ }));
    const form = await dialog('Edit to-do');
    await user.click(within(form).getByRole('button', { name: 'Tomorrow' }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const tomorrow = heading3('Tomorrow').parentElement as HTMLElement;
      expect(within(tomorrow).getByRole('checkbox', { name: 'Call the flour mill' })).toBeInTheDocument();
    });
  });

  it('asks before deleting, names the item, and deletes on the answer', async () => {
    const { user, source } = await open();
    await user.click(screen.getByRole('button', { name: /Call the flour mill/ }));
    const form = await dialog('Edit to-do');

    await user.click(within(form).getByRole('button', { name: 'Delete' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Delete “Call the flour mill”?')).toBeInTheDocument();

    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(source.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit to-do' })).toBeInTheDocument();

    await user.click(within(form).getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    expect(source.remove).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit to-do' })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('checkbox', { name: 'Call the flour mill' })).not.toBeInTheDocument();
    await waitFor(() => { expect(addButton()).toHaveFocus(); });
  });

  it('asks to discard when the edit changed something and Back is pressed', async () => {
    const { user, source } = await open();
    await user.click(screen.getByRole('button', { name: /Call the flour mill/ }));
    const form = await dialog('Edit to-do');
    await user.type(within(form).getByRole('textbox', { name: 'What needs doing' }), '!');

    await user.click(within(form).getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));

    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit to-do' })).not.toBeInTheDocument(); });
    expect(source.edit).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Call the flour mill' })).toBeInTheDocument();
  });
});
