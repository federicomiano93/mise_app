import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirm } from './useConfirm';
import type { ConfirmOptions } from './useConfirm';

// A button that asks, and writes the answer beside itself.
function Asker({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (answer: boolean) => void }) {
  const [confirm, dialog] = useConfirm();
  return (
    <>
      <button type="button" onClick={() => { void confirm(options).then(onAnswer); }}>Ask</button>
      {dialog}
    </>
  );
}

const options: ConfirmOptions = {
  title: 'Confirm Tuesday?',
  message: 'Keep this list?',
  okLabel: 'Confirm',
  cancelLabel: 'Cancel',
};

function draw(extra: Partial<ConfirmOptions> = {}) {
  const onAnswer = vi.fn<(answer: boolean) => void>();
  const user = userEvent.setup();
  const view = render(<Asker options={{ ...options, ...extra }} onAnswer={onAnswer} />);
  return { onAnswer, user, ...view };
}

const ask = () => screen.getByRole('button', { name: 'Ask' });

describe('useConfirm', () => {
  it('draws nothing until it is asked', () => {
    draw();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks a question named by its title, in an alert dialog', async () => {
    const { user } = draw();
    await user.click(ask());
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm Tuesday?' });
    expect(dialog).toHaveAccessibleDescription('Keep this list?');
  });

  it('answers yes on the OK button', async () => {
    const { user, onAnswer } = draw();
    await user.click(ask());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => { expect(onAnswer).toHaveBeenCalledWith(true); });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('answers no on Cancel, and gives the focus back to what asked', async () => {
    const { user, onAnswer } = draw();
    await user.click(ask());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(onAnswer).toHaveBeenCalledWith(false); });
    await waitFor(() => { expect(ask()).toHaveFocus(); });
  });

  it('answers no on Escape', async () => {
    const { user, onAnswer } = draw();
    await user.click(ask());
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(onAnswer).toHaveBeenCalledWith(false); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // The safe choice takes the focus, so Enter on a question that was not read cannot confirm it.
  it('puts the focus on Cancel when the question opens', async () => {
    const { user } = draw();
    await user.click(ask());
    expect(await screen.findByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('shows a list of sentences as separate paragraphs', async () => {
    const { user } = draw({ message: ['Keep this list as a record?', 'It will show as done.'] });
    await user.click(ask());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Keep this list as a record?').tagName).toBe('P');
    expect(within(dialog).getByText('It will show as done.').tagName).toBe('P');
  });

  it('draws the OK button as a danger button when it throws something away', async () => {
    const { user } = draw({ okLabel: 'Remove', danger: true });
    await user.click(ask());
    const dialog = await screen.findByRole('alertdialog');
    // The module's class names are served as written (vite.config.ts), so the variant is readable.
    expect(within(dialog).getByRole('button', { name: 'Remove' }).className).toContain('danger');
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).className).not.toContain('danger');
  });

  it('draws the OK button as the primary button otherwise', async () => {
    const { user } = draw();
    await user.click(ask());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Confirm' }).className).toContain('primary');
  });

  it('answers no to a question that is still open when a second one is asked', async () => {
    const first = vi.fn<(answer: boolean) => void>();
    const second = vi.fn<(answer: boolean) => void>();
    function Twice() {
      const [confirm, dialog] = useConfirm();
      return (
        <>
          <button type="button" onClick={() => { void confirm({ ...options, title: 'First?' }).then(first); }}>One</button>
          <button type="button" onClick={() => { void confirm({ ...options, title: 'Second?' }).then(second); }}>Two</button>
          {dialog}
        </>
      );
    }
    render(<Twice />);
    // Pressed from outside the (modal) dialog, as a script or a second tap would.
    const [one, two] = [screen.getByRole('button', { name: 'One' }), screen.getByRole('button', { name: 'Two' })];
    fireEvent.click(one);
    await screen.findByRole('alertdialog', { name: 'First?' });
    fireEvent.click(two);
    await screen.findByRole('alertdialog', { name: 'Second?' });
    await waitFor(() => { expect(first).toHaveBeenCalledWith(false); });
    expect(second).not.toHaveBeenCalled();
  });

  it('answers no when the component goes away with the question open', async () => {
    const { user, onAnswer, unmount } = draw();
    await user.click(ask());
    await screen.findByRole('alertdialog');
    unmount();
    await waitFor(() => { expect(onAnswer).toHaveBeenCalledWith(false); });
  });
});
