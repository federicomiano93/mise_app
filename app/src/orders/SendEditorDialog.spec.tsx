import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EditorAnswer, EditorJob } from '@mise/shared/send-editor';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { I18nProvider } from '../i18n/I18nProvider';
import { isBusy } from '../session/busy';
import { renderOrderImage } from './orderImage';
import { SendEditorDialog } from './SendEditorDialog';

// There is no canvas in jsdom: the picture is a stand-in file named after the text it was drawn from, so a spec can tell
// WHICH text a shared picture came from.
vi.mock('./orderImage', async importOriginal => ({
  ...await importOriginal<typeof import('./orderImage')>(),
  renderOrderImage: vi.fn((text: string) => Promise.resolve(new File([text], `picture:${text}.png`, { type: 'image/png' }))),
}));

// The editor of one message (SendEditorDialog.tsx), a port of the dialog of js/orders/send-editor.js (tests/send-editor.test.mjs on
// main): the preview, the picture drawn ahead of the tap, the press that shares with no await, the discard question.

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(renderOrderImage).mockClear();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(document, 'visibilityState');
});

const TEXT = '*Mill*\n\n- Flour 00: 2';

function jobOf(over: Partial<Omit<EditorJob, 'open'>> = {}) {
  const open = vi.fn<(text: string) => boolean>(() => true);
  return { ids: ['mill'], name: 'Mill', text: TEXT, ...over, open };
}

type Options = { job?: EditorJob; i?: number; n?: number; photo?: boolean; lang?: 'en' | 'it' };

function draw({ job = jobOf(), i = 0, n = 1, photo = false, lang = 'en' }: Options = {}) {
  const answer = vi.fn<(answer: EditorAnswer) => void>();
  const user = userEvent.setup();
  render(
    <I18nProvider initialLanguage={lang} initialMessages={lang === 'it' ? italian : en}>
      <SendEditorDialog job={job} i={i} n={n} photo={photo} language="en" answer={answer} />
    </I18nProvider>,
  );
  return { answer, user, job };
}

const dialog = () => screen.findByRole('dialog');
const box = () => screen.getByRole('textbox', { name: 'Change the message' }) as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Send' });
const preview = () => screen.getByRole('group', { name: 'What they will receive' });

function allowShare(result: () => Promise<void> = () => Promise.resolve()) {
  const share = vi.fn(result);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  return share;
}

// The picture for the current text has been drawn: «Send» is on.
const pictureReady = () => waitFor(() => { expect(sendButton()).toBeEnabled(); });

describe('what the editor shows', () => {
  it('names itself by the supplier, with «1 of 2» when several go one after the other, or «Check the order» for the one chat', async () => {
    draw({ job: jobOf({ name: 'Mill' }) });
    expect(await screen.findByRole('dialog', { name: 'Order for Mill' })).toBeInTheDocument();
  });

  it('says «(2 of 3)» in a batch, and offers Skip instead of Cancel', async () => {
    draw({ job: jobOf(), i: 1, n: 3 });
    const box = within(await screen.findByRole('dialog', { name: 'Order for Mill (2 of 3)' }));
    expect(box.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(box.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('the one grouped chat has no supplier: «Check the order», with Cancel', async () => {
    const { name: _name, ...rest } = jobOf();
    draw({ job: rest as EditorJob });
    const view = within(await screen.findByRole('dialog', { name: 'Check the order' }));
    expect(view.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows the text as WhatsApp does: *bold* in bold, built from nodes, the asterisks gone', async () => {
    draw();
    await dialog();
    const strong = within(preview()).getByText('Mill');
    expect(strong.tagName).toBe('STRONG');
    expect(preview()).not.toHaveTextContent('*');
    expect(within(preview()).getByText('- Flour 00: 2').tagName).toBe('DIV');
  });

  it('⚠️ shows an email as it will arrive: plain lines, the asterisks as they are', async () => {
    draw({ job: jobOf({ plain: true }) });
    await dialog();
    expect(within(preview()).getByText('*Mill*')).toBeInTheDocument();
    expect(preview().querySelector('strong')).toBeNull();
  });

  it('never draws typed text as markup', async () => {
    const { user } = draw();
    await dialog();
    await user.clear(box());
    await user.click(box());
    await user.paste('<b>hi</b>');
    expect(within(preview()).getByText('<b>hi</b>')).toBeInTheDocument();
    expect(preview().querySelector('b')).toBeNull();
  });

  it('the box holds the text, is labelled, described by its hint, and has six rows and no spell check', async () => {
    draw();
    await dialog();
    expect(box()).toHaveValue(TEXT);
    expect(box()).toHaveAccessibleDescription('Changes go only into the message: History keeps the quantities of the order.');
    expect(box()).toHaveAttribute('rows', '6');
    expect(box()).toHaveAttribute('spellcheck', 'false');
  });

  it('editing the box changes the preview', async () => {
    const { user } = draw();
    await dialog();
    await user.clear(box());
    await user.click(box());
    await user.paste('*Dairy*');
    expect(within(preview()).getByText('Dairy').tagName).toBe('STRONG');
    expect(within(preview()).queryByText('Mill')).not.toBeInTheDocument();
  });

  it('says its words in Italian', async () => {
    draw({ lang: 'it' });
    expect(await screen.findByRole('dialog', { name: 'Ordine per Mill' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cosa riceverà' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Modifica il messaggio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invia' })).toBeInTheDocument();
  });

  it('starts on «Send» when it can be pressed', async () => {
    draw();
    await dialog();
    await waitFor(() => { expect(sendButton()).toHaveFocus(); });
  });
});

describe('the text road (no picture): the press opens the window with the edited text', () => {
  it('⚠️ opens the window INSIDE the press, from the edited text, and answers opened', async () => {
    const { answer, user, job } = draw();
    await dialog();
    await user.clear(box());
    await user.click(box());
    await user.paste('Flour 3 please');
    const button = sendButton();
    act(() => {
      button.click();
      // ⚠️ Synchronously: a window opened after any await is a blocked pop-up.
      expect(job.open).toHaveBeenCalledTimes(1);
    });
    expect(job.open).toHaveBeenCalledWith('Flour 3 please');
    expect(answer).toHaveBeenCalledWith({ outcome: 'opened', text: 'Flour 3 please' });
  });

  it('a window the browser blocked answers blocked', async () => {
    const job = jobOf();
    job.open.mockReturnValue(false);
    const { answer } = draw({ job });
    await dialog();
    act(() => { sendButton().click(); });
    expect(answer).toHaveBeenCalledWith({ outcome: 'blocked', text: TEXT });
  });

  it('⚠️ a window that throws answers blocked instead of leaving the editor waiting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const job = jobOf();
    job.open.mockImplementation(() => { throw new Error('boom'); });
    const { answer } = draw({ job });
    await dialog();
    act(() => { sendButton().click(); });
    expect(answer).toHaveBeenCalledWith({ outcome: 'blocked', text: TEXT });
    expect(error).toHaveBeenCalled();
  });

  it('cannot send an empty box', async () => {
    const { user, job } = draw();
    await dialog();
    await user.clear(box());
    expect(sendButton()).toBeDisabled();
    act(() => { sendButton().click(); });
    expect(job.open).not.toHaveBeenCalled();
  });

  it('answers only once, whatever is pressed after', async () => {
    const { answer, job } = draw();
    await dialog();
    act(() => { sendButton().click(); sendButton().click(); });
    expect(job.open).toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenCalledTimes(1);
  });
});

describe('the picture road', () => {
  it('draws the picture for the opening text at once; «Send» waits for it, marked busy', async () => {
    let finish: (file: File) => void = () => undefined;
    vi.mocked(renderOrderImage).mockImplementationOnce(() => new Promise<File>(resolve => { finish = resolve; }));
    draw({ photo: true });
    await dialog();
    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute('aria-busy', 'true');
    // With nothing to press, the focus is on the dialog, not dropped on the page.
    await waitFor(() => { expect(screen.getByRole('dialog')).toHaveFocus(); });
    act(() => { finish(new File(['x'], 'x.png', { type: 'image/png' })); });
    await pictureReady();
    expect(sendButton()).toHaveAttribute('aria-busy', 'false');
    expect(renderOrderImage).toHaveBeenCalledWith(TEXT, { language: 'en' });
  });

  it('⚠️ «Send» is off again while the edited text is being drawn, and the picture shared is the EDITED one', async () => {
    const share = allowShare();
    const { answer, user } = draw({ photo: true });
    await dialog();
    await pictureReady();
    await user.clear(box());
    await user.click(box());
    await user.paste('Flour 3 only');
    expect(sendButton()).toBeDisabled();
    await pictureReady();
    expect(renderOrderImage).toHaveBeenLastCalledWith('Flour 3 only', { language: 'en' });
    const button = sendButton();
    act(() => {
      button.click();
      // ⚠️ share() is called in the press itself: no await, no state round-trip first.
      expect(share).toHaveBeenCalledTimes(1);
    });
    const [{ files }] = share.mock.calls[0] as unknown as [{ files: File[] }];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('picture:Flour 3 only.png');
    await waitFor(() => { expect(answer).toHaveBeenCalledWith({ outcome: 'shared', text: 'Flour 3 only' }); });
  });

  it('draws again only after the last key (one picture per pause, not per keystroke)', async () => {
    const { user } = draw({ photo: true });
    await dialog();
    await pictureReady();
    vi.mocked(renderOrderImage).mockClear();
    await user.click(box());
    await user.keyboard('abc');
    await pictureReady();
    expect(renderOrderImage).toHaveBeenCalledTimes(1);
    expect(renderOrderImage).toHaveBeenCalledWith(`${TEXT}abc`, { language: 'en' });
  });

  it('a share sheet closed without sharing keeps the editor and puts «Send» back, focused', async () => {
    allowShare(() => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' })));
    const { answer } = draw({ photo: true });
    await dialog();
    await pictureReady();
    act(() => { sendButton().click(); });
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
    await waitFor(() => { expect(sendButton()).toHaveFocus(); });
    expect(answer).not.toHaveBeenCalled();
  });

  it('a share that fails any other way answers failed, with the text, for the batch to ask about', async () => {
    allowShare(() => Promise.reject(new Error('no sheet')));
    const { answer } = draw({ photo: true });
    await dialog();
    await pictureReady();
    act(() => { sendButton().click(); });
    await waitFor(() => { expect(answer).toHaveBeenCalledWith({ outcome: 'failed', text: TEXT }); });
  });

  it('a picture that could not be drawn: the press answers failed, with nothing shared', async () => {
    const share = allowShare();
    vi.mocked(renderOrderImage).mockRejectedValueOnce(new Error('no canvas'));
    const { answer } = draw({ photo: true });
    await dialog();
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
    act(() => { sendButton().click(); });
    expect(answer).toHaveBeenCalledWith({ outcome: 'failed', text: TEXT });
    expect(share).not.toHaveBeenCalled();
  });

  it('⚠️ nothing leaves while the share sheet is open: Cancel, Skip and Escape are ignored', async () => {
    let finish: () => void = () => undefined;
    const share = allowShare(() => new Promise<void>(resolve => { finish = resolve; }));
    const { answer, user } = draw({ photo: true });
    await dialog();
    await pictureReady();
    act(() => { sendButton().click(); });
    expect(share).toHaveBeenCalledTimes(1);
    expect(sendButton()).toBeDisabled();
    await waitFor(() => { expect(screen.getByRole('dialog')).toHaveFocus(); });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(answer).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await act(async () => { finish(); await Promise.resolve(); });
    await waitFor(() => { expect(answer).toHaveBeenCalledWith({ outcome: 'shared', text: TEXT }); });
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it('⚠️ coming back to the page while the sheet never answered puts «Send» back', async () => {
    allowShare(() => new Promise<void>(() => undefined));
    draw({ photo: true });
    await dialog();
    await pictureReady();
    act(() => { sendButton().click(); });
    expect(sendButton()).toBeDisabled();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(sendButton()).toBeDisabled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
    await waitFor(() => { expect(sendButton()).toHaveFocus(); });
  });

  it('coming back to the page when nothing is being shared changes nothing', async () => {
    draw({ photo: true });
    await dialog();
    await pictureReady();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(sendButton()).toBeEnabled();
  });
});

describe('leaving', () => {
  it('Cancel with the text as it was answers cancelled at once, with no question', async () => {
    const { answer, user } = draw();
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(answer).toHaveBeenCalledWith({ outcome: 'cancelled', text: TEXT });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Skip (several in a row) answers skipped', async () => {
    const { answer, user } = draw({ i: 0, n: 2 });
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(answer).toHaveBeenCalledWith({ outcome: 'skipped', text: TEXT });
  });

  it('Escape with the text as it was answers cancelled', async () => {
    const { answer, user } = draw();
    await dialog();
    await user.keyboard('{Escape}');
    expect(answer).toHaveBeenCalledWith({ outcome: 'cancelled', text: TEXT });
  });

  async function edited(options: Options = {}) {
    const view = draw(options);
    await dialog();
    await view.user.click(box());
    await view.user.keyboard(' extra');
    return view;
  }
  const question = () => screen.findByRole('alertdialog', { name: 'Discard your changes?' });

  it('⚠️ Cancel with edited text asks «Discard your changes?» first; «Keep editing» goes back to the box', async () => {
    const { answer, user } = await edited();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const ask = within(await question());
    expect(ask.getByText('The text you changed will not be sent.')).toBeInTheDocument();
    expect(answer).not.toHaveBeenCalled();
    await user.click(ask.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => { expect(box()).toHaveFocus(); });
    expect(answer).not.toHaveBeenCalled();
    expect(box()).toHaveValue(`${TEXT} extra`);
  });

  it('«Discard» leaves, with the text that was typed', async () => {
    const { answer, user } = await edited();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(within(await question()).getByRole('button', { name: 'Discard' }));
    expect(answer).toHaveBeenCalledWith({ outcome: 'cancelled', text: `${TEXT} extra` });
  });

  it('Skip with edited text asks too, and Discard answers skipped', async () => {
    const { answer, user } = await edited({ i: 0, n: 2 });
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(within(await question()).getByRole('button', { name: 'Discard' }));
    expect(answer).toHaveBeenCalledWith({ outcome: 'skipped', text: `${TEXT} extra` });
  });

  it('Escape with edited text asks, and Escape on the question keeps editing instead of leaving', async () => {
    const { answer, user } = await edited();
    await user.keyboard('{Escape}');
    await question();
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(answer).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('⚠️ a second Cancel while the question is up does not ask again', async () => {
    const { answer } = await edited();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    act(() => { cancel.click(); });
    await question();
    fireEvent.click(cancel);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(answer).not.toHaveBeenCalled();
  });

  it('typing the text back to what it was leaves with no question', async () => {
    const { answer, user } = await edited();
    await user.keyboard('{Backspace>6/}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(answer).toHaveBeenCalledWith({ outcome: 'cancelled', text: TEXT });
  });
});

describe('holding the reload', () => {
  it('⚠️ holds a self-started reload while it is open, and lets go when it goes', async () => {
    expect(isBusy()).toBe(false);
    draw();
    await dialog();
    expect(isBusy()).toBe(true);
    cleanup();
    expect(isBusy()).toBe(false);
  });

  it('the scrolling preview can be reached by keyboard (it is a named group)', async () => {
    draw();
    await dialog();
    expect(preview()).toHaveAttribute('tabindex', '0');
  });
});
