import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeFeedbackSource } from '../testing/fakeFeedbackSource';
import { renderApp } from '../testing/renderApp';
import { MISE2_VERSION } from '../telemetry/version';
import { REFUSAL_WAIT_MS } from './FeedbackDialog';

// «Nota per Claude»: the button in the top bar (and the phone's row in «More»), the dialog, and what is written.

const ON = { location: { feedbackToClaude: true } };
const noteButtons = () => screen.queryAllByRole('button', { name: 'Note to Claude' });

beforeAll(async () => { await import('../recipes/RecipesSection'); }, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function openNote(path = '/orders', session: Record<string, unknown> = ON) {
  const source = fakeFeedbackSource();
  const view = renderApp(path, { session, data: { feedback: () => source } });
  await screen.findByRole('heading', { level: 1 });
  await view.user.click(screen.getByRole('button', { name: 'Note to Claude' }));
  const dialog = await screen.findByRole('dialog', { name: 'Note to Claude' });
  return { ...view, source, dialog };
}

describe('where the note button is', () => {
  test('in the top bar of a venue whose switch is on, on every section', async () => {
    renderApp('/orders', { session: ON });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Note to Claude' })).toBeInTheDocument();
  });

  test('nowhere when the venue has no switch, or has it as anything but a real true', async () => {
    renderApp('/orders', { session: { location: { feedbackToClaude: 'yes' } } });
    await screen.findByRole('heading', { level: 1 });
    expect(noteButtons()).toHaveLength(0);
  });

  test('nowhere on a venue with no key at all', async () => {
    renderApp('/home');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(noteButtons()).toHaveLength(0);
  });

  test('on a phone the same action is a row of «More»', async () => {
    const { user } = renderApp('/more', { session: ON });
    await screen.findByRole('heading', { level: 1, name: 'More' });
    const row = within(screen.getByRole('main')).getByRole('button', { name: 'Note to Claude' });
    await user.click(row);
    expect(await screen.findByRole('dialog', { name: 'Note to Claude' })).toBeInTheDocument();
  });

  test('is named in Italian', async () => {
    renderApp('/orders', { lang: 'it', session: { ...ON, language: 'it' } });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Nota per Claude' })).toBeInTheDocument();
  });
});

describe('the dialog', () => {
  test('says where the note is written and starts with Send off', async () => {
    const { dialog } = await openNote('/orders');
    expect(within(dialog).getByPlaceholderText('What should change?')).toHaveFocus();
    expect(within(dialog).getByText('From: Orders')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  test('Send stays off for spaces only', async () => {
    const { dialog, user } = await openNote();
    await user.type(within(dialog).getByPlaceholderText('What should change?'), '   ');
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  test('Send writes exactly the keys the rules accept, closes at once and says «Note sent.»', async () => {
    const { dialog, user, source } = await openNote('/orders');
    await user.type(within(dialog).getByPlaceholderText('What should change?'), '  Bigger buttons  ');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));

    expect(source.sent).toHaveLength(1);
    expect(source.sent[0]).toEqual({
      uid: 'u1',
      note: { text: 'Bigger buttons', screen: 'orders', appVersion: MISE2_VERSION },
    });
    expect(source.sent[0]?.note.screen.length).toBeLessThanOrEqual(40);
    expect(MISE2_VERSION.length).toBeLessThanOrEqual(12);
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Note to Claude' })).not.toBeInTheDocument(); });
    expect(await screen.findByText('Note sent.')).toBeInTheDocument();
  });

  test('offline it does not wait for the server: the dialog closes with the write queued', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const { dialog, user, source } = await openNote();
    source.mode = 'hang';
    await user.type(within(dialog).getByPlaceholderText('What should change?'), 'No signal here');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Note to Claude' })).not.toBeInTheDocument(); });
    expect(source.sent).toHaveLength(1);
    expect(await screen.findByText('Note sent.')).toBeInTheDocument();
  });

  test('online, a server that is slow to answer does not hold the dialog past the short wait', async () => {
    const { dialog, user, source } = await openNote();
    source.mode = 'hang';
    await user.type(within(dialog).getByPlaceholderText('What should change?'), 'Slow line');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(
      () => { expect(screen.queryByRole('dialog', { name: 'Note to Claude' })).not.toBeInTheDocument(); },
      { timeout: REFUSAL_WAIT_MS + 3000 },
    );
    expect(await screen.findByText('Note sent.')).toBeInTheDocument();
  }, REFUSAL_WAIT_MS + 8000);

  test('a refusal shows one short line and keeps the text', async () => {
    const { dialog, user, source } = await openNote();
    source.mode = 'refuse';
    await user.type(within(dialog).getByPlaceholderText('What should change?'), 'Switch went off');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Couldn’t send. Try again.');
    expect(within(dialog).getByPlaceholderText('What should change?')).toHaveValue('Switch went off');
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.queryByText('Note sent.')).not.toBeInTheDocument();
  });

  test('Cancel with nothing typed closes without a question', async () => {
    const { dialog, user } = await openNote();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Note to Claude' })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('Cancel with typing asks first; «Keep writing» keeps the text, «Discard» throws it away', async () => {
    const { dialog, user, source } = await openNote();
    await user.type(within(dialog).getByPlaceholderText('What should change?'), 'Half a thought');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard the note?' });
    await user.click(within(question).getByRole('button', { name: 'Keep writing' }));
    expect(screen.getByPlaceholderText('What should change?')).toHaveValue('Half a thought');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Note to Claude' })).not.toBeInTheDocument(); });
    expect(source.sent).toHaveLength(0);
  });

  test('the text is held as unsaved work while it is typed (no self-started reload)', async () => {
    const { isBusy } = await import('../session/busy');
    const { dialog, user } = await openNote();
    expect(isBusy()).toBe(false);
    await user.type(within(dialog).getByPlaceholderText('What should change?'), 'x');
    expect(isBusy()).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  test('in Italian: the words and «Da: Ordini»', async () => {
    const source = fakeFeedbackSource();
    const { user } = renderApp('/orders', { lang: 'it', session: { ...ON, language: 'it' }, data: { feedback: () => source } });
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Nota per Claude' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nota per Claude' });
    expect(within(dialog).getByPlaceholderText('Cosa cambiare?')).toBeInTheDocument();
    expect(within(dialog).getByText('Da: Ordini')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Invia' })).toBeInTheDocument();
  });
});

describe('where it was written', () => {
  test('a recipe’s address and its name', async () => {
    const { renderRecipes, recipe, sourceWith, LOAD } = await import('../testing/renderRecipes');
    const feedback = fakeFeedbackSource();
    const { user } = renderRecipes('/recipes/r1', {
      source: sourceWith([recipe('r1', { name: 'Pane di Miano' })]),
      session: ON,
      data: { feedback: () => feedback },
    });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Note to Claude' }));
    const dialog = await screen.findByRole('dialog', { name: 'Note to Claude' });
    expect(within(dialog).getByText('From: Recipes › Pane di Miano')).toBeInTheDocument();
    await user.type(within(dialog).getByPlaceholderText('What should change?'), 'Add a timer');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(feedback.sent[0]?.note.screen).toBe('recipes/r1');
  }, 30_000);

  test('from «More» on a phone: the screen before it, not «More»', async () => {
    const source = fakeFeedbackSource();
    const { user } = renderApp('/orders', { session: ON, data: { feedback: () => source } });
    await screen.findByRole('heading', { level: 1 });
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'More' }));
    await screen.findByRole('heading', { level: 1, name: 'More' });
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Note to Claude' }));
    const dialog = await screen.findByRole('dialog', { name: 'Note to Claude' });
    expect(within(dialog).getByText('From: Orders')).toBeInTheDocument();
    await user.type(within(dialog).getByPlaceholderText('What should change?'), 'From the phone');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(source.sent[0]?.note.screen).toBe('orders');
  });
});
