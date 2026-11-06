import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import { SignOutButton } from './SignOutButton';

const logOut = () => screen.getByRole('button', { name: 'Log out' });

describe('SignOutButton', () => {
  it('asks before signing out, and does nothing yet', async () => {
    const { store, user } = renderWithSession(<SignOutButton />);

    await user.click(logOut());

    const dialog = await screen.findByRole('alertdialog', { name: 'Log out?' });
    expect(dialog).toHaveTextContent('You will need your email and password to get back in.');
    expect(store.signOut).not.toHaveBeenCalled();
    expect(store.changesStillWaiting).not.toHaveBeenCalled();
  });

  it('signs out when the person confirms and nothing is waiting to be sent', async () => {
    const { store, user } = renderWithSession(<SignOutButton />);

    await user.click(logOut());
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Log out' }));

    await waitFor(() => { expect(store.signOut).toHaveBeenCalledTimes(1); });
    expect(store.changesStillWaiting).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not sign out when the person cancels, and gives the focus back to the button', async () => {
    const { store, user } = renderWithSession(<SignOutButton />);

    await user.click(logOut());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(store.signOut).not.toHaveBeenCalled();
    await waitFor(() => { expect(logOut()).toHaveFocus(); });
  });

  it('cancels on Escape too', async () => {
    const { store, user } = renderWithSession(<SignOutButton />);

    await user.click(logOut());
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');

    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(store.signOut).not.toHaveBeenCalled();
    await waitFor(() => { expect(logOut()).toHaveFocus(); });
  });

  it('puts the focus on the safe choice when the question opens', async () => {
    const { user } = renderWithSession(<SignOutButton />);
    await user.click(logOut());
    expect(await screen.findByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  describe('when something typed on this phone has not reached the server', () => {
    async function confirmWithUnsent() {
      const view = renderWithSession(<SignOutButton />);
      view.store.changesStillWaiting.mockResolvedValue(true);
      await view.user.click(logOut());
      const dialog = await screen.findByRole('alertdialog');
      await view.user.click(within(dialog).getByRole('button', { name: 'Log out' }));
      return view;
    }

    it('warns first and does not sign out yet', async () => {
      const { store } = await confirmWithUnsent();

      const warning = await screen.findByRole('alertdialog', { name: 'Not sent yet' });
      expect(warning).toHaveTextContent('Some changes made on this phone have not reached the server yet');
      expect(store.signOut).not.toHaveBeenCalled();
    });

    it('stays when the person chooses Stay, and gives the focus back to the button', async () => {
      const { store, user } = await confirmWithUnsent();

      await user.click(await screen.findByRole('button', { name: 'Stay' }));

      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(store.signOut).not.toHaveBeenCalled();
      await waitFor(() => { expect(logOut()).toHaveFocus(); });
    });

    it('signs out only after «Go on anyway»', async () => {
      const { store, user } = await confirmWithUnsent();

      await user.click(await screen.findByRole('button', { name: 'Go on anyway' }));

      await waitFor(() => { expect(store.signOut).toHaveBeenCalledTimes(1); });
    });

    it('does not open the warning after the person already gave up', async () => {
      const view = renderWithSession(<SignOutButton />);
      let answer: (waiting: boolean) => void = () => undefined;
      view.store.changesStillWaiting.mockReturnValue(new Promise<boolean>(resolve => { answer = resolve; }));
      await view.user.click(logOut());
      const dialog = await screen.findByRole('alertdialog');
      await view.user.click(within(dialog).getByRole('button', { name: 'Log out' }));
      await view.user.keyboard('{Escape}');
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });

      await act(async () => { answer(true); });

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(view.store.signOut).not.toHaveBeenCalled();
    });

    it('treats a question that cannot be answered as "something is waiting"', async () => {
      const view = renderWithSession(<SignOutButton />);
      view.store.changesStillWaiting.mockRejectedValue(new Error('no database'));
      await view.user.click(logOut());
      const dialog = await screen.findByRole('alertdialog');
      await view.user.click(within(dialog).getByRole('button', { name: 'Log out' }));

      expect(await screen.findByRole('alertdialog', { name: 'Not sent yet' })).toBeInTheDocument();
      expect(view.store.signOut).not.toHaveBeenCalled();
    });
  });

  it('speaks Italian', async () => {
    const { user } = renderWithSession(<SignOutButton />, { lang: 'it' });
    await user.click(screen.getByRole('button', { name: 'Esci' }));
    expect(await screen.findByRole('alertdialog', { name: 'Vuoi uscire?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });
});
