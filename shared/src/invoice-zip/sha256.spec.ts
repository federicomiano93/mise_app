// Unit tests for the hand-written SHA-256 (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/invoice-zip/sha256.js. Ported from the two SHA-256 tests of
// tests/invoice-zip-support.test.mjs; the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: both SHA-256 tests (the FIPS 180-4 vectors; agreement with the platform's own SHA-256 around every
// padding boundary and on unicode). One difference of means, not of what is checked: shared/ has no Node types
// (so no `node:crypto`), and the original's `randomBytes` and `createHash` become a fixed pseudo-random
// sequence and the Web Crypto `crypto.subtle.digest` that Node provides as a global, which makes the
// comparison async (the tests await it) and reproducible.
// Added: sha256Hex and sha256Bytes agree on the same text.

import { describe, expect, test } from 'vitest';
import * as ported from './sha256';
import * as legacyJs from '../../../js/orders/invoice-zip/sha256.js';

const legacy = legacyJs as unknown as typeof ported;

declare const TextEncoder: new () => { encode(input: string): Uint8Array };

// The platform's SHA-256, typed here because shared/ declares no DOM or Node types.
const subtle = (globalThis as unknown as {
  crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
}).crypto.subtle;

async function platformSha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A small deterministic generator (an LCG), so a failure names bytes that can be produced again.
function pseudoRandomBytes(length: number, seed: number): Uint8Array {
  let state = seed >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('SHA-256 matches the FIPS 180-4 vectors', () => {
    expect(m.sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(m.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(m.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(m.sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'))
      .toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
    expect(m.sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  test('SHA-256 agrees with the platform around every padding boundary and on unicode', async () => {
    for (let length = 0; length <= 130; length += 1) {
      const bytes = pseudoRandomBytes(length, length + 1);
      expect(m.sha256Bytes(bytes), `${length} bytes`).toBe(await platformSha256(bytes));
    }
    for (const text of ['è à ù', 'ÈRSSMRA80A01H501U', '日本語のテキスト', 'emoji 🍞 pane', 'x'.repeat(1000)]) {
      expect(m.sha256Hex(text), text).toBe(await platformSha256(new TextEncoder().encode(text)));
    }
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('sha256Hex is sha256Bytes of the UTF-8 text, and a non-text value is read as its string', () => {
    expect(m.sha256Hex('pane')).toBe(m.sha256Bytes(new TextEncoder().encode('pane')));
    expect(m.sha256Hex(12)).toBe(m.sha256Hex('12'));
    expect(m.sha256Hex(undefined)).toBe(m.sha256Hex('undefined'));
  });
});
