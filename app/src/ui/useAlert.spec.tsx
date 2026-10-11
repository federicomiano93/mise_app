import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAlert } from './useAlert';
import type { AlertOptions } from './useAlert';

// A button that tells, and writes when the notice has been dismissed.
function Teller({ options, onDone }: { options: AlertOptions; onDone: () => void }) {
  const [alert, alertDialog] = useAlert();
  return (
    <>
      <button type="button" onClick={() => { void alert(options).then(onDone); }}>Tell</button>
      {alertDialog}
    </>
  );
}

const options: AlertOptions = { message: 'Flour: not counted here.', okLabel: 'OK' };

function draw(extra: Partial<AlertOptions> = {}) {
  const onDone = vi.fn<() => void>();
  const user = userEvent.setup();
  const view = render(<Teller options={{ ...options, ...extra }} onDone={onDone} />);
  return { onDone, user, ...view };
}

const tell = () => screen.getByRole('button', { name: 'Tell' });

describe('useAlert', () => {
  it('draws nothing until it is called', () => {
    draw();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is named and described by its message when it has no title', async () => {
    const { user } = draw();
    await user.click(tell());
    const dialog = await screen.findByRole('alertdialog', { name: 'Flour: not counted here.' });
    expect(dialog).toHaveAccessibleDescription('Flour: not counted here.');
    expect(within(dialog).queryByRole('heading')).not.toBeInTheDocument();
  });

  it('is named by its title when it has one', async () => {
    const { user } = draw({ title: 'From the orders' });
    await user.click(tell());
    const dialog = await screen.findByRole('alertdialog', { name: 'From the orders' });
    expect(dialog).toHaveAccessibleDescription('Flour: not counted here.');
  });

  it('has one button, and it has the focus', async () => {
    const { user } = draw();
    await user.click(tell());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'OK' }).className).toContain('primary');
  });

  it('is dismissed by OK, which gives the focus back to what called it', async () => {
    const { user, onDone } = draw();
    await user.click(tell());
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(tell()).toHaveFocus(); });
  });

  it('is dismissed by Escape too', async () => {
    const { user, onDone } = draw();
    await user.click(tell());
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows a list of sentences as separate paragraphs', async () => {
    const { user } = draw({ message: ['First.', 'Second.'] });
    await user.click(tell());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('First.').tagName).toBe('P');
    expect(within(dialog).getByText('Second.').tagName).toBe('P');
  });

  it('lets the first notice go when a second one replaces it', async () => {
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    function Twice() {
      const [alert, alertDialog] = useAlert();
      return (
        <>
          <button type="button" onClick={() => { void alert({ ...options, message: 'First notice.' }).then(first); }}>One</button>
          <button type="button" onClick={() => { void alert({ ...options, message: 'Second notice.' }).then(second); }}>Two</button>
          {alertDialog}
        </>
      );
    }
    render(<Twice />);
    // Both found before the first notice hides the page behind it from the accessibility tree, and
    // pressed from outside the (modal) dialog, as a script or a second tap would.
    const [one, two] = [screen.getByRole('button', { name: 'One' }), screen.getByRole('button', { name: 'Two' })];
    fireEvent.click(one);
    await screen.findByRole('alertdialog', { name: 'First notice.' });
    fireEvent.click(two);
    await screen.findByRole('alertdialog', { name: 'Second notice.' });
    await waitFor(() => { expect(first).toHaveBeenCalledTimes(1); });
    expect(second).not.toHaveBeenCalled();
  });

  it('lets go when the component goes away with the notice open', async () => {
    const { user, onDone, unmount } = draw();
    await user.click(tell());
    await screen.findByRole('alertdialog');
    unmount();
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
  });
});
