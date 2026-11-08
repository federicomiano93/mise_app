// A quantity typed on Orders, and the page gone before Firestore's queue had it (parity F-15): the port of the journal cases of
// tests/draft-journal.test.mjs.
//
// Measured on the lab tablet (1 Nov 2026): a reload up to 4.5 s after typing on a freshly opened page lost the number for good.
// draftSync.ts runs for real; a fresh createDraftSync over the same `world` (storage, clock, the server's orders) stands for the
// next page (nothing in memory). The other half of every test here is the danger of the cure: a note that outlives the page must
// never put back a quantity somebody has dealt with in the meantime.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_JOURNAL_KEY, DRAFT_JOURNAL_MAX_AGE_MS, historyLookBackDay } from '@mise/shared/draft-journal';
import { newPage, newWorld, settle } from '../testing/draftHarness';
import type { Page, World } from '../testing/draftHarness';

const DAY = '2026-11-01';

let world: World;
beforeEach(() => {
  world = newWorld();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

// One open of the page: what the store's start() and the first snapshot (the browser's own copy) do.
function openPage(entries: Record<string, unknown> | null = {}, days: Record<string, string> = {}): Page {
  const page = newPage({ world, day: DAY });
  page.sync.open();
  if (entries !== null) page.snapshot(entries, days);
  return page;
}
const note = () => JSON.parse(world.storage.read(DRAFT_JOURNAL_KEY) ?? 'null');
const stored = () => world.storage.read(DRAFT_JOURNAL_KEY);
const placedAt = (when: number, quantities: Record<string, number>) => ({ sends: { s1: { at: new Date(when).toISOString(), quantities } } });
const qty = (n: number) => ({ qty: n, unit: '', supplierId: '' });
const sentEntries = (page: Page) => page.sent.map(({ entries }) => entries);

describe('the draft journal — the note and the next open', () => {
  it('the number is noted in the same keystroke, before any write', () => {
    const page = openPage();
    page.type('flour', { qty: 5 }, 'sup1');
    expect(page.sent).toEqual([]);                   // still in the pause
    expect(note().entries.flour).toEqual({ row: qty(5), base: qty(0) });
    expect(note().days.sup1).toEqual({ day: DAY, base: '' });
    expect(note().lid).toBe('venue-a');
  });

  it('page gone after typing: the number comes back and is sent once the server has answered', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 }, 'sup1');
    // No pause: the page is gone before anything left it.

    const second = openPage();
    expect(second.entries.flour).toBeUndefined();    // not on the word of the local copy
    await second.pause();
    expect(second.sent).toEqual([]);                 // and nothing is sent on it
    expect(note().entries.flour).toBeDefined();      // still noted while the server has not answered

    await second.answer({});
    expect(second.entries.flour?.qty).toBe(5);       // back on screen
    expect(second.days.sup1).toBe(DAY);
    await second.pause();
    expect(second.sent.map(({ entries, days }) => ({ entries, days }))).toEqual([{ entries: { flour: qty(5) }, days: { sup1: DAY } }]);

    // Once saved the note is gone, and a third page brings nothing back.
    expect(stored()).toBeNull();
    const reads = world.history.reads;
    const third = openPage({ flour: { qty: 5, stock: 0 } }, { sup1: DAY });
    await third.answer({ flour: { qty: 5, stock: 0 } }, { sup1: DAY });
    expect(world.history.reads).toBe(reads);         // nothing to ask the server about
  });

  it('offline: the note waits, across as many opens as it takes', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    openPage();
    openPage();                                      // no answer yet, a further reload
    expect(note().entries.flour).toBeDefined();      // the unanswered note is not lost by reopening
    const last = openPage();
    await last.answer({});
    expect(last.entries.flour?.qty).toBe(5);
  });

  it('the server already holds it (the write did get through): nothing is sent again', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage({ flour: { qty: 5, stock: 0 } });
    await second.answer({ flour: { qty: 5, stock: 0 } });
    await second.pause();
    expect(second.sent).toEqual([]);
    expect(second.entries.flour?.qty).toBe(5);
    expect(stored()).toBeNull();
  });

  it('a colleague changed the line meanwhile: their number stays, this one is dropped', async () => {
    const first = openPage({ flour: { qty: 3, stock: 0 } });
    first.type('flour', { qty: 5 });
    const second = openPage({ flour: { qty: 3, stock: 0 } });   // the old local copy
    await second.answer({ flour: { qty: 7, stock: 0 } });
    await second.pause();
    expect(second.sent).toEqual([]);                 // never written over the colleague
    expect(second.entries.flour?.qty).toBe(7);
    expect(stored()).toBeNull();
  });

  it('⚠️ a colleague placed the order meanwhile: the old quantity does not come back', async () => {
    // The line held 3 when 5 was typed; placing cleared it. The local copy here still says 3, so only the server's answer can
    // tell: this is the double order the whole check is there to stop.
    const first = openPage({ flour: { qty: 3, stock: 0 } }, { sup1: DAY });
    first.type('flour', { qty: 5 });
    const second = openPage({ flour: { qty: 3, stock: 0 } }, { sup1: DAY });
    await second.answer({});
    await second.pause();
    expect(second.sent).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
  });

  it('⚠️ the line was empty, a colleague filled it and placed it: it reads as before, and the orders tell', async () => {
    // The hole «still reads like the base» cannot see: placing empties a line, and most lines start empty.
    const first = openPage();
    first.type('flour', { qty: 5 }, 'sup1');
    first.type('salt', { qty: 2 });
    const second = openPage();
    world.history.records = [placedAt(world.clock.now + 60000, { flour: 6 })];
    await second.answer({});
    expect(second.entries.flour).toBeUndefined();    // already ordered: it stays out
    expect(second.entries.salt?.qty).toBe(2);        // a line no order has named comes back
    await second.pause();
    expect(second.sent[0]?.entries).toEqual({ salt: qty(2) });
  });

  it('the note was for a write that did get through and was then placed: not ordered twice', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    world.history.records = [placedAt(world.clock.now + 60000, { flour: 5 })];
    await second.answer({});
    await second.pause();
    expect(second.sent).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
    expect(stored()).toBeNull();
  });

  it('an order of that line from BEFORE the typing does not stop it coming back', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    world.history.records = [placedAt(world.clock.now - 60 * 60 * 1000, { flour: 3 })];
    await second.answer({});
    expect(second.entries.flour?.qty).toBe(5);
  });

  it('the orders are asked from a week before the note, from the server', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const typedAt = note().at;
    const second = openPage();
    await second.answer({});
    expect(world.history.asked).toEqual([historyLookBackDay(typedAt)]);
  });

  it('an order stops the quantity, not the shelf count typed on the same line', async () => {
    const first = openPage();
    first.type('flour', { qty: 5, stock: 4 });
    const second = openPage();
    world.history.records = [placedAt(world.clock.now + 60000, { flour: 6 })];
    await second.answer({});
    await second.pause();
    expect(second.sent[0]?.entries).toEqual({ flour: { stock: 4 } });
    expect(second.entries.flour?.stock).toBe(4);
  });

  it('the orders cannot be read: nothing comes back, the note waits, and it asks again', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    world.history.fail = true;
    await second.answer({});
    expect(second.entries.flour).toBeUndefined();
    expect(note().entries.flour).toBeDefined();      // still noted
    await second.pause();
    expect(second.sent).toEqual([]);
    await second.retry();
    expect(world.history.reads).toBe(2);             // and still refused
    world.history.fail = false;
    await second.retry();
    expect(second.entries.flour?.qty).toBe(5);       // the page stayed open and it came back
  });

  it('a note that waited offline past its day does not come back when the server finally answers', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const typedAt = note().at;
    const second = openPage();
    world.clock.now = typedAt + DRAFT_JOURNAL_MAX_AGE_MS + 1;
    await second.answer({});
    expect(second.entries.flour).toBeUndefined();
    expect(stored()).toBeNull();
    await second.pause();
    expect(second.sent).toEqual([]);
  });

  it('a future day stamp does not outlive its dropped line through another line coming back', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 }, 'sup1');
    first.type('salt', { qty: 2 }, 'sup2');
    const second = openPage();
    world.history.records = [placedAt(world.clock.now + 60000, { flour: 6 })];
    await second.answer({});
    await second.pause();
    expect(second.sent[0]?.entries).toEqual({ salt: qty(2) });
    expect(second.sent[0]?.days).toBeUndefined();
    expect(second.days).toEqual({});
  });

  it('a shelf count alone does not bring a day stamp back', async () => {
    const first = openPage();
    first.type('flour', { qty: 5, stock: 4 }, 'sup1');
    const second = openPage();
    world.history.records = [placedAt(world.clock.now + 60000, { flour: 6 })];
    await second.answer({});
    await second.pause();
    expect(second.sent[0]?.days).toBeUndefined();
  });

  it('the very first keystroke of a page takes that line out of what the last page left', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const page = openPage(null);                     // before any snapshot
    page.type('flour', { qty: 8 });
    page.entries.flour = { qty: 0, stock: 0 };       // and erased
    page.sync.change(page.entries, page.days);
    await page.answer({});
    expect(page.entries.flour).toBeUndefined();      // what was erased does not come back
  });

  it('nothing to bring back: the orders are not read', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    await second.answer({ flour: { qty: 5, stock: 0 } });
    expect(world.history.reads).toBe(0);
  });

  it('the page is told a line came back, so it can ask its «never placed» question again', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    expect(second.cameBack).toBe(0);
    await second.answer({});
    expect(second.cameBack).toBe(1);
  });

  it('nothing came back: the page is not told', async () => {
    const first = openPage({ flour: { qty: 3, stock: 0 } });
    first.type('flour', { qty: 5 });
    const second = openPage({ flour: { qty: 3, stock: 0 } });
    await second.answer({ flour: { qty: 7, stock: 0 } });
    expect(second.cameBack).toBe(0);
  });

  it('a row typed after the line came back is still saved: the screen does not share the baseline', async () => {
    const here = { salt: { qty: 1, stock: 0 } };
    const first = openPage(here);
    first.type('flour', { qty: 5 });
    const second = openPage(here);
    await second.answer(here);
    await second.pause();
    second.sent.length = 0;
    second.type('salt', { qty: 2 });
    await second.pause();
    expect(second.sent[0]?.entries?.salt?.qty).toBe(2);
  });

  it('typed before the draft has landed: noted too, with its time', () => {
    const page = openPage(null);                     // no snapshot yet
    page.type('flour', { qty: 5 });
    expect(note().entries.flour).toBeDefined();
    expect(note().at).toBeGreaterThan(0);            // a note dated 1970 would be thrown away as expired
  });

  it('what the last page left keeps its own age, whatever is typed meanwhile', () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const typedAt = note().at;
    const second = openPage();
    world.clock.now = typedAt + 60 * 60 * 1000;
    second.type('salt', { qty: 2 });
    expect(note().at).toBe(typedAt);
  });

  it('a clear still in the air wins over the server\'s answer', async () => {
    // A weak connection: the first answer arrives between the clear leaving and landing. The store forgets the lines first.
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    second.apply(second.sync.forget(['flour'], ['sup1'], { quantitiesOnly: true }));
    await second.answer({});
    expect(second.entries.flour).toBeUndefined();    // it does not come back over the clear
    await second.pause();
    expect(second.sent).toEqual([]);
  });

  it('a stock count from a colleague says nothing about the quantity typed here', async () => {
    const first = openPage({ flour: { qty: 0, stock: 1 } });
    first.type('flour', { qty: 5 });
    const second = openPage({ flour: { qty: 0, stock: 1 } });
    await second.answer({ flour: { qty: 0, stock: 9 } });
    expect(second.entries.flour?.qty).toBe(5);
    await second.pause();
    expect(second.sent[0]?.entries).toEqual({ flour: qty(5) });   // the stock is not sent
  });

  it('a day stamp does not come back without its lines', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 }, 'sup1');
    const second = openPage();
    await second.answer({ flour: { qty: 7, stock: 0 } });
    await second.pause();
    expect(second.sent).toEqual([]);
  });

  it('typed again on the new page before the server answered: the new number wins', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    second.type('flour', { qty: 8 });
    expect(note().entries.flour.row.qty).toBe(8);
    // And even corrected back to nothing: what was typed here is the last word on that line.
    second.entries.flour = { qty: 0, stock: 0 };
    second.sync.change(second.entries, second.days);
    await second.answer({});
    await second.pause();
    expect(second.sent).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
  });

  it('another line typed on the new page does not lose the note, and both go', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    second.type('salt', { qty: 2 });
    expect(note().entries.flour).toBeDefined();      // still noted
    expect(note().entries.salt).toBeDefined();
    await second.answer({});
    await second.pause();
    expect(second.sent.at(-1)?.entries?.flour?.qty).toBe(5);
    expect(second.sent.flatMap(call => Object.keys(call.entries ?? {})).includes('salt')).toBe(true);
  });

  it('«clear» on the new page before the server answered wins over the note', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    second.apply(second.sync.forget(['flour'], ['sup1'], { quantitiesOnly: true }));
    expect(stored()).toBeNull();
    await second.answer({});
    await second.pause();
    expect(second.sent).toEqual([]);
  });

  it('a placed order forgets the whole line from the note too, stock included', async () => {
    const first = openPage();
    first.type('flour', { qty: 5, stock: 4 }, 'sup1');
    const second = openPage();
    second.apply(second.sync.forget(['flour'], ['sup1']));
    expect(stored()).toBeNull();
    await second.answer({});
    expect(second.entries.flour).toBeUndefined();
  });

  it('Clear quantities keeps the stock reading in the note', async () => {
    const first = openPage();
    first.type('flour', { qty: 5, stock: 4 }, 'sup1');
    const second = openPage();
    second.apply(second.sync.forget(['flour'], ['sup1'], { quantitiesOnly: true }));
    expect(note().entries.flour.row).toEqual({ stock: 4 });
  });

  it('once a snapshot shows the write it is in Firestore\'s queue, and the note lets it go', async () => {
    const page = openPage();
    page.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    expect(note().entries.flour).toBeDefined();      // sent, but not yet in the queue
    page.snapshot({ flour: { qty: 5, stock: 0 } });  // Firestore shows it, the server has not answered
    expect(stored()).toBeNull();
    page.held[0]?.resolve();
    await settle();
  });

  it('a line typed over while a write is in the air notes the new number against what it knows', async () => {
    const page = openPage();
    page.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    page.snapshot({ flour: { qty: 5, stock: 0 } });
    page.type('flour', { qty: 6 });
    expect(note().entries.flour).toEqual({ row: qty(6), base: qty(5) });
    page.held[0]?.resolve();
    await settle();
  });
});

// ── A correction made while its write is in the air, and the page gone before the correction left ──
//
// The write in the air may or may not have reached Firestore's queue: on the next open it either lands or never existed, and
// nothing on this page can know which. Both have to come out right.
describe('the draft journal — a correction in the air', () => {
  // Typed `first`, sent, corrected to `second` with no snapshot in between, page gone in that instant.
  async function correctedThenGone(start: Record<string, unknown>, first: number, second: number, field = 'qty'): Promise<Page> {
    const page = openPage(start);
    page.holdSaves();
    page.type('flour', { [field]: first });
    await page.pause();
    expect(page.sent).toHaveLength(1);               // the first write has gone
    page.type('flour', { [field]: second });
    page.letSavesThrough();
    return page;
  }

  it('⚠️ 5 put back to 0, page gone, the 5 was in the queue: the 0 goes out and the 5 does not come back', async () => {
    await correctedThenGone({}, 5, 0);
    const landed = { flour: { qty: 5, stock: 0 } };
    const second = openPage(landed);                 // Firestore shows its own queue on the next page
    await second.answer(landed);
    expect(second.entries.flour?.qty).toBe(0);       // the screen says what was last typed
    await second.pause();
    expect(sentEntries(second)).toEqual([{ flour: qty(0) }]);
    expect(stored()).toBeNull();                     // and the note is done
  });

  it('5 put back to 0, page gone, the 5 never reached the queue: nothing to write', async () => {
    await correctedThenGone({}, 5, 0);
    const second = openPage();
    await second.answer({});
    await second.pause();
    expect(second.sent).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
    expect(stored()).toBeNull();
  });

  it('a saved 3: 5 put back to 3, page gone, the 5 was in the queue: the 3 goes out', async () => {
    await correctedThenGone({ flour: { qty: 3, stock: 0 } }, 5, 3);
    const landed = { flour: { qty: 5, stock: 0 } };
    const second = openPage(landed);
    await second.answer(landed);
    await second.pause();
    expect(second.entries.flour?.qty).toBe(3);
    expect(sentEntries(second)).toEqual([{ flour: qty(3) }]);
  });

  it('5 corrected to 7, page gone: the 7 wins whether or not the 5 was in the queue', async () => {
    await correctedThenGone({}, 5, 7);
    const landed = { flour: { qty: 5, stock: 0 } };
    const inQueue = openPage(landed);
    await inQueue.answer(landed);
    expect(inQueue.entries.flour?.qty).toBe(7);      // the 5 landed
    await inQueue.pause();
    expect(sentEntries(inQueue)).toEqual([{ flour: qty(7) }]);

    world = newWorld();
    await correctedThenGone({}, 5, 7);
    const notInQueue = openPage();
    await notInQueue.answer({});
    expect(notInQueue.entries.flour?.qty).toBe(7);   // the 5 never existed
    await notInQueue.pause();
    expect(sentEntries(notInQueue)).toEqual([{ flour: qty(7) }]);
  });

  it('a stock count corrected back, page gone, the first one in the queue: only the stock goes out', async () => {
    await correctedThenGone({ flour: { qty: 3, stock: 0 } }, 2, 0, 'stock');
    const landed = { flour: { qty: 3, stock: 2 } };
    const second = openPage(landed);
    await second.answer(landed);
    await second.pause();
    expect(second.entries.flour?.stock).toBe(0);
    expect(sentEntries(second)).toEqual([{ flour: { stock: 0 } }]);
  });

  it('corrected in the air, then a colleague wrote the line: their number stays', async () => {
    await correctedThenGone({}, 5, 0);
    const theirs = { flour: { qty: 9, stock: 0 } };
    const second = openPage(theirs);
    await second.answer(theirs);
    await second.pause();
    expect(second.sent).toEqual([]);
    expect(second.entries.flour?.qty).toBe(9);
  });

  it('⚠️ corrected in the air, then the order was placed: the correction does not come back', async () => {
    await correctedThenGone({}, 5, 7);
    world.history.records = [placedAt(world.clock.now + 60000, { flour: 5 })];
    const second = openPage();
    await second.answer({});
    await second.pause();
    expect(second.sent).toEqual([]);                 // never a second order
    expect(second.entries.flour).toBeUndefined();
  });

  it('a correction that waited offline through another open still counts the write it corrected', async () => {
    await correctedThenGone({}, 5, 0);
    openPage();                                      // no answer from the server: the note is written again
    const landed = { flour: { qty: 5, stock: 0 } };
    const third = openPage(landed);
    await third.answer(landed);
    expect(third.entries.flour?.qty).toBe(0);
    await third.pause();
    expect(sentEntries(third)).toEqual([{ flour: qty(0) }]);
  });

  it('typed on the new page: the old write in the air no longer speaks for that line', async () => {
    const first = openPage();
    first.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.type('flour', { qty: 0, stock: 4 });
    first.letSavesThrough();
    const second = openPage();                       // the shelf count stays in the note, the 5 must not
    second.type('flour', { qty: 8 });
    expect('air' in note().entries.flour).toBe(false);
  });

  it('the 5 landed inside the pause of its correction, page gone: the 0 goes out', async () => {
    const first = openPage();
    first.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.type('flour', { qty: 0 });
    first.held[0]?.resolve();
    await settle();
    first.letSavesThrough();
    const landed = { flour: { qty: 5, stock: 0 } };
    const second = openPage(landed);
    await second.answer(landed);
    await second.pause();
    expect(sentEntries(second)).toEqual([{ flour: qty(0) }]);
  });

  it('a correction that turned out to need nothing does not cost another line its day stamp', async () => {
    const first = openPage();
    first.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.type('flour', { qty: 0 });
    first.type('salt', { qty: 2 }, 'sup1');
    first.letSavesThrough();
    const second = openPage();                       // the 5 never reached the queue
    await second.answer({});
    await second.pause();
    expect(second.sent[0]?.entries).toEqual({ salt: qty(2) });
    expect(second.sent[0]?.days).toEqual({ sup1: DAY });
    expect(second.days.sup1).toBe(DAY);
  });

  it('⚠️ a correction on a line a colleague has since ordered still keeps the day stamps out', async () => {
    const first = openPage();
    first.holdSaves();
    first.type('flour', { qty: 5 }, 'sup1');
    await first.pause();
    first.type('flour', { qty: 0 });
    first.type('salt', { qty: 2 }, 'sup2');
    first.letSavesThrough();
    // Placing empties the line too, so it reads just as the correction wanted: only the orders tell.
    world.history.records = [placedAt(world.clock.now + 60000, { flour: 5 })];
    const second = openPage();
    await second.answer({});
    await second.pause();
    expect(second.sent[0]?.entries).toEqual({ salt: qty(2) });
    expect(second.sent[0]?.days).toBeUndefined();    // sup1's next order must not be dated by a stamp left behind
  });

  it('the note keeps the write in the air only when it says something else', async () => {
    const page = openPage();
    page.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    expect('air' in note().entries.flour).toBe(false);   // the claim is the write in the air
    page.type('flour', { qty: 0 });
    expect(note().entries.flour).toEqual({ row: qty(0), base: qty(0), air: [qty(5)] });
    // Both writes land: nothing is left to remember.
    await page.pause();
    page.held[0]?.resolve();
    await settle();
    page.held[1]?.resolve();
    await settle();
    expect(stored()).toBeNull();
  });
});

describe('the draft journal — a refused write, and a blocked storage', () => {
  it('a write the server refused is not noted: it could never be saved, and would block every later one', async () => {
    const page = openPage();
    page.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    page.held[0]?.reject(new Error('permission-denied'));
    await settle();
    expect(stored()).toBeNull();                     // not noted
    expect(page.entries.flour?.qty).toBe(5);         // still on screen, as before

    // A different number is new typing: noted.
    page.type('flour', { qty: 6 });
    expect(note().entries.flour.row.qty).toBe(6);
    // The next open has nothing to replay from the refused one.
    const second = openPage();
    await second.answer({});
    expect(second.entries.flour?.qty).toBe(6);
  });

  it('a blocked or full storage never stops the typing', async () => {
    world.active = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('quota'); },
      removeItem() { throw new Error('blocked'); },
    };
    const page = openPage();
    page.type('flour', { qty: 5 });
    await page.pause();
    expect(page.sent[0]?.entries?.flour?.qty).toBe(5);
  });

  it('no storage at all: the same', async () => {
    world.active = null;
    const page = openPage();
    page.type('flour', { qty: 5 });
    await page.pause();
    expect(page.sent[0]?.entries?.flour?.qty).toBe(5);
  });
});

// ── ONE WRITER OF THE NOTE ──
//
// The current app is one page = one module. Mise 2 makes a new sync each time the Orders section mounts, while the previous,
// stopped one may still have a write in the air.
describe('the draft journal — one writer of the note', () => {
  it('⚠️ the stopped section\'s write lands after the next one opened: the new note is not overwritten', async () => {
    const a = openPage();
    a.holdSaves();
    a.type('flour', { qty: 5 });
    await a.pause();                                 // in the air
    a.sync.close();                                  // the section is left…
    const b = openPage();                            // …and opened again: it reads A's note
    const before = stored();
    expect(before).not.toBeNull();
    a.held[0]?.resolve();                            // A's write lands: it would release the line and empty the note
    await settle();
    expect(stored()).toBe(before);
    // B still brings the line back once the server has answered.
    await b.answer({});
    expect(b.entries.flour?.qty).toBe(5);
  });

  it('a stopped section keeps noting its own writes until another one opens', async () => {
    const a = openPage();
    a.holdSaves();
    a.type('flour', { qty: 5 });
    await a.pause();
    a.type('flour', { qty: 0 });                     // a correction left in the air by the section just left
    await a.pause();
    a.sync.close();
    expect(note().entries.flour.air).toEqual([qty(5)]);
    a.held[0]?.resolve();
    a.held[1]?.resolve();
    await settle();
    expect(stored()).toBeNull();                     // it was still the writer
  });

  it('a stopped section judges no note: its snapshots have stopped, so what it knows is old', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    second.sync.close();
    await second.answer({});
    expect(second.entries.flour).toBeUndefined();
    expect(note().entries.flour).toBeDefined();      // the note stays for the next open
  });

  it('opened again (a restart of the same section): the note is not read twice', async () => {
    const first = openPage();
    first.type('flour', { qty: 5 });
    const second = openPage();
    second.sync.close();
    second.sync.open();
    await second.answer({});
    expect(second.entries.flour?.qty).toBe(5);
  });
});
