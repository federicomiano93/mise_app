// A quantity typed on Orders, and the page gone before Firestore's queue had it (F-15 in docs/parity/orders.md).
//
// Measured on the lab tablet in the current app (1 Nov 2026): a reload up to 4.5 s after typing on a freshly opened page
// lost the number for good. Here the sync runs for real; a fresh sync over the same storage stands for the next page
// (nothing in memory), localStorage is a plain fake, and the server is a recording fake: its writes can be held in the
// air, its orders can be refused. The other half of every case is the danger of the cure: a note that outlives the page
// must never put back a quantity somebody has dealt with in the meantime.
//
// PORTED: the cases of tests/draft-journal.test.mjs that drive the draft, the «correction in the air» block included.
// ELSEWHERE: the note's own reading and writing, its age and its venue (shared/src/draft-journal.spec.ts, both files);
// the page going out of sight and a deleted product's line (ordersStore.journal.spec.ts, pageHidden.spec.ts).

import { describe, expect, it, vi } from 'vitest';
import { DRAFT_JOURNAL_KEY, DRAFT_JOURNAL_MAX_AGE_MS } from '@mise/shared/draft-journal';
import { createDraftSync, ORDERS_RETRY_MS } from './draftSync';
import type { DraftEntry, DraftPayload, DraftView } from './draftSync';

const VENUE = 'venue-a';
const DAY = '2026-11-01';
const START = Date.parse('2026-11-01T10:00:00Z');

type Doc = { entries: Record<string, DraftEntry>; days: Record<string, string>; updatedAt: string };
const server = (entries: Record<string, DraftEntry> = {}, days: Record<string, string> = {}): Doc => ({ entries, days, updatedAt: 'x' });
const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

// One device across several opens of the page: its storage, the server's orders, the writes it sent.
function device() {
  const storage = fakeStorage();
  const clock = { now: START };
  const history = { records: [] as unknown[], fail: false, reads: 0 };
  const saves: DraftPayload[] = [];
  const held: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  const retries: Array<() => void> = [];
  let hold = false;

  // One open of the page: the store's copy of the draft, rebuilt from what the sync returns.
  function openPage(doc: Doc | null = server()) {
    let timer: (() => void) | null = null;
    const page = { entries: {} as Record<string, DraftEntry>, days: {} as Record<string, string>, cameBack: 0 };
    const draw = (view: DraftView) => {
      page.entries = structuredClone({ ...view.entries }) as Record<string, DraftEntry>;
      page.days = { ...view.days };
    };
    const sync = createDraftSync({
      save: payload => {
        saves.push(payload);
        if (hold) return new Promise<void>((resolve, reject) => { held.push({ resolve, reject }); });
        return Promise.resolve();
      },
      nowIso: () => new Date(clock.now).toISOString(),
      setTimer: run => { timer = run; return 1; },
      clearTimer: () => { timer = null; },
      onResult: () => undefined,
      journal: {
        venue: VENUE,
        storage: () => storage,
        now: () => clock.now,
        ordersSince: async () => {
          history.reads += 1;
          if (history.fail) throw new Error('unavailable');
          return history.records;
        },
        retryLater: run => { retries.push(run); },
        onCameBack: view => { draw(view); page.cameBack += 1; },
      },
    });
    const self = {
      sync,
      get entries() { return page.entries; },
      get days() { return page.days; },
      get cameBack() { return page.cameBack; },
      // A snapshot of drafts/current; `fromServer` when the SERVER sent it.
      snapshot(next: Doc | null, fromServer = false) { draw(sync.receive(structuredClone(next), fromServer)); },
      type(id: string, patch: DraftEntry, stamp?: string) {
        page.entries[id] = { qty: 0, stock: 0, ...page.entries[id], ...patch };
        if (stamp) page.days[stamp] = DAY;
        sync.change(page.entries, page.days);
      },
      async pause() {
        const run = timer;
        timer = null;
        run?.();
        await settle();
      },
      // The server's first word: the store hands it over as one snapshot with `fromServer`.
      async answer(next: Doc | null) {
        self.snapshot(next, true);
        await settle();
        await settle();
      },
      forget(ids: string[], suppliers: string[], quantitiesOnly = false) { draw(sync.forget(ids, suppliers, { quantitiesOnly })); },
    };
    if (doc !== null) self.snapshot(doc); // the phone's own copy answers first
    return self;
  }

  return {
    openPage, storage, clock, history, saves, held, retries,
    sent: () => saves.map(({ entries, days }) => (days ? { entries, days } : { entries })),
    note: () => JSON.parse(storage.getItem(DRAFT_JOURNAL_KEY) ?? 'null') as {
      lid: string; at: number; entries: Record<string, { row: DraftEntry; base: DraftEntry; air?: DraftEntry[] }>;
      days: Record<string, { day: string; base: string }>;
    },
    noted: () => storage.getItem(DRAFT_JOURNAL_KEY) !== null,
    holdSaves: () => { hold = true; },
    letSavesThrough: () => { hold = false; },
    forgetSends: () => { saves.length = 0; },
    placedAt: (when: number, quantities: Record<string, number>) => ({ sends: { s1: { at: new Date(when).toISOString(), quantities } } }),
  };
}

const QTY = (qty: number) => ({ qty, unit: '', supplierId: '' });

describe('draft journal — the note and its return', () => {
  it('the number is noted in the same keystroke, before any write', () => {
    const d = device();
    const page = d.openPage();
    page.type('flour', { qty: 5 }, 'sup1');
    expect(d.saves).toEqual([]); // still in the pause
    expect(d.note().entries.flour).toEqual({ row: QTY(5), base: QTY(0) });
    expect(d.note().days.sup1).toEqual({ day: DAY, base: '' });
    expect(d.note().lid).toBe(VENUE);
  });

  it('page gone after typing: the number comes back and is sent once the server has answered', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 }, 'sup1');
    // No pause: the page is gone before anything left it.

    const second = d.openPage();
    expect(second.entries.flour).toBeUndefined(); // not on the word of the local copy
    await second.pause();
    expect(d.saves).toEqual([]); // and nothing is sent on it
    expect(d.note().entries.flour).toBeDefined(); // still noted while the server has not answered

    await second.answer(server());
    expect(second.entries.flour?.qty).toBe(5); // back on screen
    expect(second.days.sup1).toBe(DAY);
    expect(second.cameBack).toBe(1); // the section can look again for orders never placed
    await second.pause();
    expect(d.sent()).toEqual([{ entries: { flour: QTY(5) }, days: { sup1: DAY } }]);

    // Once saved the note is gone, and a third page brings nothing back.
    expect(d.noted()).toBe(false);
    const reads = d.history.reads;
    const third = d.openPage(server({ flour: { qty: 5, stock: 0 } }, { sup1: DAY }));
    await third.answer(server({ flour: { qty: 5, stock: 0 } }, { sup1: DAY }));
    expect(d.history.reads).toBe(reads); // nothing to ask the server about
    expect(third.cameBack).toBe(0);
  });

  it('offline: the note waits, across as many opens as it takes', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    d.openPage();
    d.openPage(); // no answer yet, a further reload
    expect(d.note().entries.flour).toBeDefined();
    const last = d.openPage();
    await last.answer(server());
    expect(last.entries.flour?.qty).toBe(5);
  });

  it('the server already holds it (the write did get through): nothing is sent again', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage(server({ flour: { qty: 5, stock: 0 } }));
    await second.answer(server({ flour: { qty: 5, stock: 0 } }));
    await second.pause();
    expect(d.saves).toEqual([]);
    expect(second.entries.flour?.qty).toBe(5);
    expect(d.noted()).toBe(false);
  });

  it('a colleague changed the line meanwhile: their number stays, this one is dropped', async () => {
    const d = device();
    d.openPage(server({ flour: { qty: 3, stock: 0 } })).type('flour', { qty: 5 });
    const second = d.openPage(server({ flour: { qty: 3, stock: 0 } })); // the old local copy
    await second.answer(server({ flour: { qty: 7, stock: 0 } }));
    await second.pause();
    expect(d.saves).toEqual([]); // never written over the colleague
    expect(second.entries.flour?.qty).toBe(7);
    expect(d.noted()).toBe(false);
  });

  it('⚠️ a colleague placed the order meanwhile: the old quantity does not come back', async () => {
    // The line held 3 when 5 was typed; placing cleared it. The local copy here still says 3, so only the server's answer can
    // tell: this is the double order the whole check is there to stop.
    const d = device();
    d.openPage(server({ flour: { qty: 3, stock: 0 } }, { sup1: DAY })).type('flour', { qty: 5 });
    const second = d.openPage(server({ flour: { qty: 3, stock: 0 } }, { sup1: DAY }));
    await second.answer(server());
    await second.pause();
    expect(d.saves).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
  });

  it('⚠️ the line was empty, a colleague filled it and placed it: it reads as before, and the orders tell', async () => {
    const d = device();
    const first = d.openPage();
    first.type('flour', { qty: 5 }, 'sup1');
    first.type('salt', { qty: 2 });
    const second = d.openPage();
    d.history.records = [d.placedAt(START + 60_000, { flour: 6 })];
    await second.answer(server());
    expect(second.entries.flour).toBeUndefined(); // already ordered: it stays out
    expect(second.entries.salt?.qty).toBe(2); // a line no order has named comes back
    await second.pause();
    expect(d.saves[0]?.entries).toEqual({ salt: QTY(2) });
  });

  it('the note was for a write that did get through and was then placed: not ordered twice', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage();
    d.history.records = [d.placedAt(START + 60_000, { flour: 5 })];
    await second.answer(server());
    await second.pause();
    expect(d.saves).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
    expect(d.noted()).toBe(false);
  });

  it('an order of that line from BEFORE the typing does not stop it coming back', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage();
    d.history.records = [d.placedAt(START - 60 * 60 * 1000, { flour: 3 })];
    await second.answer(server());
    expect(second.entries.flour?.qty).toBe(5);
  });

  it('an order stops the quantity, not the shelf count typed on the same line', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5, stock: 4 });
    const second = d.openPage();
    d.history.records = [d.placedAt(START + 60_000, { flour: 6 })];
    await second.answer(server());
    await second.pause();
    expect(d.saves[0]?.entries).toEqual({ flour: { stock: 4 } });
    expect(second.entries.flour?.stock).toBe(4);
  });

  it('the orders cannot be read: nothing comes back, the note waits, and it asks again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage();
    d.history.fail = true;
    await second.answer(server());
    expect(second.entries.flour).toBeUndefined();
    expect(d.note().entries.flour).toBeDefined(); // still noted
    await second.pause();
    expect(d.saves).toEqual([]);
    expect(d.retries).toHaveLength(1);
    d.retries.shift()?.();
    await settle();
    expect(d.history.reads).toBe(2); // and still refused
    d.history.fail = false;
    d.retries.shift()?.();
    await settle();
    await settle();
    errors.mockRestore();
    expect(second.entries.flour?.qty).toBe(5); // the page stayed open and it came back
    expect(ORDERS_RETRY_MS).toBe(30_000);
  });

  it('a note that waited offline past its day does not come back when the server finally answers', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const typedAt = d.note().at;
    const second = d.openPage();
    d.clock.now = typedAt + DRAFT_JOURNAL_MAX_AGE_MS + 1;
    await second.answer(server());
    expect(second.entries.flour).toBeUndefined();
    expect(d.noted()).toBe(false);
    await second.pause();
    expect(d.saves).toEqual([]);
  });

  it('a future day stamp does not outlive its dropped line through another line coming back', async () => {
    const d = device();
    const first = d.openPage();
    first.type('flour', { qty: 5 }, 'sup1');
    first.type('salt', { qty: 2 }, 'sup2');
    const second = d.openPage();
    d.history.records = [d.placedAt(START + 60_000, { flour: 6 })];
    await second.answer(server());
    await second.pause();
    expect(d.saves[0]?.entries).toEqual({ salt: QTY(2) });
    expect(d.saves[0]?.days).toBeUndefined();
    expect(second.days).toEqual({});
  });

  it('a shelf count alone does not bring a day stamp back', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5, stock: 4 }, 'sup1');
    const second = d.openPage();
    d.history.records = [d.placedAt(START + 60_000, { flour: 6 })];
    await second.answer(server());
    await second.pause();
    expect(d.saves[0]?.days).toBeUndefined();
  });

  it('the very first keystroke of a page takes that line out of what the last page left', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const page = d.openPage(null); // no snapshot yet
    page.type('flour', { qty: 8 });
    page.type('flour', { qty: 0 }); // and erased
    await page.answer(server());
    expect(page.entries.flour?.qty ?? 0).toBe(0); // what was erased does not come back
    expect(page.cameBack).toBe(0);
  });

  it('nothing to bring back: the orders are not read', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage();
    await second.answer(server({ flour: { qty: 5, stock: 0 } }));
    expect(d.history.reads).toBe(0);
  });

  it('a row typed after the line came back is still saved: the screen does not share the baseline', async () => {
    const d = device();
    const here = server({ salt: { qty: 1, stock: 0 } });
    d.openPage(here).type('flour', { qty: 5 });
    const second = d.openPage(here);
    await second.answer(here);
    await second.pause();
    d.forgetSends();
    second.type('salt', { qty: 2 });
    await second.pause();
    expect(d.saves[0]?.entries?.salt?.qty).toBe(2);
  });

  it('typed before the draft has landed: noted too, with its time', () => {
    const d = device();
    d.openPage(null).type('flour', { qty: 5 });
    expect(d.note().entries.flour).toBeDefined();
    expect(d.note().at).toBe(START); // a note dated 1970 would be thrown away as expired
  });

  it('what the last page left keeps its own age, whatever is typed meanwhile', () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const typedAt = d.note().at;
    const second = d.openPage();
    d.clock.now = typedAt + 60 * 60 * 1000;
    second.type('salt', { qty: 2 });
    expect(d.note().at).toBe(typedAt);
  });

  it('a clear made on the new page before the server answered wins over the note', async () => {
    // A weak connection: the first answer arrives after the store has forgotten the lines it clears (forget comes before
    // the clear is written), whether or not the clear has landed.
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage();
    second.forget(['flour'], ['sup1'], true);
    expect(d.noted()).toBe(false);
    await second.answer(server());
    expect(second.entries.flour).toBeUndefined(); // it does not come back over the clear
    await second.pause();
    expect(d.saves).toEqual([]);
  });

  it('an order placed on the new page before the server answered wins over the note too', async () => {
    const d = device();
    const first = d.openPage();
    first.type('flour', { qty: 5 }, 'sup1');
    first.type('salt', { qty: 2 }, 'sup2');
    const second = d.openPage();
    second.forget(['flour'], ['sup1']);
    await second.answer(server());
    expect(second.entries.flour).toBeUndefined();
    expect(second.entries.salt?.qty).toBe(2);
    await second.pause();
    expect(d.sent()).toEqual([{ entries: { salt: QTY(2) }, days: { sup2: DAY } }]);
  });

  it('a stock count from a colleague says nothing about the quantity typed here', async () => {
    const d = device();
    d.openPage(server({ flour: { qty: 0, stock: 1 } })).type('flour', { qty: 5 });
    const second = d.openPage(server({ flour: { qty: 0, stock: 1 } }));
    await second.answer(server({ flour: { qty: 0, stock: 9 } }));
    expect(second.entries.flour?.qty).toBe(5);
    await second.pause();
    expect(d.saves[0]?.entries).toEqual({ flour: QTY(5) }); // the stock is not sent
  });

  it('a day stamp does not come back without its lines', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 }, 'sup1');
    const second = d.openPage();
    await second.answer(server({ flour: { qty: 7, stock: 0 } }));
    await second.pause();
    expect(d.saves).toEqual([]);
  });

  it('typed again on the new page before the server answered: the new number wins', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage();
    second.type('flour', { qty: 8 });
    expect(d.note().entries.flour?.row.qty).toBe(8);
    // And even corrected back to nothing: what was typed here is the last word on that line.
    second.type('flour', { qty: 0 });
    await second.answer(server());
    await second.pause();
    expect(d.saves).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
  });

  it('another line typed on the new page does not lose the note, and both go', async () => {
    const d = device();
    d.openPage().type('flour', { qty: 5 });
    const second = d.openPage();
    second.type('salt', { qty: 2 });
    expect(d.note().entries.flour).toBeDefined(); // still noted
    expect(d.note().entries.salt).toBeDefined();
    await second.answer(server());
    await second.pause();
    expect(d.saves.at(-1)?.entries?.flour?.qty).toBe(5);
    expect(d.saves.flatMap(save => Object.keys(save.entries ?? {}))).toContain('salt');
  });

  it('once a snapshot shows the write it is in Firestore\'s queue, and the note lets it go', async () => {
    const d = device();
    const page = d.openPage();
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    expect(d.note().entries.flour).toBeDefined(); // sent, but not yet in the queue
    page.snapshot(server({ flour: { qty: 5, stock: 0 } })); // Firestore shows it, the server has not answered
    expect(d.noted()).toBe(false);
    d.held[0]?.resolve();
    await settle();
  });

  it('a line typed over while a write is in the air notes the new number against what it knows', async () => {
    const d = device();
    const page = d.openPage();
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    page.snapshot(server({ flour: { qty: 5, stock: 0 } }));
    page.type('flour', { qty: 6 });
    expect(d.note().entries.flour).toEqual({ row: QTY(6), base: QTY(5) });
    d.held[0]?.resolve();
    await settle();
  });

  it('a write the server refused is not noted: it could never be saved, and would block every later one', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const page = d.openPage();
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    d.held[0]?.reject(new Error('permission-denied'));
    await settle();
    errors.mockRestore();
    expect(d.noted()).toBe(false);
    expect(page.sync.view().entries.flour?.qty).toBe(5); // still on screen, as before

    // A different number is new typing: noted.
    page.type('flour', { qty: 6 });
    expect(d.note().entries.flour?.row.qty).toBe(6);
    // The next open has nothing to replay from the refused one.
    d.letSavesThrough();
    const second = d.openPage();
    await second.answer(server());
    expect(second.entries.flour?.qty).toBe(6);
  });

  it('the page going out of sight sends what is waiting, at once, and only then', async () => {
    const d = device();
    const page = d.openPage();
    page.sync.sendWaiting();
    expect(d.saves).toEqual([]); // nothing waiting: nothing to say
    page.type('flour', { qty: 5 });
    page.sync.sendWaiting();
    await settle();
    expect(d.sent()).toEqual([{ entries: { flour: QTY(5) } }]); // no need to wait for the pause
    await page.pause();
    expect(d.saves).toHaveLength(1);
  });
});

// The write in the air may or may not have reached Firestore's queue: on the next open it either lands or never existed,
// and nothing on this page can know which. Both have to come out right.
describe('draft journal — a correction made while its write is in the air, and the page gone before it left', () => {
  // Typed `first`, sent, corrected to `second` with no snapshot in between, page gone in that instant.
  async function correctedThenGone(start: Record<string, DraftEntry>, first: number, second: number, field: 'qty' | 'stock' = 'qty') {
    const d = device();
    const page = d.openPage(server(start));
    d.holdSaves();
    page.type('flour', { [field]: first });
    await page.pause();
    expect(d.saves).toHaveLength(1); // the first write has gone
    page.type('flour', { [field]: second });
    d.forgetSends();
    d.letSavesThrough();
    return d;
  }

  it('⚠️ 5 put back to 0, page gone, the 5 was in the queue: the 0 goes out and the 5 does not come back', async () => {
    const d = await correctedThenGone({}, 5, 0);
    const landed = server({ flour: { qty: 5, stock: 0 } });
    const second = d.openPage(landed); // Firestore shows its own queue on the next page
    await second.answer(landed);
    expect(second.entries.flour?.qty).toBe(0); // the screen says what was last typed
    await second.pause();
    expect(d.sent()).toEqual([{ entries: { flour: QTY(0) } }]);
    expect(d.noted()).toBe(false); // and the note is done
  });

  it('5 put back to 0, page gone, the 5 never reached the queue: nothing to write', async () => {
    const d = await correctedThenGone({}, 5, 0);
    const second = d.openPage();
    await second.answer(server());
    await second.pause();
    expect(d.saves).toEqual([]);
    expect(second.entries.flour).toBeUndefined();
    expect(d.noted()).toBe(false);
  });

  it('a saved 3: 5 put back to 3, page gone, the 5 was in the queue: the 3 goes out', async () => {
    const d = await correctedThenGone({ flour: { qty: 3, stock: 0 } }, 5, 3);
    const landed = server({ flour: { qty: 5, stock: 0 } });
    const second = d.openPage(landed);
    await second.answer(landed);
    await second.pause();
    expect(second.entries.flour?.qty).toBe(3);
    expect(d.sent()).toEqual([{ entries: { flour: QTY(3) } }]);
  });

  it('5 corrected to 7, page gone: the 7 wins whether or not the 5 was in the queue', async () => {
    const inQueue = await correctedThenGone({}, 5, 7);
    const landed = server({ flour: { qty: 5, stock: 0 } });
    const one = inQueue.openPage(landed);
    await one.answer(landed);
    expect(one.entries.flour?.qty).toBe(7); // the 5 landed
    await one.pause();
    expect(inQueue.sent()).toEqual([{ entries: { flour: QTY(7) } }]);

    const notInQueue = await correctedThenGone({}, 5, 7);
    const two = notInQueue.openPage();
    await two.answer(server());
    expect(two.entries.flour?.qty).toBe(7); // the 5 never existed
    await two.pause();
    expect(notInQueue.sent()).toEqual([{ entries: { flour: QTY(7) } }]);
  });

  it('a stock count corrected back, page gone, the first one in the queue: only the stock goes out', async () => {
    const d = await correctedThenGone({ flour: { qty: 3, stock: 0 } }, 2, 0, 'stock');
    const landed = server({ flour: { qty: 3, stock: 2 } });
    const second = d.openPage(landed);
    await second.answer(landed);
    await second.pause();
    expect(second.entries.flour?.stock).toBe(0);
    expect(d.sent()).toEqual([{ entries: { flour: { stock: 0 } } }]);
  });

  it('corrected in the air, then a colleague wrote the line: their number stays', async () => {
    const d = await correctedThenGone({}, 5, 0);
    const theirs = server({ flour: { qty: 9, stock: 0 } });
    const second = d.openPage(theirs);
    await second.answer(theirs);
    await second.pause();
    expect(d.saves).toEqual([]);
    expect(second.entries.flour?.qty).toBe(9);
  });

  it('⚠️ corrected in the air, then the order was placed: the correction does not come back', async () => {
    const d = await correctedThenGone({}, 5, 7);
    d.history.records = [d.placedAt(START + 60_000, { flour: 5 })];
    const second = d.openPage();
    await second.answer(server());
    await second.pause();
    expect(d.saves).toEqual([]); // never a second order
    expect(second.entries.flour).toBeUndefined();
  });

  it('a correction that waited offline through another open still counts the write it corrected', async () => {
    const d = await correctedThenGone({}, 5, 0);
    d.openPage(); // no answer from the server: the note is written again
    const landed = server({ flour: { qty: 5, stock: 0 } });
    const third = d.openPage(landed);
    await third.answer(landed);
    expect(third.entries.flour?.qty).toBe(0);
    await third.pause();
    expect(d.sent()).toEqual([{ entries: { flour: QTY(0) } }]);
  });

  it('typed on the new page: the old write in the air no longer speaks for that line', async () => {
    const d = device();
    const first = d.openPage();
    d.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.type('flour', { qty: 0, stock: 4 });
    d.letSavesThrough();
    const second = d.openPage(); // the shelf count stays in the note, the 5 must not
    second.type('flour', { qty: 8 });
    expect('air' in (d.note().entries.flour ?? {})).toBe(false);
  });

  it('the 5 landed inside the pause of its correction, page gone: the 0 goes out', async () => {
    const d = device();
    const first = d.openPage();
    d.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.type('flour', { qty: 0 });
    d.held[0]?.resolve();
    await settle();
    d.forgetSends();
    d.letSavesThrough();
    const landed = server({ flour: { qty: 5, stock: 0 } });
    const second = d.openPage(landed);
    await second.answer(landed);
    await second.pause();
    expect(d.sent()).toEqual([{ entries: { flour: QTY(0) } }]);
  });

  it('a correction that turned out to need nothing does not cost another line its day stamp', async () => {
    const d = device();
    const first = d.openPage();
    d.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.type('flour', { qty: 0 });
    first.type('salt', { qty: 2 }, 'sup1');
    d.forgetSends();
    d.letSavesThrough();
    const second = d.openPage(); // the 5 never reached the queue
    await second.answer(server());
    await second.pause();
    expect(d.saves[0]?.entries).toEqual({ salt: QTY(2) });
    expect(d.saves[0]?.days).toEqual({ sup1: DAY });
    expect(second.days.sup1).toBe(DAY);
  });

  it('⚠️ a correction on a line a colleague has since ordered still keeps the day stamps out', async () => {
    const d = device();
    const first = d.openPage();
    d.holdSaves();
    first.type('flour', { qty: 5 }, 'sup1');
    await first.pause();
    first.type('flour', { qty: 0 });
    first.type('salt', { qty: 2 }, 'sup2');
    d.forgetSends();
    d.letSavesThrough();
    // Placing empties the line too, so it reads just as the correction wanted: only the orders tell.
    d.history.records = [d.placedAt(START + 60_000, { flour: 5 })];
    const second = d.openPage();
    await second.answer(server());
    await second.pause();
    expect(d.saves[0]?.entries).toEqual({ salt: QTY(2) });
    expect(d.saves[0]?.days).toBeUndefined(); // sup1's next order must not be dated by a stamp left behind
  });

  it('the note keeps the write in the air only when it says something else', async () => {
    const d = device();
    const page = d.openPage();
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    expect('air' in (d.note().entries.flour ?? {})).toBe(false); // the claim is the write in the air
    page.type('flour', { qty: 0 });
    expect(d.note().entries.flour).toEqual({ row: QTY(0), base: QTY(0), air: [QTY(5)] });
    // Both writes land: nothing is left to remember.
    await page.pause();
    d.held[0]?.resolve();
    await settle();
    d.held[1]?.resolve();
    await settle();
    expect(d.noted()).toBe(false);
  });
});
