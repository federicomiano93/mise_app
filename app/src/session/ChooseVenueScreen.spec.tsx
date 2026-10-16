import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import { ChooseVenueScreen } from './ChooseVenueScreen';

const CHOOSING = {
  status: 'choose-location',
  locationId: null,
  location: null,
  options: ['restaurant', 'bakery', 'kiosk-7'],
  optionNames: { restaurant: 'The Restaurant', bakery: 'The Bakery' },
} as const;
const draw = (lang: 'en' | 'it' = 'en') =>
  renderWithSession(<ChooseVenueScreen />, { session: CHOOSING, lang });

describe('ChooseVenueScreen', () => {
  it('has a title, a line under it, and the account', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1, name: 'Choose location' })).toBeInTheDocument();
    expect(screen.getByText('You have access to more than one.')).toBeInTheDocument();
    expect(screen.getByText('owner@club.test')).toBeInTheDocument();
  });

  it('lists the venues in the session\'s order, by name, with the id only as a fallback', () => {
    draw();
    const list = within(screen.getByRole('list'));
    expect(list.getAllByRole('button').map(button => button.textContent)).toEqual([
      'The Restaurant', 'The Bakery', 'kiosk-7',
    ]);
  });

  it('opens the venue that is pressed', async () => {
    const { store, user } = draw();
    await user.click(screen.getByRole('button', { name: 'The Bakery' }));
    expect(store.chooseLocation).toHaveBeenCalledTimes(1);
    expect(store.chooseLocation).toHaveBeenCalledWith('bakery');
  });

  it('disables the rows while one is opening, so it cannot be opened twice', async () => {
    const { store, user } = draw();
    store.chooseLocation.mockReturnValue(new Promise(() => undefined));

    await user.click(screen.getByRole('button', { name: 'The Bakery' }));

    for (const name of ['The Restaurant', 'The Bakery', 'kiosk-7']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    await user.click(screen.getByRole('button', { name: 'The Restaurant' }));
    expect(store.chooseLocation).toHaveBeenCalledTimes(1);
  });

  describe('when the venue cannot be opened', () => {
    let logged: MockInstance;

    beforeEach(() => {
      logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it('lets the person pick again', async () => {
      const { store, user } = draw();
      store.chooseLocation.mockRejectedValue(new Error('not yours'));

      await user.click(screen.getByRole('button', { name: 'The Bakery' }));

      await waitFor(() => { expect(screen.getByRole('button', { name: 'The Bakery' })).toBeEnabled(); });
      expect(logged).toHaveBeenCalled();
    });
  });

  it('offers a quiet «Log out» that asks first', async () => {
    const { store, user } = draw();
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('alertdialog', { name: 'Log out?' })).toBeInTheDocument();
    expect(store.signOut).not.toHaveBeenCalled();
  });

  it('speaks Italian', () => {
    draw('it');
    expect(screen.getByRole('heading', { level: 1, name: 'Scegli il locale' })).toBeInTheDocument();
    expect(screen.getByText('Hai accesso a più di uno.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument();
  });
});
