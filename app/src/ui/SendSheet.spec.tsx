import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n/I18nProvider';
import { it as italian } from '../i18n/it';
import { useSendSheet } from './SendSheet';

// The sheet that asks which road a piece of text takes: WhatsApp or the mail app, never a brand on the
// button that opens it, closed before the road is taken.

function Opener({ subject, text }: { subject: string; text: string }) {
  const [send, sheet] = useSendSheet();
  return (
    <>
      <button type="button" onClick={() => { send({ subject, text }); }}>Send</button>
      {sheet}
    </>
  );
}

afterEach(() => { vi.restoreAllMocks(); });

function draw(text = 'FOCACCIA  2.0 kg\nFlour: 1,000 g & more', subject = 'Focaccia') {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const user = userEvent.setup();
  render(<Opener subject={subject} text={text} />);
  return { open, user };
}

const sheet = () => screen.findByRole('dialog', { name: 'How do you want to send it?' });

describe('the send sheet', () => {
  it('draws nothing until it is asked', () => {
    draw();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers two roads and Cancel, and says the mail road only opens the mail app', async () => {
    const { user } = draw();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const box = within(await sheet());
    expect(box.getAllByRole('button').map(b => b.textContent)).toEqual([
      'WhatsApp — I choose the chat',
      'EmailIt opens your mail app with the text ready — it does not send it.',
      'Cancel',
    ]);
  });

  it('takes WhatsApp with no recipient, the text encoded, and noopener', async () => {
    const text = 'FOCACCIA  2.0 kg\nFlour: 1,000 g & more';
    const { user, open } = draw(text);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(within(await sheet()).getByRole('button', { name: /^WhatsApp/ }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    expect(open.mock.calls[0]?.[0]).not.toMatch(/&more/);
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
  });

  it('takes the mail app with no recipient, the subject and the body both encoded', async () => {
    const text = 'FOCACCIA  2.0 kg\nFlour: 1,000 g & more';
    const { user, open } = draw(text, 'Focaccia & co');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(within(await sheet()).getByRole('button', { name: /^Email/ }));
    expect(open).toHaveBeenCalledWith(
      `mailto:?subject=${encodeURIComponent('Focaccia & co')}&body=${encodeURIComponent(text)}`, '_blank', 'noopener',
    );
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
  });

  it('closes on Cancel and on Escape without taking any road', async () => {
    const { user, open } = draw();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(within(await sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await sheet();
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
  });

  it('closes on a press on the backdrop', async () => {
    const { user, open } = draw();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const box = await sheet();
    await user.click(box.closest('[data-rac]')?.parentElement ?? document.body);
    await user.click(document.body);
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
  });

  it('gives the focus back to what opened it', async () => {
    const { user } = draw();
    const opener = screen.getByRole('button', { name: 'Send' });
    await user.click(opener);
    await user.click(within(await sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(opener).toHaveFocus(); });
  });

  it('never opens for an empty text: there is nothing to hand over', async () => {
    const { user } = draw('   \n ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('speaks Italian when the language is Italian', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    render(
      <I18nProvider initialLanguage="it" initialMessages={italian}>
        <Opener subject="Focaccia" text="testo" />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('dialog', { name: 'Come vuoi mandarlo?' })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});
