import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import { NoAccessScreen } from './NoAccessScreen';
import { SessionErrorScreen } from './SessionErrorScreen';

// The two screens that only tell a person where they stand: no venue for this account, and
// "could not check". They share a shape, so they share a spec.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  {
    name: 'NoAccessScreen',
    screenElement: <NoAccessScreen />,
    status: 'no-access',
    english: ['No location yet', 'This account is not linked to a location. Ask the owner of your venue to add you.'],
    italian: ['Nessun locale', 'Questo account non è collegato a nessun locale. Chiedi al titolare del tuo locale di aggiungerti.'],
  },
  {
    name: 'SessionErrorScreen',
    screenElement: <SessionErrorScreen />,
    status: 'error',
    english: ['Could not check your access', 'This usually means no connection. Check it and try again.'],
    italian: [
      'Non è stato possibile verificare il tuo accesso',
      'Di solito vuol dire che manca la connessione. Controllala e riprova.',
    ],
  },
] as const)('$name', ({ screenElement, status, english, italian }) => {
  const session = { status, options: [], locationId: null, location: null } as const;

  it('says where the person stands, and with which account', () => {
    renderWithSession(screenElement, { session });
    expect(screen.getByRole('heading', { level: 1, name: english[0] })).toBeInTheDocument();
    expect(screen.getByText(english[1])).toBeInTheDocument();
    expect(screen.getByText('owner@club.test')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('names the account by its id when it has no email', () => {
    renderWithSession(screenElement, {
      session: { ...session, user: { uid: 'u-77', email: null, isAnonymous: false } },
    });
    expect(screen.getByText('u-77')).toBeInTheDocument();
  });

  it('reloads the page on «Try again»', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const { user } = renderWithSession(screenElement, { session });

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('offers «Log out», which asks first', async () => {
    const { store, user } = renderWithSession(screenElement, { session });
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('alertdialog', { name: 'Log out?' })).toBeInTheDocument();
    expect(store.signOut).not.toHaveBeenCalled();
  });

  it('speaks Italian', () => {
    renderWithSession(screenElement, { session, lang: 'it' });
    expect(screen.getByRole('heading', { level: 1, name: italian[0] })).toBeInTheDocument();
    expect(screen.getByText(italian[1])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument();
  });
});
