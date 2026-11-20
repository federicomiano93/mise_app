import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { fakePhonePush } from '../testing/fakePhonePush';
import type { FakePhonePush } from '../testing/fakePhonePush';
import { LOAD, renderOrders } from '../testing/renderOrders';

// «Orders» → Settings → «Notices (this phone)»: the button registers THIS phone for server push (phonePush.ts), so the phone gets
// order-list requests and clients' orders with the app closed, and the «do not buzz this phone» switch has something to silence.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const ENABLE = 'Enable notifications';
const ON = 'Notifications are on for this device.';
const MUTE = 'Do not buzz this phone about order lists';

async function opened(phonePush: FakePhonePush, lang: 'en' | 'it' = 'en') {
  const source = fakeOrdersSource({ ordersConfig: { orderLists: true } });
  const view = renderOrders('/orders/settings', { source, phonePush, lang });
  await screen.findByRole('heading', { name: lang === 'en' ? 'Notices (this phone)' : 'Avvisi (questo telefono)' }, LOAD);
  return { ...view, source };
}

describe('the button that registers this phone', () => {
  it('is shown when the permission has not been asked, and one tap registers the phone', async () => {
    const phonePush = fakePhonePush({ reason: 'ask' });
    const view = await opened(phonePush);
    expect(screen.getByText(/^Get an alert when an order is due/)).toBeInTheDocument();
    expect(screen.queryByText(ON)).not.toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    expect(phonePush.register).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ON)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });

  it('⚠️ is shown once more to a phone that only granted the permission (the old button), and a tap registers it', async () => {
    const phonePush = fakePhonePush({ reason: 'granted', owner: '' });
    const view = await opened(phonePush);
    expect(screen.queryByText(ON)).not.toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    expect(await screen.findByText(ON)).toBeInTheDocument();
    expect(phonePush.register).toHaveBeenCalledTimes(1);
  });

  it('is shown to a phone registered for somebody else, not the status line', async () => {
    await opened(fakePhonePush({ reason: 'granted', owner: 'somebody-else' }));
    expect(screen.getByRole('button', { name: ENABLE })).toBeInTheDocument();
    expect(screen.queryByText(ON)).not.toBeInTheDocument();
  });

  it('shows the status line, and no button, once the phone is registered for the person', async () => {
    await opened(fakePhonePush({ reason: 'granted', owner: 'u1' }));
    expect(screen.getByText(ON)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });

  it('is busy while it works, and cannot be tapped twice', async () => {
    const phonePush = fakePhonePush({ reason: 'ask' });
    let finish: (outcome: 'on') => void = () => undefined;
    phonePush.register.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = await opened(phonePush);
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    const button = screen.getByRole('button', { name: ENABLE });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await view.user.click(button);
    expect(phonePush.register).toHaveBeenCalledTimes(1);
    finish('on');
    await waitFor(() => { expect(screen.getByRole('button', { name: ENABLE })).not.toHaveAttribute('aria-disabled', 'true'); });
  });

  it('moves the focus to the status line that replaces the button', async () => {
    const phonePush = fakePhonePush({ reason: 'ask' });
    const view = await opened(phonePush);
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    const line = (await screen.findByText(ON)).closest('p');
    await waitFor(() => { expect(line).toHaveFocus(); });
    expect(line).toHaveAttribute('tabindex', '-1');
  });

  it('says so in a polite live region when it failed, and the button comes back', async () => {
    const phonePush = fakePhonePush({ reason: 'ask', outcome: 'failed' });
    const view = await opened(phonePush);
    const region = screen.getAllByRole('status').find(node => node.className.includes('quiet') && node.parentElement?.getAttribute('role') === 'group');
    expect(region).toBeDefined();
    expect(region).toHaveTextContent('');
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    expect(await screen.findByText('Notifications could not be turned on for this phone. Check your connection and try again.')).toBeInTheDocument();
    expect(region).toHaveTextContent('Notifications could not be turned on');
    expect(screen.getByRole('button', { name: ENABLE })).toBeEnabled();
    // A second try clears the line while it works.
    phonePush.outcome = 'on';
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    expect(await screen.findByText(ON)).toBeInTheDocument();
    expect(screen.queryByText(/could not be turned on/)).not.toBeInTheDocument();
  });

  it('⚠️ focus follows to the sentence that replaces the button when the prompt is refused', async () => {
    const phonePush = fakePhonePush({ reason: 'ask', outcome: 'blocked' });
    phonePush.register.mockImplementation(async () => { phonePush.reason = 'blocked'; return 'blocked'; });
    const view = await opened(phonePush);
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    const line = await screen.findByText(/^Notifications are blocked/);
    await waitFor(() => { expect(line).toHaveFocus(); });
    expect(line).toHaveAttribute('tabindex', '-1');
  });

  it('a prompt answered «blocked» takes the button away and says where to turn them on', async () => {
    const phonePush = fakePhonePush({ reason: 'ask', outcome: 'blocked' });
    phonePush.register.mockImplementation(async () => { phonePush.reason = 'blocked'; return 'blocked'; });
    const view = await opened(phonePush);
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    expect(await screen.findByText(/^Notifications are blocked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });
});

describe('a phone that says «on» but lost its subscription', () => {
  it('⚠️ gets the button back, and the mute switch locks again', async () => {
    const phonePush = fakePhonePush({ reason: 'granted', owner: 'u1', verifyAnswer: 'cleared' });
    window.localStorage.setItem('push-token', 'fake-token');
    window.localStorage.setItem('push-token-uid', 'u1');
    await opened(phonePush);
    expect(await screen.findByRole('button', { name: ENABLE })).toBeInTheDocument();
    expect(screen.queryByText(ON)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: MUTE })).toBeDisabled();
    expect(phonePush.verify).toHaveBeenCalled();
  });

  it('keeps the status line while the subscription is there', async () => {
    const phonePush = fakePhonePush({ reason: 'granted', owner: 'u1', verifyAnswer: 'ok' });
    await opened(phonePush);
    await waitFor(() => { expect(phonePush.verify).toHaveBeenCalled(); });
    expect(screen.getByText(ON)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });

  it('is not asked while the phone is not registered', async () => {
    const phonePush = fakePhonePush({ reason: 'granted', owner: '' });
    await opened(phonePush);
    expect(phonePush.verify).not.toHaveBeenCalled();
  });
});

describe('where push cannot be set up but notifications exist (permission only)', () => {
  it('the preview project or a browser without push still gets the button, and «on» once the permission is granted', async () => {
    const phonePush = fakePhonePush({ reason: 'not-configured', only: 'default' });
    const view = await opened(phonePush);
    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    expect(await screen.findByText(ON)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
    // Nothing is registered for the mute switch.
    expect(screen.getByRole('switch', { name: MUTE })).toBeDisabled();
  });

  it('a browser that has notifications but no PushManager, already granted, says on; denied says blocked', async () => {
    await opened(fakePhonePush({ reason: 'unsupported', only: 'granted' }));
    expect(screen.getByText(ON)).toBeInTheDocument();
    cleanup();
    await opened(fakePhonePush({ reason: 'unsupported', only: 'denied' }));
    expect(screen.getByText(/^Notifications are blocked/)).toBeInTheDocument();
  });
});

describe('the reasons a phone cannot', () => {
  it('blocked', async () => {
    await opened(fakePhonePush({ reason: 'blocked' }));
    expect(screen.getByText(/^Notifications are blocked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });

  it('unsupported, and not configured (the preview), say the device cannot', async () => {
    for (const reason of ['unsupported', 'not-configured'] as const) {
      await opened(fakePhonePush({ reason }));
      expect(screen.getByText('This device does not support notifications.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('an iPhone outside the Home-screen app is told to add it, in both languages', async () => {
    await opened(fakePhonePush({ reason: 'install-first' }));
    expect(screen.getByText('On iPhone and iPad, notifications only work once the app has been added to the Home Screen.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
    cleanup();
    await opened(fakePhonePush({ reason: 'install-first' }), 'it');
    expect(screen.getByText('Su iPhone e iPad le notifiche funzionano solo dopo aver aggiunto l’app alla schermata Home.')).toBeInTheDocument();
  });
});

describe('the explanation', () => {
  it('no longer says the alerts only show with the app open, in either language', async () => {
    await opened(fakePhonePush());
    expect(screen.getByText(/Order lists from colleagues and clients’ orders arrive even when the app is closed\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/only show while the app is open/)).not.toBeInTheDocument();
    cleanup();
    await opened(fakePhonePush(), 'it');
    expect(screen.getByText(/Le liste d’ordine dei colleghi e gli ordini dei clienti arrivano anche con l’app chiusa\.$/)).toBeInTheDocument();
  });

  it('the failure line is in Italian too', async () => {
    const phonePush = fakePhonePush({ outcome: 'failed' });
    const view = await opened(phonePush, 'it');
    await view.user.click(screen.getByRole('button', { name: 'Attiva le notifiche' }));
    expect(await screen.findByText('Non è stato possibile attivare le notifiche su questo telefono. Controlla la connessione e riprova.')).toBeInTheDocument();
  });
});

describe('the «do not buzz this phone» switch', () => {
  it('is locked, with its reason, while the phone is not registered, and usable right after the tap registers it', async () => {
    const phonePush = fakePhonePush({ reason: 'granted', owner: '' });
    const view = await opened(phonePush);
    const lock = screen.getByRole('switch', { name: MUTE });
    expect(lock).toBeDisabled();
    expect(screen.getByText('This phone does not receive alerts yet, so there is nothing to silence.')).toBeInTheDocument();

    await view.user.click(screen.getByRole('button', { name: ENABLE }));
    await screen.findByText(ON);
    const unlocked = screen.getByRole('switch', { name: MUTE });
    expect(unlocked).toBeEnabled();
    expect(screen.queryByText('This phone does not receive alerts yet, so there is nothing to silence.')).not.toBeInTheDocument();

    // It writes onto the token the registration stored.
    await view.user.click(unlocked);
    await waitFor(() => { expect(window.localStorage.getItem('push-mute-order-requests')).toBe('1'); });
  });

  it('is locked for a phone registered to somebody else', async () => {
    await opened(fakePhonePush({ reason: 'granted', owner: 'somebody-else' }));
    expect(screen.getByRole('switch', { name: MUTE })).toBeDisabled();
  });
});
