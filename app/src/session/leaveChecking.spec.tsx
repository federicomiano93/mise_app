import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { memoryStorage, renderWithSession } from '../testing/renderWithSession';
import type { Session } from './session';
import checkingCss from './LeaveChecking.module.css?raw';
import { InviteQuestion } from './InviteQuestion';
import { PENDING_INVITE_KEY, createJoinFlow } from './joinFlow';
import { SignOutButton } from './SignOutButton';
import { SwitchVenueButton } from './SwitchVenueButton';
import { useLeaveFlow } from './useLeaveFlow';

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

function Probe() {
  const flow = useLeaveFlow(() => undefined);
  return (
    <>
      <button type="button" onClick={() => { void flow.proceed(); void flow.proceed(); }}>twice</button>
      <button type="button" onClick={() => { void flow.proceed(); }}>once</button>
      <button type="button" onClick={flow.close}>close</button>
    </>
  );
}

describe('useLeaveFlow.proceed', () => {
  it('starts one check for two calls in the same tick', async () => {
    const { store, user } = renderWithSession(<Probe />);
    store.changesStillWaiting.mockReturnValue(new Promise<boolean>(() => undefined));

    await user.click(screen.getByRole('button', { name: 'twice' }));

    expect(store.changesStillWaiting).toHaveBeenCalledTimes(1);
  });

  it('checks again after close()', async () => {
    const { store, user } = renderWithSession(<Probe />);
    store.changesStillWaiting.mockReturnValue(new Promise<boolean>(() => undefined));

    await user.click(screen.getByRole('button', { name: 'once' }));
    await user.click(screen.getByRole('button', { name: 'close' }));
    await user.click(screen.getByRole('button', { name: 'once' }));

    expect(store.changesStillWaiting).toHaveBeenCalledTimes(2);
  });
});

describe('the invitation question', () => {
  it('reads «Checking…» on its button while it checks', async () => {
    const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
    const joinFlow = createJoinFlow(memoryStorage({ [PENDING_INVITE_KEY]: TOKEN }));
    const { store, user } = renderWithSession(<InviteQuestion />, { joinFlow });
    store.changesStillWaiting.mockReturnValue(new Promise<boolean>(() => undefined));
    const dialog = await screen.findByRole('alertdialog');

    await user.click(within(dialog).getByRole('button', { name: 'Add it' }));

    expect(await within(dialog).findByRole('button', { name: 'Checking…' })).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Checking everything has reached the server…');
  });
});

// ⚠️ The line is a live region: present (never display: none) while empty, and taking no room then — like the other live regions.
describe('the checking line', () => {
  const css = checkingCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const body = /\.line:empty\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('takes no room while empty and is never taken out of the page', () => {
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/width:\s*1px/);
    expect(body).toMatch(/height:\s*1px/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(css).not.toMatch(/display:\s*none/);
  });

  it('stops turning under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spinner\s*\{\s*animation:\s*none/);
  });
});
