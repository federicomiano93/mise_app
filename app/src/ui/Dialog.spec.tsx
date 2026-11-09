import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './Dialog';

function draw(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <Dialog isOpen onClose={onClose} title="Discard?" actions={<button type="button">OK</button>} {...props} />,
  );
  return { onClose, ...view };
}

describe('Dialog', () => {
  it('is a dialog named by its title', () => {
    draw();
    expect(screen.getByRole('dialog', { name: 'Discard?' })).toBeInTheDocument();
  });

  it('can be an alert dialog, described by its message', () => {
    draw({ role: 'alertdialog', message: 'You will lose it.' });
    const dialog = screen.getByRole('alertdialog', { name: 'Discard?' });
    expect(dialog).toHaveAccessibleDescription('You will lose it.');
  });

  it('shows several sentences as paragraphs of their own, all describing the dialog', () => {
    draw({ role: 'alertdialog', message: ['First sentence.', 'Second sentence.'] });
    const dialog = screen.getByRole('alertdialog', { name: 'Discard?' });
    expect(within(dialog).getByText('First sentence.').tagName).toBe('P');
    expect(within(dialog).getByText('Second sentence.').tagName).toBe('P');
    expect(dialog).toHaveAccessibleDescription(/First sentence\.\s+Second sentence\./);
  });

  // A one-sentence notice has no title (the current app's alert): the sentence is the dialog's name,
  // or a screen reader announces just «dialog».
  it('is named by its message, and draws no heading, when it has no title', () => {
    draw({ title: undefined, role: 'alertdialog', message: 'Flour: not counted here.' });
    const dialog = screen.getByRole('alertdialog', { name: 'Flour: not counted here.' });
    expect(within(dialog).queryByRole('heading')).not.toBeInTheDocument();
  });

  // ⚠️ The same paragraph as both the name and the description is read out twice.
  it('names a titled dialog by its title and describes it by its message', () => {
    draw({ role: 'alertdialog', message: 'You will lose it.' });
    const dialog = screen.getByRole('alertdialog', { name: 'Discard?' });
    expect(dialog).toHaveAccessibleDescription('You will lose it.');
    expect(within(dialog).getByRole('heading', { name: 'Discard?' })).toBeInTheDocument();
  });

  it('names an untitled dialog by its message and gives it no description of its own', () => {
    draw({ title: undefined, role: 'alertdialog', message: 'Flour: not counted here.' });
    const dialog = screen.getByRole('alertdialog', { name: 'Flour: not counted here.' });
    expect(dialog).not.toHaveAttribute('aria-describedby');
    expect(dialog).not.toHaveAccessibleDescription();
  });

  it('is not described by anything when it has no message', () => {
    draw({ role: 'alertdialog' });
    expect(screen.getByRole('alertdialog')).not.toHaveAttribute('aria-describedby');
  });

  it('shows its body and its actions', () => {
    draw({ children: <p>the body</p> });
    expect(screen.getByText('the body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('draws nothing when closed', () => {
    draw({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks to close on Escape', async () => {
    const { onClose } = draw();
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Pressing the scrim must not throw away a question that needs an answer.
  it('does not close when the person presses outside it', async () => {
    const { onClose } = draw();
    await userEvent.setup().pointer({ keys: '[MouseLeft]', target: document.body });
    expect(onClose).not.toHaveBeenCalled();
  });
});
