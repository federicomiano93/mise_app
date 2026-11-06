import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
