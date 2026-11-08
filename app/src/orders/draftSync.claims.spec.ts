// A correction made while the write it corrects is in the air (the current app's #444, parity F-16): the port of the d-cases of
// tests/draft-claims.test.mjs. draftSync.ts runs for real, its write is held in the air by the test and settled as the server's
// answer would arrive (testing/draftHarness.ts).
//
// The hole: the screen then matches `known` (no snapshot has shown the write yet: about 5 s on the lab tablet on a freshly opened
// page), so measuring against `known` alone said «nothing to send», and the write in the air then landed and put the old number
// back, on screen and on the server.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newPage, settle } from '../testing/draftHarness';

const DAY = '2026-10-28';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

const keys = (map: object | undefined) => Object.keys(map ?? {});

describe('draftSync — a write in the air already carries a value', () => {
  it('a value a write in the air already carries is not sent a second time', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('c10', { qty: 5 });
    await p.pause();
    p.type('c10b', { qty: 2 });
    const flushing = p.sync.flush();                 // leaving the section a moment later
    expect(p.held).toHaveLength(2);
    expect(keys(p.held[1]?.data.entries)).toEqual(['c10b']);   // c10 is already on its way
    p.releaseHeld();
    await flushing;
  });
});

describe('draftSync — a correction while its write is in the air', () => {
  it('a quantity corrected to the server\'s value while the write is in the air goes out, and stays', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('d1', { qty: 5 });
    await p.pause();
    expect(p.held).toHaveLength(1);                  // the 5 is in the air

    p.type('d1', { qty: 0 });
    await p.pause();
    expect(p.held).toHaveLength(2);                  // the correction has a write of its own
    expect(p.held[1]?.data.entries).toEqual({ d1: { qty: 0, unit: '', supplierId: '' } });

    p.held[0]?.resolve();
    await settle();
    p.snapshot({ d1: { qty: 5, stock: 0, unit: '', supplierId: '' } });   // the 5 reaches the server first…
    expect(p.entries.d1?.qty).toBe(0);               // …and does not come back on screen

    p.held[1]?.resolve();
    await settle();
    p.snapshot({ d1: { qty: 0, stock: 0, unit: '', supplierId: '' } });   // …then the correction does
    expect(p.entries.d1?.qty).toBe(0);
    p.type('d1b', { qty: 1 });
    await p.pause();
    expect(keys(p.held[2]?.data.entries)).toEqual(['d1b']);               // the claim on d1 is over
    p.held[2]?.resolve();
    await settle();
  });

  it('a quantity put back to the one the server already had, while the write is in the air, goes out', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d2: { qty: 3, stock: 0 } });
    p.type('d2', { qty: 5 });
    await p.pause();
    p.type('d2', { qty: 3 });
    await p.pause();
    expect(p.held[1]?.data.entries).toEqual({ d2: { qty: 3, unit: '', supplierId: '' } });
    p.releaseHeld();
    await settle();
  });

  it('a correction still in its pause when the earlier write lands goes out after it', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('d3', { qty: 5 });
    await p.pause();
    p.type('d3', { qty: 0 });                        // the pause has started…
    p.held[0]?.resolve();                            // …and the 5 lands inside it
    await settle();
    await p.pause();
    expect(p.held[1]?.data.entries).toEqual({ d3: { qty: 0, unit: '', supplierId: '' } });
    p.held[1]?.resolve();
    await settle();
  });

  it('the correction goes out when leaving the section too', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('d4', { qty: 5 });
    await p.pause();
    p.type('d4', { qty: 0 });
    const flushing = p.sync.flush();
    expect(p.held[1]?.data.entries).toEqual({ d4: { qty: 0, unit: '', supplierId: '' } });
    p.releaseHeld();
    await flushing;
  });

  it('a stock count corrected while its write is in the air goes out, and only the stock', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d5: { qty: 3, stock: 1 } });
    p.type('d5', { stock: 2 });
    await p.pause();
    p.type('d5', { stock: 1 });
    await p.pause();
    expect(p.held[1]?.data.entries).toEqual({ d5: { stock: 1 } });
    p.releaseHeld();
    await settle();
  });

  it('a unit corrected while the write is in the air goes out with its quantity', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d6: { qty: 2, stock: 0 } });
    p.type('d6', { unit: 'busta' });
    await p.pause();
    p.type('d6', { unit: '' });
    await p.pause();
    expect(p.held[1]?.data.entries).toEqual({ d6: { qty: 2, unit: '', supplierId: '' } });
    p.releaseHeld();
    await settle();
  });

  it('a day stamp put back while the write is in the air goes out', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d7: { qty: 2, stock: 0 } }, { aldo: '2026-10-27' });
    p.days.aldo = DAY;
    const moving = p.saveNow();
    p.days.aldo = '2026-10-27';
    p.sync.change(p.entries, p.days);
    await p.pause();
    expect(p.held[1]?.data.days).toEqual({ aldo: '2026-10-27' });
    p.releaseHeld();
    await moving;
    await settle();
  });
});

// What the fix must NOT do: speak about a line it has no correction for.
describe('draftSync — a correction claims nothing it has no word on', () => {
  it('retyping the value in the air sends nothing more, after a correction inside the pause', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('d8', { qty: 5 });
    await p.pause();
    p.type('d8', { qty: 0 });
    p.type('d8', { qty: 5 });
    await p.pause();
    expect(p.held).toHaveLength(1);                  // the 5 is already on its way
    p.held[0]?.resolve();
    await settle();
  });

  it('a line placed while its write is in the air is not written again', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d9: { qty: 3, stock: 0 } }, { aldo: DAY });
    p.type('d9', { qty: 5 });
    p.days.aldo = '2026-10-29';
    p.sync.change(p.entries, p.days);
    await p.pause();
    // The store forgets the placed rows (forget), and the screen with them…
    p.apply(p.sync.forget(['d9'], ['aldo']));
    p.type('d9b', { qty: 1 });                       // …and another line is typed
    await p.pause();
    expect(keys(p.held[1]?.data.entries)).toEqual(['d9b']);   // never a blank row for the placed line
    expect(p.held[1]?.data.days).toBeUndefined();             // and never its day stamp
    p.releaseHeld();
    await settle();
  });

  it('a field the write in the air does not carry is not claimed: a colleague\'s count is not re-asserted', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d10: { qty: 3, stock: 1 } });
    p.type('d10', { qty: 5 });
    await p.pause();
    // Firestore shows this phone's 5 with a colleague's new shelf count on the same line.
    p.snapshot({ d10: { qty: 5, stock: 7, unit: '', supplierId: '' } });
    p.type('d10b', { qty: 1 });
    await p.pause();
    expect(keys(p.held[1]?.data.entries)).toEqual(['d10b']);
    p.releaseHeld();
    await settle();
  });
});

describe('draftSync — a correction and a refusal', () => {
  it('a correction outlives the refusal of the write it corrects', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d11: { qty: 3, stock: 0 } });
    p.type('d11', { qty: 5 });
    await p.pause();
    p.type('d11', { qty: 3 });
    p.held[0]?.reject(new Error('permission-denied'));
    await settle();
    expect(p.entries.d11?.qty).toBe(3);              // the refused 5 does not come back
    p.snapshot({ d11: { qty: 3, stock: 0 } });       // Firestore takes the write back
    expect(p.entries.d11?.qty).toBe(3);
    await p.pause();
    expect(p.held).toHaveLength(1);                  // the take-back shows the 3: nothing is owed
    p.snapshot({ d11: { qty: 3, stock: 0 } });
    expect(p.entries.d11?.qty).toBe(3);
  });

  it('refused, and the pause ends before the take-back: the 3 goes out, what the screen says', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d11b: { qty: 3, stock: 0 } });
    p.type('d11b', { qty: 5 });
    await p.pause();
    p.type('d11b', { qty: 3 });
    p.held[0]?.reject(new Error('permission-denied'));
    await settle();
    await p.pause();
    // The server never took the 5, so this repeats what it holds: the same exposure as any keystroke, pinned so that a change to
    // it is a decision.
    expect(p.held[1]?.data.entries).toEqual({ d11b: { qty: 3, unit: '', supplierId: '' } });
    p.held[1]?.resolve();
    await settle();
  });

  it('a refused write does not come back over a correction already on its way', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('d12', { qty: 5 });
    await p.pause();
    p.type('d12', { qty: 0 });
    await p.pause();
    p.type('d12b', { qty: 1 });                      // the 0 is on its way, so its claim is dropped
    p.held[0]?.reject(new Error('permission-denied'));
    await settle();
    p.snapshot({});                                  // Firestore takes the write back
    expect(Number(p.entries.d12?.qty ?? 0)).toBe(0); // the refused 5 stays off the screen
    await p.pause();
    expect(keys(p.held[2]?.data.entries)).toEqual(['d12b']);   // and out of the next write
    p.held.slice(1).forEach(write => write.resolve());
    await settle();
  });

  it('a refused day stamp does not come back over a newer one already on its way', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d19: { qty: 2, stock: 0 } }, { aldo: '2026-10-27' });
    p.days.aldo = DAY;
    const first = p.saveNow().catch(() => undefined);
    p.days.aldo = '2026-10-29';
    void p.saveNow();
    p.snapshot({ d19: { qty: 2, stock: 0 } }, { aldo: '2026-10-29' });   // Firestore shows the newer stamp
    p.type('d19b', { qty: 1 });                      // so the keystroke drops its claim
    p.held[0]?.reject(new Error('permission-denied'));
    await first;
    await settle();
    await p.pause();
    expect(p.held[2]?.data.days).toBeUndefined();    // the refused stamp stays out of the next write
    expect(p.days.aldo).toBe('2026-10-29');
    p.held.slice(1).forEach(write => write.resolve());
    await settle();
  });
});

// Changing one's mind twice: the first write lands, and its value is the one typed last.
describe('draftSync — changing one\'s mind twice', () => {
  it('5, 0, 5 again: the first 5 landing inside the pause does not stop the last 5 going out', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('d13', { qty: 5 });
    await p.pause();
    p.type('d13', { qty: 0 });
    await p.pause();
    p.type('d13', { qty: 5 });
    p.held[0]?.resolve();
    await settle();
    await p.pause();
    expect(p.held[2]?.data.entries).toEqual({ d13: { qty: 5, unit: '', supplierId: '' } });
    p.held.slice(1).forEach(write => write.resolve());
    await settle();
    expect(p.entries.d13?.qty).toBe(5);
    expect(p.held).toHaveLength(3);                  // and that is the end of it
  });

  it('5, 7, 5 again on a saved line ends at 5, not at the number in the middle', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d14: { qty: 3, stock: 0 } });
    p.type('d14', { qty: 5 });
    await p.pause();
    p.type('d14', { qty: 7 });
    await p.pause();
    p.type('d14', { qty: 5 });
    p.held[0]?.resolve();
    await settle();
    await p.pause();
    expect(p.held[2]?.data.entries).toEqual({ d14: { qty: 5, unit: '', supplierId: '' } });
    p.held.slice(1).forEach(write => write.resolve());
    await settle();
  });

  it('a shelf count 2, 1, 2 again ends at 2', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d15: { qty: 3, stock: 0 } });
    p.type('d15', { stock: 2 });
    await p.pause();
    p.type('d15', { stock: 1 });
    await p.pause();
    p.type('d15', { stock: 2 });
    p.held[0]?.resolve();
    await settle();
    await p.pause();
    expect(p.held[2]?.data.entries).toEqual({ d15: { stock: 2 } });
    p.held.slice(1).forEach(write => write.resolve());
    await settle();
  });

  it('a day stamp moved and moved back ends where it was last put', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d16: { qty: 2, stock: 0 } }, { aldo: '2026-10-27' });
    p.days.aldo = DAY;
    void p.saveNow();
    p.days.aldo = '2026-10-29';
    void p.saveNow();
    p.days.aldo = DAY;
    p.sync.change(p.entries, p.days);
    p.held[0]?.resolve();
    await settle();
    await p.pause();
    expect(p.held[2]?.data.days).toEqual({ aldo: DAY });
    p.held.slice(1).forEach(write => write.resolve());
    await settle();
  });

  it('with all three writes in the air, the first landing leaves the last one\'s claim standing', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({});
    p.type('d17', { qty: 5 });
    await p.pause();
    p.type('d17', { qty: 0 });
    await p.pause();
    p.type('d17', { qty: 5 });
    await p.pause();
    p.held[0]?.resolve();
    await settle();
    p.snapshot({ d17: { qty: 0, stock: 0 } });       // a snapshot showing the write in the middle
    expect(p.entries.d17?.qty).toBe(5);
    p.type('d17b', { qty: 1 });
    await p.pause();
    expect(keys(p.held[3]?.data.entries)).toEqual(['d17b']);   // the 5 is already on its way
    p.held.slice(1).forEach(write => write.resolve());
    await settle();
  });

  // `differences` claims what the screen holds, and a redraw gives a placed line a blank row back (entryFor): the next keystroke
  // writes it at zero. Wanted: a 5 landing after the clear would stay.
  it('a line placed while its write is in the air and then redrawn is written at zero', async () => {
    const p = newPage();
    p.holdSaves();
    p.snapshot({ d18: { qty: 3, stock: 0 } });
    p.type('d18', { qty: 5 });
    await p.pause();
    p.entries.d18 = { qty: 0, stock: 0 };
    p.type('d18b', { qty: 1 });
    await p.pause();
    expect(p.held[1]?.data.entries?.d18).toEqual({ qty: 0, unit: '', supplierId: '' });
    p.releaseHeld();
    await settle();
  });
});
