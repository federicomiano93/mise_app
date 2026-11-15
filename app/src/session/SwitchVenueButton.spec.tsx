import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import type { Session } from './session';
import { SwitchVenueButton } from './SwitchVenueButton';

const TWO_VENUES: Partial<Session> = {
  options: ['bakery', 'restaurant'],
  optionNames: { bakery: 'The Bakery', restaurant: 'The Restaurant' },
  locationId: 'bakery',
  name: 'The Bakery',
};
const THREE_VENUES: Partial<Session> = {
  options: ['bakery', 'restaurant', 'kiosk'],
  optionNames: { bakery: 'The Bakery', restaurant: 'The Restaurant', kiosk: 'The Kiosk' },
  locationId: 'bakery',
  name: 'The Bakery',
};

const opener = () => screen.getByRole('button', { name: 'The Bakery' });
const draw = (session: Partial<Session> = TWO_VENUES, lang: 'en' | 'it' = 'en') =>
  renderWithSession(<SwitchVenueButton>The Bakery</SwitchVenueButton>, { session, lang });

describe('SwitchVenueButton', () => {
  it('opens a list of the OTHER venues, by name', async () => {
    const { user } = draw(THREE_VENUES);

    await user.click(opener());

    const dialog = await screen.findByRole('dialog', { name: 'Switch venue' });
    expect(within(dialog).getAllByRole('button').map(button => button.textContent)).toEqual([
      'The Restaurant', 'The Kiosk', 'Cancel',
    ]);
  });

  it('falls back to the id for a venue whose name could not be read', async () => {
    const { user } = draw({ ...TWO_VENUES, optionNames: {} });
    await user.click(opener());
    expect(await screen.findByRole('button', { name: 'restaurant' })).toBeInTheDocument();
  });

  it('switches to the venue picked when nothing is waiting to be sent', async () => {
    const { store, user } = draw();

    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'The Restaurant' }));

    await waitFor(() => { expect(store.switchLocation).toHaveBeenCalledWith('restaurant'); });
    expect(store.changesStillWaiting).toHaveBeenCalledTimes(1);
    expect(store.switchLocation).toHaveBeenCalledTimes(1);
  });

  it('asks the database before it switches, not after', async () => {
    const { store, user } = draw();
    const order: string[] = [];
    store.changesStillWaiting.mockImplementation(() => { order.push('check'); return Promise.resolve(false); });
    store.switchLocation.mockImplementation(() => { order.push('switch'); return Promise.resolve(); });

    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'The Restaurant' }));

    await waitFor(() => { expect(order).toEqual(['check', 'switch']); });
  });

  it('does not switch on Cancel, and gives the focus back to the button', async () => {
    const { store, user } = draw();

    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(store.switchLocation).not.toHaveBeenCalled();
    await waitFor(() => { expect(opener()).toHaveFocus(); });
  });

  describe('when something typed on this phone has not reached the server', () => {
    async function pickWithUnsent() {
      const view = draw();
      view.store.changesStillWaiting.mockResolvedValue(true);
      await view.user.click(opener());
      await view.user.click(await screen.findByRole('button', { name: 'The Restaurant' }));
      return view;
    }

    it('warns first and does not switch yet', async () => {
      const { store } = await pickWithUnsent();

      expect(await screen.findByRole('alertdialog', { name: 'Not sent yet' })).toBeInTheDocument();
      expect(store.switchLocation).not.toHaveBeenCalled();
    });

    it('stays on «Stay», with the focus back on the button', async () => {
      const { store, user } = await pickWithUnsent();

      await user.click(await screen.findByRole('button', { name: 'Stay' }));

      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(store.switchLocation).not.toHaveBeenCalled();
      await waitFor(() => { expect(opener()).toHaveFocus(); });
    });

    it('switches to the venue picked on «Go on anyway»', async () => {
      const { store, user } = await pickWithUnsent();

      await user.click(await screen.findByRole('button', { name: 'Go on anyway' }));

      await waitFor(() => { expect(store.switchLocation).toHaveBeenCalledWith('restaurant'); });
      expect(store.switchLocation).toHaveBeenCalledTimes(1);
    });
  });

  it('speaks Italian', async () => {
    const { user } = draw(TWO_VENUES, 'it');
    await user.click(opener());
    expect(await screen.findByRole('dialog', { name: 'Cambia locale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });
});
