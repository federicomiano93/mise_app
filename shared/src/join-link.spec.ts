// Unit tests for how a join code travels (P15), run against BOTH implementations: the TypeScript
// port in shared/ and js/join-link.js, which the live app uses today. Ported from
// tests/join-link.test.mjs (every test of what is ported).
//
// join-link.ts is a PARTIAL port (its header says what it leaves out), so parity.spec.ts does not
// pair it: the last test here compares the names, arity and constants of what it does port.

import { describe, expect, test } from 'vitest';
import * as ported from './join-link';
import * as legacyJs from '../../js/join-link.js';
import { DIGITS_LENGTH, LINK_LENGTH } from './join-code';

const legacy = legacyJs as unknown as typeof ported;

const HERE = 'https://example.test/mise_app/orders.html';
const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';           // 32, the real shape
const LONGER = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4gH7jKl0n'; // 40, still valid

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the token is a real 32-character link token', () => {
    expect(TOKEN.length).toBe(LINK_LENGTH);
  });

  test('the link lands on the front door, not a page of its own', () => {
    expect(m.joinLinkFor(TOKEN, HERE).startsWith(`https://example.test/mise_app/${m.JOIN_PAGE}`)).toBe(true);
  });

  // ⚠️ A query string is sent to the server and lands in its logs; a fragment never leaves the browser.
  test('the token rides in the FRAGMENT, never the query string', () => {
    const link = m.joinLinkFor(TOKEN, HERE);
    expect(link).toContain('#join=');
    expect(link).not.toContain('?');
  });

  test('a token needing escaping is escaped', () => {
    const link = m.joinLinkFor('a b&c=d', HERE);
    expect(link).not.toContain(' ');
    expect(link).not.toContain('&');
  });

  test('a link built here is read back identically', () => {
    expect(m.readJoinToken(m.joinLinkFor(TOKEN, HERE))).toBe(TOKEN);
    expect(m.readJoinToken(m.joinLinkFor(LONGER, HERE))).toBe(LONGER);
  });

  // ⚠️ THE SAME SHAPE AS TODAY: a link the current app sent before the switch opens Mise 2.
  test('a link the current app sends today is read', () => {
    expect(m.readJoinToken(`https://federicomiano93.github.io/mise_app/index.html#join=${TOKEN}`)).toBe(TOKEN);
  });

  test('anything that is not a token reads as nothing', () => {
    for (const href of [
      'https://example.test/index.html',
      'https://example.test/index.html#',
      'https://example.test/index.html#b=bakery&k=xyz',
      'https://example.test/index.html#join=',
      'https://example.test/index.html#join=tooshort',
      `https://example.test/index.html#join=${'a'.repeat(65)}`,
      `https://example.test/index.html#join=${'a'.repeat(31)}!`,
      'not a url at all',
      '',
      null,
      undefined,
    ]) {
      expect(m.readJoinToken(href), String(href)).toBe('');
    }
  });

  test('a six-digit code in the fragment is NOT accepted as a link', () => {
    expect(m.readJoinToken('https://example.test/index.html#join=123456')).toBe('');
  });

  test('six digits are digits, however they were typed', () => {
    expect('123456'.length).toBe(DIGITS_LENGTH);
    for (const typed of ['123456', ' 123456 ', '123 456', '123-456', '12 34 56']) {
      expect(m.kindOfTyped(typed), typed).toBe('digits');
    }
  });

  test('a link token is a link, pasted with whitespace or not, and keeps its case', () => {
    expect(m.kindOfTyped(TOKEN)).toBe('link');
    expect(m.kindOfTyped(`  ${TOKEN}  `)).toBe('link');
    const mixed = 'AAAAbbbbCCCCddddEEEEffffGGGGhhhh';
    expect(m.kindOfTyped(mixed)).toBe('link');
    expect(m.readJoinToken(m.joinLinkFor(mixed, HERE))).toBe(mixed);
  });

  test('everything else is refused before the network', () => {
    for (const bad of ['', '   ', '12345', '1234567', 'abcdef', 'a'.repeat(31), 'a'.repeat(65),
      null, undefined, 123456, {}, []]) {
      expect(m.kindOfTyped(bad), String(bad)).toBeNull();
    }
  });
});

test('what is ported has the original’s names, shapes and constant', () => {
  expect(ported.JOIN_PAGE).toBe(legacy.JOIN_PAGE);
  for (const name of ['joinLinkFor', 'readJoinToken', 'kindOfTyped'] as const) {
    expect(ported[name].name).toBe(legacy[name].name);
    expect(ported[name].length, `${name}: arity`).toBe(legacy[name].length);
  }
});
