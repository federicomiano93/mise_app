import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import type { Session } from './session';
import { SignOutButton } from './SignOutButton';
import { SwitchVenueButton } from './SwitchVenueButton';

// The wait for «has everything reached the server?» (up to 4 s with no signal) must be visible:
// a dialog that looks unchanged for seconds reads as a frozen app, and a hurried person taps again.

const TWO_VENUES: Partial<Session> = {
  options: ['bakery', 'restaurant'],
  optionNames: { bakery: 'The Bakery', restaurant: 'The Restaurant' },
  locationId: 'bakery',
  name: 'The Bakery',
};

function slowAnswer() {
  let answer: (waiting: boolean) => void = () => undefined;
  const promise = new Promise<boolean>(resolve => { answer = resolve; });
  return { promise, answer };
}

async function startSignOut() {
  const view = renderWithSession(<SignOutButton />);
  const slow = slowAnswer();
  view.store.changesStillWaiting.mockReturnValue(slow.promise);
  await view.user.click(screen.getByRole('button', { name: 'Log out' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Log out?' });
  await view.user.click(within(dialog).getByRole('button', { name: 'Log out' }));
  return { ...view, ...slow, dialog };
}

describe('the leave dialog while it checks', () => {
  it('says what it is doing, in a live region, and the confirm button reads «Checking…»', async () => {
    const { dialog } = await startSignOut();

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Checking everything has reached the server…');
    const button = within(dialog).getByRole('button', { name: 'Checking…' });
    expect(button).toHaveAttribute('data-pending', 'true');
  });

  it('shows nothing before the person confirms', async () => {
    const { user } = renderWithSession(<SignOutButton />);
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not start a second check on a second press', async () => {
    const { store, user, dialog } = await startSignOut();

    await user.click(within(dialog).getByRole('button', { name: 'Checking…' }));
    await user.keyboard('{Enter}');

    expect(store.changesStillWaiting).toHaveBeenCalledTimes(1);
  });

  it('closes on Cancel, and a late «waiting» answer does not open it again', async () => {
    const { store, user, answer, dialog } = await startSignOut();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    await act(async () => { answer(true); await Promise.resolve(); });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(store.signOut).not.toHaveBeenCalled();
  });

  it('checks again after Cancel and a new confirm', async () => {
    const { store, user, dialog } = await startSignOut();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    const again = await screen.findByRole('alertdialog', { name: 'Log out?' });
    await user.click(within(again).getByRole('button', { name: 'Log out' }));

    expect(store.changesStillWaiting).toHaveBeenCalledTimes(2);
  });

  it('turns into «Not sent yet» when the answer is «waiting», and the status line is gone', async () => {
    const { answer } = await startSignOut();

    await act(async () => { answer(true); await Promise.resolve(); });

    const unsent = await screen.findByRole('alertdialog', { name: 'Not sent yet' });
    expect(within(unsent).queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Checking everything has reached the server…')).not.toBeInTheDocument();
  });

  it('shows the same line in the venue switch, then «Not sent yet»', async () => {
    const { store, user } = renderWithSession(<SwitchVenueButton>The Bakery</SwitchVenueButton>, { session: TWO_VENUES, lang: 'en' });
    const slow = slowAnswer();
    store.changesStillWaiting.mockReturnValue(slow.promise);

    await user.click(screen.getByRole('button', { name: 'The Bakery' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch venue' });
    await user.click(within(dialog).getByRole('button', { name: 'The Restaurant' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Checking everything has reached the server…');
    await user.click(within(dialog).getByRole('button', { name: 'The Restaurant' }));
    expect(store.changesStillWaiting).toHaveBeenCalledTimes(1);

    await act(async () => { slow.answer(true); await Promise.resolve(); });
    expect(await screen.findByRole('alertdialog', { name: 'Not sent yet' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('speaks Italian', async () => {
    const view = renderWithSession(<SignOutButton />, { lang: 'it' });
    view.store.changesStillWaiting.mockReturnValue(new Promise<boolean>(() => undefined));
    await view.user.click(screen.getByRole('button', { name: 'Esci' }));
    const dialog = await screen.findByRole('alertdialog');
    await view.user.click(within(dialog).getByRole('button', { name: 'Esci' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Controllo che tutto sia arrivato al server…');
    expect(within(dialog).getByRole('button', { name: 'Controllo…' })).toBeInTheDocument();
  });
});
