// A draft write the SERVER refused after the person had already left Orders (item 6 of docs/mise2-port-owed.md, «STILL
// OPEN»; docs/parity/orders.md, «Refused after leaving Orders as built»).
//
// Leaving Orders sends what waits and does not wait for the answer (ordersStore.stop). A refusal that came back afterwards
// reached nobody: the quantity was gone without a word. Now it is kept on this device (refusedNote.ts), said ONCE at the next
// opening, and handed back as a refusal on screen is handed back — but only where the line still reads as it did and no order
// has named it since, the draft journal's own judge. Here the sync runs for real over one device's storage; a fresh sync over
// the same storage stands for the next opening.

import { describe, expect, it, vi } from 'vitest';
import { DRAFT_JOURNAL_KEY } from '@mise/shared/draft-journal';
import { createDraftSync, ORDERS_RETRY_MS } from './draftSync';
import type { DraftEntry, DraftPayload, DraftView } from './draftSync';
import { REFUSED_NOTE_KEY } from './refusedNote';

const VENUE = 'venue-a';
const PERSON = 'u1';
const START = Date.parse('2026-11-12T10:00:00Z');

type Doc = { entries: Record<string, DraftEntry>; days: Record<string, string>; updatedAt: string };
const server = (entries: Record<string, DraftEntry> = {}, days: Record<string, string> = {}): Doc => ({ entries, days, updatedAt: 'x' });
const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });
const QTY = (qty: number) => ({ qty, unit: '', supplierId: '' });

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

// One device across several openings of Orders: its storage, the server's orders and answers, the writes it sent.
function device() {
  const storage = fakeStorage();
  const clock = { now: START };
  const history = { records: [] as unknown[], fail: false, reads: 0 };
  const saves: DraftPayload[] = [];
  const held: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  const retries: Array<() => void> = [];
  let hold = false;
  let refuse = false;
  // The page-wide signal: every opening on screen hears a refusal noted by another.
  const listeners = new Set<() => void>();

  function openPage({ venue = VENUE, person = PERSON }: { venue?: string; person?: string } = {}) {
    let timer: (() => void) | null = null;
    const page = {
      entries: {} as Record<string, DraftEntry>, days: {} as Record<string, string>,
      said: 0, back: 0, failed: 0, ok: 0,
    };
    const draw = (view: DraftView) => {
      page.entries = structuredClone({ ...view.entries }) as Record<string, DraftEntry>;
      page.days = { ...view.days };
    };
    const sync = createDraftSync({
      save: payload => {
        saves.push(payload);
        if (hold) return new Promise<void>((resolve, reject) => { held.push({ resolve, reject }); });
        return refuse ? Promise.reject(new Error('permission-denied')) : Promise.resolve();
      },
      nowIso: () => new Date(clock.now).toISOString(),
      setTimer: run => { timer = run; return 1; },
      clearTimer: () => { timer = null; },
      onResult: ok => { if (ok) page.ok += 1; else page.failed += 1; },
      journal: {
        venue,
        person,
        storage: () => storage,
        now: () => clock.now,
        ordersSince: async () => {
          history.reads += 1;
          if (history.fail) throw new Error('unavailable');
          return history.records;
        },
        retryLater: run => { retries.push(run); },
        onCameBack: draw,
        onRefusedEarlier: () => { page.said += 1; },
        onRefusedBack: view => { draw(view); page.back += 1; },
        refusedNoted: () => { for (const run of [...listeners]) run(); },
      },
    });
    const hear = () => { sync.lookForRefused(); };
    const self = {
      sync,
      page,
      get entries() { return page.entries; },
      // The section opens: the store's start().
      start() {
        sync.startJournal();
        listeners.add(hear);
      },
      // The section closes: the store's stop() — the note stops, and what waits is sent once more, unanswered here.
      leave() {
        listeners.delete(hear);
        sync.stopJournal();
        sync.flush().then(() => undefined, () => undefined);
      },
      snapshot(next: Doc | null, fromServer = false) { draw(sync.receive(structuredClone(next), fromServer)); },
      type(id: string, patch: DraftEntry) {
        page.entries[id] = { qty: 0, stock: 0, ...page.entries[id], ...patch };
        sync.change(page.entries, page.days);
      },
      async pause() {
        const run = timer;
        timer = null;
        run?.();
        await settle();
      },
      hasTimer: () => timer !== null,
      async answer(next: Doc | null) {
        self.snapshot(next, true);
        await settle();
        await settle();
      },
      forget(ids: string[], suppliers: string[]) { draw(sync.forget(ids, suppliers)); },
    };
    self.start();
    return self;
  }

  return {
    openPage, storage, clock, history, saves, held, retries,
    holdSaves: () => { hold = true; },
    letSavesThrough: () => { hold = false; },
    refuseSaves: (on = true) => { refuse = on; },
    refusedNote: () => JSON.parse(storage.getItem(REFUSED_NOTE_KEY) ?? 'null') as null | {
      lid: string; uid: string; at: number; told: boolean; entries: Record<string, { row: DraftEntry; base: DraftEntry; air?: DraftEntry[] }>;
      days: Record<string, { day: string; base: string }>;
    },
    journalNote: () => JSON.parse(storage.getItem(DRAFT_JOURNAL_KEY) ?? 'null') as null | { entries: Record<string, unknown> },
    placedAt: (when: number, quantities: Record<string, number>) => ({ sends: { s1: { at: new Date(when).toISOString(), quantities } } }),
  };
}

// The person types 5 of flour and leaves Orders with the write in the air; the server then says no.
async function refusedAfterLeaving(d: ReturnType<typeof device>, start: Doc = server()) {
  const page = d.openPage();
  await page.answer(start);
  d.holdSaves();
  page.type('flour', { qty: 5 });
  await page.pause(); // the 5 is in the air
  page.leave();
  d.held[0]?.reject(new Error('permission-denied'));
  await settle();
  d.held.length = 0;
  d.letSavesThrough();
  return page;
}

describe('a draft write refused after the person left Orders', () => {
  it('⚠️ is kept on this device (not lost, not in the journal), with what the server held when it left', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    await refusedAfterLeaving(d, server({ flour: { qty: 2, unit: '', supplierId: '', stock: 1 } }));
    errors.mockRestore();
    expect(d.refusedNote()).toEqual({
      v: 1, lid: VENUE, uid: PERSON, at: START, told: false,
      entries: { flour: { row: QTY(5), base: QTY(2) } }, days: {},
    });
    // Out of the draft journal: a refused value there would be replayed at every opening, for ever.
    expect(d.journalNote()).toBeNull();
  });

  it('is said ONCE at the next opening, then handed back on screen as a refusal: «not saved», never sent by itself', async () => {
    const d = device();
    await refusedAfterLeaving(d);
    const next = d.openPage();
    expect(next.page.said).toBe(1); // said as Orders opens, before the server has answered
    expect(d.refusedNote()?.told).toBe(true);
    expect(next.entries.flour).toBeUndefined(); // nothing on the word of the phone's own copy
    next.snapshot(server()); // the phone's copy
    await settle();
    expect(next.page.back).toBe(0);
    await next.answer(server()); // the server's first word
    expect(d.history.reads).toBe(1); // the orders were asked about first
    expect(next.page.back).toBe(1);
    expect(next.entries.flour?.qty).toBe(5);
    expect(next.sync.hasUnsaved()).toBe(true);
    // Not sent on its own (a refusal on screen is not retried by a timer either), and not noted in the journal.
    expect(next.hasTimer()).toBe(false);
    d.saves.length = 0;
    await next.pause();
    expect(d.saves).toEqual([]);
    expect(d.journalNote()).toBeNull();
    // Judged: the note is gone.
    expect(d.refusedNote()).toBeNull();
    // The next change carries it, as it would carry a refusal on screen.
    next.type('salt', { qty: 1 });
    await next.pause();
    expect(d.saves).toEqual([expect.objectContaining({ entries: { flour: QTY(5), salt: QTY(1) } })]);
  });

  it('a reopening before the server answered does not say it again, and still hands it back', async () => {
    const d = device();
    await refusedAfterLeaving(d);
    const second = d.openPage();
    expect(second.page.said).toBe(1);
    second.leave(); // gone before the server answered
    const third = d.openPage();
    expect(third.page.said).toBe(0);
    await third.answer(server());
    expect(third.entries.flour?.qty).toBe(5);
    expect(third.page.back).toBe(1);
  });

  it('⚠️ another venue never sees it, and the note is thrown away', async () => {
    const d = device();
    await refusedAfterLeaving(d);
    const there = d.openPage({ venue: 'venue-b' });
    await there.answer(server());
    expect(there.page.said).toBe(0);
    expect(there.page.back).toBe(0);
    expect(there.entries.flour).toBeUndefined();
    expect(d.refusedNote()).toBeNull();
    const home = d.openPage();
    expect(home.page.said).toBe(0);
  });

  it('⚠️ another person never sees it, and the note is thrown away', async () => {
    const d = device();
    await refusedAfterLeaving(d);
    const other = d.openPage({ person: 'u2' });
    await other.answer(server());
    expect(other.page.said).toBe(0);
    expect(other.entries.flour).toBeUndefined();
    expect(d.refusedNote()).toBeNull();
  });

  it('⚠️ refused AGAIN after it came back and the person left once more: final, as a second refusal on leaving is', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    await refusedAfterLeaving(d);
    const next = d.openPage();
    await next.answer(server());
    expect(next.entries.flour?.qty).toBe(5);
    d.refuseSaves();
    d.saves.length = 0;
    next.leave(); // tried once more on leaving…
    await settle();
    await settle();
    errors.mockRestore();
    expect(d.saves).toEqual([expect.objectContaining({ entries: { flour: QTY(5) } })]);
    // …and refused: not noted again, so it does not come back for ever.
    expect(d.refusedNote()).toBeNull();
    const after = d.openPage();
    await after.answer(server());
    expect(after.page.said).toBe(0);
    expect(after.entries.flour).toBeUndefined();
  });

  it('a NEW number typed on the line it came back to, refused after leaving, is said again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    await refusedAfterLeaving(d);
    const next = d.openPage();
    await next.answer(server());
    d.refuseSaves();
    next.type('flour', { qty: 7 });
    next.leave();
    await settle();
    await settle();
    errors.mockRestore();
    expect(d.refusedNote()?.entries.flour?.row.qty).toBe(7);
    expect(d.refusedNote()?.told).toBe(false);
    d.refuseSaves(false);
    expect(d.openPage().page.said).toBe(1);
  });

  it('refused on screen first, then once more as the person left: the second refusal is kept and said (the main road)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const page = d.openPage();
    await page.answer(server());
    d.refuseSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    expect(page.page.failed).toBe(1); // said on screen: «not saved»
    page.snapshot(server()); // Firestore takes its copy back
    page.leave(); // leaving tries once more…
    await settle();
    await settle();
    errors.mockRestore();
    expect(d.saves).toHaveLength(2);
    // …refused again, and no longer lost without a word.
    expect(d.refusedNote()?.entries.flour).toEqual({ row: QTY(5), base: QTY(0) });
    d.refuseSaves(false);
    const next = d.openPage();
    expect(next.page.said).toBe(1);
    await next.answer(server());
    expect(next.entries.flour?.qty).toBe(5);
  });

  it('⚠️ a colleague changed that line meanwhile: said, but their number wins', async () => {
    const d = device();
    await refusedAfterLeaving(d);
    const next = d.openPage();
    expect(next.page.said).toBe(1);
    await next.answer(server({ flour: QTY(3) }));
    expect(next.entries.flour?.qty).toBe(3);
    expect(next.page.back).toBe(0);
    expect(d.refusedNote()).toBeNull();
  });

  it('⚠️ an order placed since names the line: said, but the number stays out (it would be ordered twice)', async () => {
    const d = device();
    await refusedAfterLeaving(d);
    d.history.records = [d.placedAt(START + 60_000, { flour: 5 })];
    const next = d.openPage();
    await next.answer(server()); // placing emptied the line: it reads as it did
    expect(next.entries.flour).toBeUndefined();
    expect(next.page.back).toBe(0);
    expect(d.refusedNote()).toBeNull();
  });

  it('a number typed on the new opening before the server answered beats it', async () => {
    const d = device();
    await refusedAfterLeaving(d);
    const next = d.openPage();
    next.snapshot(server());
    next.type('flour', { qty: 9 });
    await next.answer(server());
    expect(next.entries.flour?.qty).toBe(9);
    expect(next.page.back).toBe(0);
  });

  it('the orders cannot be read: it waits, and comes back when they can', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    await refusedAfterLeaving(d);
    d.history.fail = true;
    const next = d.openPage();
    await next.answer(server());
    expect(next.entries.flour).toBeUndefined();
    expect(d.retries).toHaveLength(1);
    expect(d.refusedNote()).not.toBeNull(); // still kept
    d.history.fail = false;
    d.retries.shift()?.();
    await settle();
    await settle();
    errors.mockRestore();
    expect(next.entries.flour?.qty).toBe(5);
    expect(ORDERS_RETRY_MS).toBe(30_000);
  });

  it('⚠️ refused while a NEW opening is already on screen: said and handed back there at once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const first = d.openPage();
    await first.answer(server());
    d.refuseSaves();
    first.type('flour', { qty: 5 });
    await first.pause(); // refused on screen: not in the journal
    first.snapshot(server());
    d.refuseSaves(false);
    d.holdSaves();
    first.leave(); // tried once more on leaving, still in the air…
    const second = d.openPage(); // …while the person is back on Orders
    await second.answer(server());
    expect(second.entries.flour).toBeUndefined();
    d.held[0]?.reject(new Error('permission-denied'));
    await settle();
    await settle();
    errors.mockRestore();
    expect(second.page.said).toBe(1);
    expect(second.page.back).toBe(1);
    expect(second.entries.flour?.qty).toBe(5);
  });

  it('refused while a new opening already holds that number from the draft journal: said, and not handed back twice', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const first = d.openPage();
    await first.answer(server());
    d.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.leave();
    const second = d.openPage();
    await second.answer(server()); // the journal still holds the 5 in the air: it comes back (F-15)
    expect(second.entries.flour?.qty).toBe(5);
    d.held[0]?.reject(new Error('permission-denied'));
    await settle();
    await settle();
    errors.mockRestore();
    expect(second.page.said).toBe(1);
    expect(second.page.back).toBe(0);
    expect(second.entries.flour?.qty).toBe(5);
    expect(d.refusedNote()).toBeNull();
  });

  it('a later write already on its way with a newer number answers for itself: the older refusal is not noted', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const page = d.openPage();
    await page.answer(server());
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    page.type('flour', { qty: 6 });
    page.leave(); // the 6 goes too
    d.held[0]?.reject(new Error('permission-denied')); // the 5 refused
    await settle();
    expect(d.refusedNote()).toBeNull();
    d.held[1]?.reject(new Error('permission-denied')); // the 6 refused: that one is kept
    await settle();
    errors.mockRestore();
    expect(d.refusedNote()?.entries.flour?.row.qty).toBe(6);
  });

  it('⚠️ as real Firestore does it: the new opening still SHOWS the refused number until the take-back; judged after it, handed back', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const first = d.openPage();
    await first.answer(server());
    d.holdSaves();
    first.type('flour', { qty: 5 });
    await first.pause();
    first.leave();
    const second = d.openPage();
    // One Firestore for both stores: the old store's queued 5 is laid over this listener too.
    await second.answer(server({ flour: QTY(5) }));
    expect(second.entries.flour?.qty).toBe(5);
    d.held[0]?.reject(new Error('permission-denied'));
    await settle();
    expect(second.page.said).toBe(1);
    expect(second.page.back).toBe(0); // not judged on a copy that still shows the refused write
    expect(d.refusedNote()).not.toBeNull();
    second.snapshot(server()); // Firestore takes the 5 back
    await settle();
    await settle();
    errors.mockRestore();
    expect(second.page.back).toBe(1);
    expect(second.entries.flour?.qty).toBe(5);
    expect(d.refusedNote()).toBeNull();
  });

  it('⚠️ «ordered since?» counts from the KEYSTROKE, not from a refusal that came hours later (an offline tablet)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const page = d.openPage();
    await page.answer(server());
    d.holdSaves();
    page.type('flour', { qty: 5 }); // 10:00, offline
    await page.pause();
    page.leave();
    d.clock.now = START + 2 * 60 * 60 * 1000; // 12:00: back online, refused
    d.held[0]?.reject(new Error('permission-denied'));
    await settle();
    errors.mockRestore();
    expect(d.refusedNote()?.at).toBe(START);
    // 11:00: a colleague, not seeing the tablet's 5, ordered flour (placing emptied the line again).
    d.history.records = [d.placedAt(START + 60 * 60 * 1000, { flour: 5 })];
    d.letSavesThrough();
    const next = d.openPage();
    await next.answer(server());
    expect(next.page.said).toBe(1);
    expect(next.entries.flour).toBeUndefined();
  });

  it('⚠️ «5, then 6» with both refused: the 6 comes back on a line that still reads empty', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const page = d.openPage();
    await page.answer(server());
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause(); // the 5 in the air, shown back to this phone
    page.snapshot(server({ flour: QTY(5) }));
    page.type('flour', { qty: 6 });
    page.leave(); // the 6 goes too, with the 5 as its base
    d.held[0]?.reject(new Error('permission-denied'));
    d.held[1]?.reject(new Error('permission-denied'));
    await settle();
    errors.mockRestore();
    expect(d.refusedNote()?.entries.flour).toEqual({ row: QTY(6), base: QTY(5), air: [QTY(0)] });
    d.letSavesThrough();
    const next = d.openPage();
    await next.answer(server());
    expect(next.entries.flour?.qty).toBe(6);
    expect(next.page.back).toBe(1);
  });

  it('«5, then 6», the 5 landed and the 6 refused: the 6 comes back on the 5', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const page = d.openPage();
    await page.answer(server());
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    page.snapshot(server({ flour: QTY(5) }));
    page.type('flour', { qty: 6 });
    page.leave();
    d.held[0]?.resolve();
    d.held[1]?.reject(new Error('permission-denied'));
    await settle();
    errors.mockRestore();
    d.letSavesThrough();
    const next = d.openPage();
    await next.answer(server({ flour: QTY(5) }));
    expect(next.entries.flour?.qty).toBe(6);
  });

  it('a write that LANDS after leaving notes nothing', async () => {
    const d = device();
    const page = d.openPage();
    await page.answer(server());
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    page.leave();
    d.held[0]?.resolve();
    await settle();
    expect(d.refusedNote()).toBeNull();
    expect(d.openPage().page.said).toBe(0);
  });

  it('without a person (a spec, or no session) nothing is noted: as before', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = device();
    const page = d.openPage({ person: '' });
    await page.answer(server());
    d.holdSaves();
    page.type('flour', { qty: 5 });
    await page.pause();
    page.leave();
    d.held[0]?.reject(new Error('permission-denied'));
    await settle();
    errors.mockRestore();
    expect(d.storage.getItem(REFUSED_NOTE_KEY)).toBeNull();
  });
});
