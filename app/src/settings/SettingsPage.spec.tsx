import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';

const TWO = {
  options: ['bakery', 'restaurant'],
  optionNames: { bakery: 'The Bakery', restaurant: 'The Restaurant' },
  name: 'The Bakery',
};
// The page's own content, apart from the top bar (which shows the venue too).
const main = () => within(screen.getByRole('main'));

describe('SettingsPage', () => {
  it('is Settings, with the account card and a line about the rest', () => {
    renderApp('/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
    expect(main().getByText('The other settings arrive in the next steps of Mise 2.')).toBeInTheDocument();
    // Not the placeholder any more.
    expect(screen.queryByText(/will arrive in one of the next steps/)).not.toBeInTheDocument();
  });

  it('says who is signed in and which venue is open', () => {
    renderApp('/settings', { session: { name: 'The Bakery' } });
    expect(main().getByText('Signed in as owner@club.test')).toBeInTheDocument();
    expect(main().getByText('Venue')).toBeInTheDocument();
    expect(main().getByText('The Bakery')).toBeInTheDocument();
  });

  it('names the account by its id when it has no email', () => {
    renderApp('/settings', { session: { user: { uid: 'u-5', email: null, isAnonymous: false } } });
    expect(main().getByText('Signed in as u-5')).toBeInTheDocument();
  });

  describe('switching venue', () => {
    it('is not offered when the account has one venue', () => {
      renderApp('/settings');
      expect(main().queryByRole('button', { name: 'Switch venue' })).not.toBeInTheDocument();
    });

    it('is offered when the account has several, and moves to the venue picked', async () => {
      const { store, user } = renderApp('/settings', { session: TWO });

      await user.click(main().getByRole('button', { name: 'Switch venue' }));
      const dialog = await screen.findByRole('dialog', { name: 'Switch venue' });
      await user.click(within(dialog).getByRole('button', { name: 'The Restaurant' }));

      await waitFor(() => { expect(store.switchLocation).toHaveBeenCalledWith('restaurant'); });
    });

    it('does nothing on Cancel, and gives the focus back to the button', async () => {
      const { store, user } = renderApp('/settings', { session: TWO });
      const opener = main().getByRole('button', { name: 'Switch venue' });

      await user.click(opener);
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));

      await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
      expect(store.switchLocation).not.toHaveBeenCalled();
      await waitFor(() => { expect(opener).toHaveFocus(); });
    });
  });

  describe('the way out', () => {
    it('shares the title line with the h1, after it, and is not in the Account card', () => {
      renderApp('/settings');
      const h1 = screen.getByRole('heading', { level: 1, name: 'Settings' });
      const logOut = main().getByRole('button', { name: 'Log out' });
      expect(h1.parentElement).toBe(logOut.closest('header'));
      expect(h1.compareDocumentPosition(logOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const card = main().getByRole('heading', { level: 2, name: 'Account' }).closest('section') as HTMLElement;
      expect(within(card).queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    });
  });

  describe('logging out', () => {
    it('asks first, and signs out when confirmed', async () => {
      const { store, user } = renderApp('/settings');

      await user.click(main().getByRole('button', { name: 'Log out' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Log out?' });
      expect(store.signOut).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Log out' }));

      await waitFor(() => { expect(store.signOut).toHaveBeenCalledTimes(1); });
    });

    it('does not sign out when cancelled', async () => {
      const { store, user } = renderApp('/settings');

      await user.click(main().getByRole('button', { name: 'Log out' }));
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));

      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(store.signOut).not.toHaveBeenCalled();
      await waitFor(() => { expect(main().getByRole('button', { name: 'Log out' })).toHaveFocus(); });
    });

    it('warns first when something typed on this phone has not reached the server', async () => {
      const { store, user } = renderApp('/settings');
      store.changesStillWaiting.mockResolvedValue(true);

      await user.click(main().getByRole('button', { name: 'Log out' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Log out?' });
      await user.click(within(dialog).getByRole('button', { name: 'Log out' }));

      expect(await screen.findByRole('alertdialog', { name: 'Not sent yet' })).toBeInTheDocument();
      expect(store.signOut).not.toHaveBeenCalled();
    });
  });

  it('speaks Italian', async () => {
    renderApp('/settings', { lang: 'it', session: TWO });
    expect(screen.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeInTheDocument();
    expect(main().getByText('Hai effettuato l’accesso come owner@club.test')).toBeInTheDocument();
    expect(main().getByText('Locale')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Cambia locale' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Esci' })).toBeInTheDocument();
    expect(main().getByText('Le altre impostazioni arrivano nei prossimi passi di Mise 2.')).toBeInTheDocument();
  });
});
