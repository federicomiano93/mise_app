import { describe, expect, test, vi } from 'vitest';
import { createDropPushToken, createPushToken, emulatorPushToken } from './pushToken';

const registration = { scope: '/mise_app/' } as unknown as ServiceWorkerRegistration;

describe('the phone push token', () => {
  test('⚠️ on a local address getToken is never called, and the token is an emulator-only one', async () => {
    const getToken = vi.fn(async () => 'real-token');
    const load = vi.fn(async () => ({ getToken, deleteToken: async () => true }));
    const serviceWorkerReady = vi.fn(async () => registration);
    const token = await createPushToken({ isEmulator: true, vapidKey: 'K', load, serviceWorkerReady })();
    expect(token).toMatch(/^emulator-push-[0-9a-f]{16}$/);
    expect(token).not.toContain('/');
    expect(getToken).not.toHaveBeenCalled();
    // The SDK is not even downloaded.
    expect(load).not.toHaveBeenCalled();
    expect(serviceWorkerReady).not.toHaveBeenCalled();
  });

  test('the emulator token is different every time', () => {
    expect(emulatorPushToken()).not.toBe(emulatorPushToken());
  });

  test('on a real address getToken gets the VAPID key and the app\'s own service worker registration', async () => {
    const getToken = vi.fn(async () => 'fcm-token');
    const token = await createPushToken({
      isEmulator: false, vapidKey: 'PUBLIC-KEY', load: async () => ({ getToken, deleteToken: async () => true }), serviceWorkerReady: async () => registration,
    })();
    expect(token).toBe('fcm-token');
    expect(getToken).toHaveBeenCalledWith({ vapidKey: 'PUBLIC-KEY', serviceWorkerRegistration: registration });
  });

  test('a refusal from the SDK is passed on to the caller', async () => {
    const failing = createPushToken({
      isEmulator: false, vapidKey: 'K', load: async () => ({ getToken: async () => { throw Object.assign(new Error('x'), { code: 'messaging/token-subscribe-failed' }); }, deleteToken: async () => true }),
      serviceWorkerReady: async () => registration,
    });
    await expect(failing()).rejects.toMatchObject({ code: 'messaging/token-subscribe-failed' });
  });

  // ⚠️ AUDIT A2-1: a phone whose row the rules refuse as somebody else's drops its token, so the next one is new.
  test('dropping the token calls Firebase deleteToken on a real address', async () => {
    const deleteToken = vi.fn(async () => true);
    await createDropPushToken({ isEmulator: false, load: async () => ({ getToken: async () => 't', deleteToken }) })();
    expect(deleteToken).toHaveBeenCalledTimes(1);
  });

  test('⚠️ on a local address nothing is dropped and the SDK is not even downloaded', async () => {
    const load = vi.fn(async () => ({ getToken: async () => 't', deleteToken: async () => true }));
    await createDropPushToken({ isEmulator: true, load })();
    expect(load).not.toHaveBeenCalled();
  });

  test('a refusal from deleteToken is passed on to the caller', async () => {
    const drop = createDropPushToken({ isEmulator: false, load: async () => ({
      getToken: async () => 't', deleteToken: async () => { throw Object.assign(new Error('x'), { code: 'messaging/token-unsubscribe-failed' }); },
    }) });
    await expect(drop()).rejects.toMatchObject({ code: 'messaging/token-unsubscribe-failed' });
  });
});
