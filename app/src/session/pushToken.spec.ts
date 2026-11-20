import { describe, expect, test, vi } from 'vitest';
import { createPushToken, emulatorPushToken } from './pushToken';

const registration = { scope: '/mise_app/' } as unknown as ServiceWorkerRegistration;

describe('the phone push token', () => {
  test('⚠️ on a local address getToken is never called, and the token is an emulator-only one', async () => {
    const getToken = vi.fn(async () => 'real-token');
    const load = vi.fn(async () => ({ getToken }));
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
      isEmulator: false, vapidKey: 'PUBLIC-KEY', load: async () => ({ getToken }), serviceWorkerReady: async () => registration,
    })();
    expect(token).toBe('fcm-token');
    expect(getToken).toHaveBeenCalledWith({ vapidKey: 'PUBLIC-KEY', serviceWorkerRegistration: registration });
  });

  test('a refusal from the SDK is passed on to the caller', async () => {
    const failing = createPushToken({
      isEmulator: false, vapidKey: 'K', load: async () => ({ getToken: async () => { throw Object.assign(new Error('x'), { code: 'messaging/token-subscribe-failed' }); } }),
      serviceWorkerReady: async () => registration,
    });
    await expect(failing()).rejects.toMatchObject({ code: 'messaging/token-subscribe-failed' });
  });
});
