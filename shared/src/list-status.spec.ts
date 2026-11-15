// Unit tests for the Ingredients / Suppliers lists' «what may the empty list say» rule (P15), run against BOTH implementations:
// the TypeScript port in shared/ and `listStatus` in js/orders/registry.js, which the live app uses today. Same cases, same
// answers, until the switch to Mise 2.

import { describe, expect, test } from 'vitest';
import registrySource from '../../js/orders/registry.js?raw';
import * as ported from './list-status';

// js/orders/registry.js is the whole Ingredients & Suppliers SCREEN (it needs the DOM at load), so it cannot be imported in a
// node spec. The two things this port is of are cut out of the file and run as they stand: from `export const LIST_STATUS` to
// the closing brace of `listStatus`. If either moves or is renamed, this fails loudly instead of testing nothing.
function legacyOf(): typeof ported {
  const source = registrySource.replace(/\r\n/g, '\n');
  const from = source.indexOf('export const LIST_STATUS');
  const fn = source.indexOf('export function listStatus');
  const to = source.indexOf('\n}\n', fn);
  if (from < 0 || fn < from || to < fn) throw new Error('LIST_STATUS / listStatus not found in js/orders/registry.js');
  const code = source.slice(from, to + 2).replace(/export /g, '');
  return new Function(`${code}\nreturn { LIST_STATUS, listStatus };`)() as typeof ported;
}
const legacy = legacyOf();

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const base = { venueOpen: true, loaded: false, failed: false, emptyCopy: false, stalled: false, online: true };

  test('the names of the five states', () => {
    expect({ ...m.LIST_STATUS }).toStrictEqual({
      starting: 'starting', answered: 'answered', waiting: 'waiting', unreachable: 'unreachable', failed: 'failed',
    });
    expect(Object.isFrozen(m.LIST_STATUS)).toBe(true);
  });

  test('a list that has answered is answered, whatever else is true', () => {
    expect(m.listStatus({ ...base, loaded: true })).toBe(m.LIST_STATUS.answered);
    expect(m.listStatus({ ...base, loaded: true, failed: true, stalled: true, online: false, venueOpen: false })).toBe(m.LIST_STATUS.answered);
  });

  test('a dead listener is failed (before «no venue»), and nothing is said before a venue is open', () => {
    expect(m.listStatus({ ...base, failed: true })).toBe(m.LIST_STATUS.failed);
    expect(m.listStatus({ ...base, failed: true, venueOpen: false })).toBe(m.LIST_STATUS.failed);
    expect(m.listStatus({ ...base, venueOpen: false, stalled: true })).toBe(m.LIST_STATUS.starting);
  });

  test('⚠️ waiting until the clock runs out (10 s)', () => {
    expect(m.listStatus(base)).toBe(m.LIST_STATUS.waiting);
    expect(m.listStatus({ ...base, stalled: true })).toBe(m.LIST_STATUS.unreachable);
  });

  test('⚠️ an empty copy alone is not «no connection»: only with the browser offline', () => {
    expect(m.listStatus({ ...base, emptyCopy: true })).toBe(m.LIST_STATUS.waiting);
    expect(m.listStatus({ ...base, emptyCopy: true, online: undefined })).toBe(m.LIST_STATUS.waiting);
    expect(m.listStatus({ ...base, emptyCopy: true, online: false })).toBe(m.LIST_STATUS.unreachable);
    expect(m.listStatus({ ...base, emptyCopy: false, online: false })).toBe(m.LIST_STATUS.waiting);
  });
});
