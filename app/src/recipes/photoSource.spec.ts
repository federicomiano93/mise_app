// The photo reader's two calls (step 3d-9): their names, what they send, the venue they name, and the client timeout that
// must never be shorter than the function's own (the current app's tests/photo-timeouts.test.mjs).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { createPhotoSource, PHOTO_CLIENT_TIMEOUT_MS } from './photoSource';

describe('photoSource', () => {
  test('a read sends the venue the source was made for and the images, to readRecipeFromPhotos, with the long timeout', async () => {
    const call = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true }));
    const source = createPhotoSource(call, 'panificio-miano');
    const images = [{ mediaType: 'image/jpeg', data: 'AAAA' }];
    await expect(source.readRecipe(images)).resolves.toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith('readRecipeFromPhotos', { locationId: 'panificio-miano', images }, PHOTO_CLIENT_TIMEOUT_MS);
  });

  test('the switch sends the venue and the wanted state to setRecipePhoto, and a refusal rejects', async () => {
    const call = vi.fn(async (..._args: unknown[]): Promise<unknown> => { throw Object.assign(new Error('Only an owner or a manager'), { code: 'functions/permission-denied' }); });
    const source = createPhotoSource(call, 'bakery');
    await expect(source.setRecipePhoto(true)).rejects.toThrow('Only an owner or a manager');
    expect(call.mock.calls[0]![0]).toBe('setRecipePhoto');
    expect(call.mock.calls[0]![1]).toEqual({ locationId: 'bakery', enabled: true });
  });

  test('⚠️ the client waits at least as long as the function runs (a phone that gives up first abandons a paid read)', () => {
    const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'functions', 'recipe-photo.js'), 'utf8');
    const match = server.match(/timeoutSeconds:\s*(\d+)/);
    expect(match, 'functions/recipe-photo.js no longer states timeoutSeconds').not.toBeNull();
    expect(PHOTO_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(Number(match![1]) * 1000);
  });
});

// ⚠️ THE FUNCTIONS EMULATOR LINE is checked in the backend's source: nothing else would notice losing it, and without it a
// photo read on localhost would run the REAL, PAID function (the API key's referrer list allows localhost).
const backendSource = import.meta.glob<string>('../session/firebaseBackend.ts', { query: '?raw', import: 'default', eager: true });

describe('the Cloud Functions client', () => {
  const code = (Object.values(backendSource)[0] ?? '').replace(/^\s*\/\/.*$/gm, '');
  const body = code.slice(code.indexOf('function functionsKit'), code.indexOf('async function callFunction'));

  test('is loaded on first use, in us-central1, and pointed at the emulator on a local address before any call', () => {
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/import\('firebase\/functions'\)/);
    expect(body).toMatch(/getFunctions\(app, 'us-central1'\)/);
    expect(body).toMatch(/if \(isEmulator\) sdk\.connectFunctionsEmulator\(functions, '127\.0\.0\.1', 5001\)/);
  });
});
