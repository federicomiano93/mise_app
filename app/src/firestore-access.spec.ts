import { describe, expect, test } from 'vitest';

// ⚠️ FIRESTORE HAS ONE DOOR: session/firebaseBackend.ts. Its settings (the offline cache shared
// with the current app on this origin, the emulator on localhost) are fixed by its FIRST use, and
// since step 2c it is loaded lazily, so the window in which something else could touch it first
// is wide. A getFirestore() that ran first would make THE one client memory-only; a value import
// of 'firebase/firestore' anywhere would pull its 554 KB back into the first load. Both are silent
// — every other spec stays green — so this reads the sources themselves.
const sources = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
const BACKEND = './session/firebaseBackend.ts';
const code = (text: string) => text.replace(/^\s*\/\/.*$/gm, '');

const production = Object.entries(sources).filter(([file]) => !/\.spec\.tsx?$/.test(file) && !file.startsWith('./testing/'));

describe('Firestore is reached only through the backend', () => {
  test('the scan finds the sources', () => {
    expect(production.map(([file]) => file)).toContain(BACKEND);
    expect(production.length).toBeGreaterThan(30);
  });

  test('nothing but the backend starts Firestore', () => {
    const offenders = production
      .filter(([file]) => file !== BACKEND)
      .filter(([, text]) => /\b(getFirestore|initializeFirestore)\s*\(/.test(code(text)))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  test('nothing imports Firestore\'s code eagerly — types only, and the backend\'s one dynamic import', () => {
    const eager = production
      .filter(([, text]) => /^\s*import\s+(?!type\b)[^;]*from\s+'firebase\/firestore'/m.test(code(text)))
      .map(([file]) => file);
    expect(eager).toEqual([]);
    const dynamic = production
      .filter(([, text]) => /import\(\s*'firebase\/firestore'\s*\)/.test(code(text)))
      .map(([file]) => file);
    expect(dynamic).toEqual([BACKEND]);
  });

  test('the backend starts it with the shared offline cache and, locally, the emulator before any read', () => {
    const backend = code(sources[BACKEND] ?? '');
    const start = backend.indexOf("import('firebase/firestore')");
    const emulator = backend.indexOf("fs.connectFirestoreEmulator(db, 'localhost', 8080)");
    const handedOut = backend.indexOf('ready = { fs, db }');
    expect(backend).toMatch(/persistentLocalCache\(\{\s*tabManager:\s*persistentMultipleTabManager\(\)\s*\}\)/);
    expect(start).toBeGreaterThan(0);
    expect(emulator).toBeGreaterThan(start);
    expect(handedOut).toBeGreaterThan(emulator);
    expect(backend).toMatch(/if \(isEmulator\) fs\.connectFirestoreEmulator/);
  });

  test('the sign-in form fetches Firestore while the password is typed', () => {
    expect(code(sources['./main.tsx'] ?? '')).toMatch(/status === 'signed-out'\) backend\.preloadFirestore\(\)/);
  });
});
