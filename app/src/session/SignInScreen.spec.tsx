import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import { SignInScreen } from './SignInScreen';

const SIGNED_OUT = { status: 'signed-out', user: null } as const;
const draw = (lang: 'en' | 'it' = 'en') => renderWithSession(<SignInScreen />, { session: SIGNED_OUT, lang });

const email = () => screen.getByLabelText('Email');
const password = () => screen.getByLabelText('Password');
const signIn = () => screen.getByRole('button', { name: 'Sign in' });
const forgot = () => screen.getByRole('button', { name: 'Forgot your password?' });

// A promise a spec settles by hand, to hold a call "in flight".
function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe('SignInScreen: what is on it', () => {
  it('is the product\'s name over a short instruction and two labelled fields', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1, name: 'Mise' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to open your location.')).toBeInTheDocument();
    expect(email()).toHaveAttribute('type', 'email');
    expect(email()).toHaveAttribute('autocomplete', 'username');
    expect(email()).toHaveAttribute('inputmode', 'email');
    expect(password()).toHaveAttribute('type', 'password');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
  });

  it('is a main landmark, titled with the product\'s name and no venue\'s', () => {
    draw();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(document.title).toBe('Mise');
  });

  it('puts the cursor in the email field', () => {
    draw();
    expect(email()).toHaveFocus();
  });

  it('leaves out the entrances that come with the invitations (step 3g)', () => {
    draw();
    expect(screen.queryByText('I have a join code')).not.toBeInTheDocument();
    expect(screen.queryByText('How to install the app')).not.toBeInTheDocument();
  });

  it('speaks Italian', () => {
    draw('it');
    expect(screen.getByText('Accedi per aprire il tuo locale.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accedi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Password dimenticata?' })).toBeInTheDocument();
  });
});

describe('SignInScreen: an empty field', () => {
  it('names an empty email on the field and moves the focus there', async () => {
    const { store, user } = draw();
    await user.click(password());

    await user.click(signIn());

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email.');
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(email()).toHaveAccessibleDescription('Enter your email.');
    expect(email()).toHaveFocus();
    expect(store.signIn).not.toHaveBeenCalled();
  });

  it('treats an email of only spaces as empty', async () => {
    const { store, user } = draw();
    await user.type(email(), '   ');
    await user.click(signIn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email.');
    expect(store.signIn).not.toHaveBeenCalled();
  });

  it('names an empty password on the field and moves the focus there', async () => {
    const { store, user } = draw();
    await user.type(email(), 'chef@club.test');

    await user.click(signIn());

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your password.');
    expect(password()).toHaveAttribute('aria-invalid', 'true');
    expect(password()).toHaveFocus();
    expect(email()).not.toHaveAttribute('aria-invalid', 'true');
    expect(store.signIn).not.toHaveBeenCalled();
  });

  it('takes the message away as soon as the person types in that field', async () => {
    const { user } = draw();
    await user.click(signIn());
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.type(email(), 'c');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(email()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('says it in Italian', async () => {
    const { user } = draw('it');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Inserisci la tua email.');
  });
});

describe('SignInScreen: signing in', () => {
  it('sends what was typed', async () => {
    const { store, user } = draw();
    await user.type(email(), 'chef@club.test');
    await user.type(password(), 'correct horse');

    await user.click(signIn());

    expect(store.signIn).toHaveBeenCalledTimes(1);
    expect(store.signIn).toHaveBeenCalledWith('chef@club.test', 'correct horse');
  });

  it('submits on Enter from either field', async () => {
    const { store, user } = draw();
    await user.type(email(), 'chef@club.test');
    await user.type(password(), 'pw{Enter}');
    expect(store.signIn).toHaveBeenCalledWith('chef@club.test', 'pw');
  });

  it('shows «Signing in…» and refuses a second try while the first is in flight', async () => {
    const { store, user } = draw();
    const call = deferred();
    store.signIn.mockReturnValue(call.promise);
    await user.type(email(), 'chef@club.test');
    await user.type(password(), 'pw{Enter}');

    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.type(password(), '{Enter}');
    await user.click(button);
    expect(store.signIn).toHaveBeenCalledTimes(1);

    await act(async () => { call.resolve(); });
    // Still waiting for the session to replace this screen — never a second send.
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeInTheDocument();
  });

  it.each([
    ['auth/invalid-credential', 'That email and password do not match an account.'],
    ['auth/invalid-login-credentials', 'That email and password do not match an account.'],
    ['auth/wrong-password', 'That email and password do not match an account.'],
    ['auth/user-not-found', 'That email and password do not match an account.'],
    ['auth/invalid-email', 'That does not look like an email address.'],
    ['auth/user-disabled', 'This account has been turned off. Ask the owner to re-enable it.'],
    ['auth/too-many-requests', 'Too many attempts. Wait a minute and try again.'],
    ['auth/network-request-failed', 'No connection. The first sign-in on a device needs internet.'],
    ['auth/missing-password', 'Enter your password.'],
    ['auth/never-heard-of-it', 'Could not sign in. Please try again.'],
  ])('%s → «%s»', async (code, sentence) => {
    const { store, user } = draw();
    store.signIn.mockRejectedValue(Object.assign(new Error('firebase'), { code }));
    await user.type(email(), 'chef@club.test');
    await user.type(password(), 'pw{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(sentence);
  });

  it('puts the message above the button, ready to try again, with the password selected', async () => {
    const { store, user } = draw();
    store.signIn.mockRejectedValue({ code: 'auth/wrong-password' });
    await user.type(email(), 'chef@club.test');
    await user.type(password(), 'wrong{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert.compareDocumentPosition(signIn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signIn()).not.toHaveAttribute('aria-disabled', 'true');
    expect(signIn()).toHaveTextContent('Sign in');
    expect(password()).toHaveFocus();
    expect((password() as HTMLInputElement).selectionStart).toBe(0);
    expect((password() as HTMLInputElement).selectionEnd).toBe(5);
  });

  it('announces a second identical failure again', async () => {
    const { store, user } = draw();
    store.signIn.mockRejectedValue({ code: 'auth/wrong-password' });
    await user.type(email(), 'chef@club.test');
    await user.type(password(), 'wrong{Enter}');
    const first = await screen.findByRole('alert');

    await user.type(password(), '{Enter}');

    await waitFor(() => { expect(screen.getByRole('alert')).not.toBe(first); });
  });

  it('clears the last failure when the person tries again', async () => {
    const { store, user } = draw();
    const call = deferred();
    store.signIn.mockRejectedValueOnce({ code: 'auth/wrong-password' }).mockReturnValueOnce(call.promise);
    await user.type(email(), 'chef@club.test');
    await user.type(password(), 'wrong{Enter}');
    await screen.findByRole('alert');

    await user.type(password(), '{Enter}');

    await waitFor(() => { expect(screen.queryByRole('alert')).not.toBeInTheDocument(); });
  });

  it('says the same thing for an unknown account as for a wrong password', async () => {
    const texts: string[] = [];
    for (const code of ['auth/wrong-password', 'auth/user-not-found']) {
      const { store, user, unmount } = draw();
      store.signIn.mockRejectedValue({ code });
      await user.type(email(), 'someone@club.test');
      await user.type(password(), 'pw{Enter}');
      texts.push((await screen.findByRole('alert')).textContent ?? '');
      unmount();
    }
    expect(texts[0]).toBe(texts[1]);
  });
});

describe('SignInScreen: «Forgot your password?»', () => {
  it('asks for the email first when the box is empty', async () => {
    const { store, user } = draw();
    await user.click(password());

    await user.click(forgot());

    expect(await screen.findByRole('alert')).toHaveTextContent('Type your email here, then tap “Forgot your password?” again.');
    expect(email()).toHaveFocus();
    expect(store.sendReset).not.toHaveBeenCalled();
  });

  it('sends the reset to the address typed, and says so', async () => {
    const { store, user } = draw();
    await user.type(email(), '  chef@club.test ');

    await user.click(forgot());

    expect(store.sendReset).toHaveBeenCalledWith('chef@club.test');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If chef@club.test has an account, a reset link is on its way.',
    );
  });

  // ⚠️ The reset button must not tell anybody who has an account.
  it('says exactly the same thing for an address with no account', async () => {
    const { store, user } = draw();
    await user.type(email(), 'chef@club.test');
    await user.click(forgot());
    const sent = (await screen.findByRole('status')).textContent;

    store.sendReset.mockRejectedValue({ code: 'auth/user-not-found' });
    await user.click(forgot());

    await waitFor(() => { expect(store.sendReset).toHaveBeenCalledTimes(2); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect((await screen.findByRole('status')).textContent).toBe(sent);
  });

  it('says there is no connection when that is what happened', async () => {
    const { store, user } = draw();
    store.sendReset.mockRejectedValue({ code: 'auth/network-request-failed' });
    await user.type(email(), 'chef@club.test');

    await user.click(forgot());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No connection. The first sign-in on a device needs internet.',
    );
  });

  it('says a mistyped address does not look like one', async () => {
    const { store, user } = draw();
    store.sendReset.mockRejectedValue({ code: 'auth/invalid-email' });
    await user.type(email(), 'chef');

    await user.click(forgot());

    expect(await screen.findByRole('alert')).toHaveTextContent('That does not look like an email address.');
  });

  it('does not send the form', async () => {
    const { store, user } = draw();
    await user.type(email(), 'chef@club.test');
    await user.click(forgot());
    await screen.findByRole('status');
    expect(store.signIn).not.toHaveBeenCalled();
  });

  it('says it in Italian', async () => {
    const { user } = draw('it');
    await user.type(screen.getByLabelText('Email'), 'chef@club.test');
    await user.click(screen.getByRole('button', { name: 'Password dimenticata?' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se chef@club.test ha un account, il link per reimpostare la password sta arrivando.',
    );
  });
});
