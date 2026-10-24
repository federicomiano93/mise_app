// The rules of a print queue (print-queue-model.ts) — ported from tests/print-queue-model.test.mjs and
// tests/print-single-label.test.mjs (every test), then cross-checked against the ORIGINAL js/print-queue-model.js,
// which STAYS: print-agent/agent.mjs, the program on the shop computer, imports it directly.
//
// ⚠️ THE TWO FAILURES THIS FILE EXISTS AGAINST: a label printed twice, and a printer that is switched off while
// the phone says it is ready. And the third, between the two halves: the app writes a job that the agent then
// refuses — the last describe() below pins that every label Mise 2 can make is a payload the ORIGINAL
// isSingleLabel accepts, because that is the function the shop computer runs.

import { describe, expect, test } from 'vitest';
import {
  HEARTBEAT_MS, JOB_STATES, JOB_TTL_MS, LABEL_COMMANDS, MAX_COPIES, MAX_JOB_CHARS, STALE_AFTER_MS,
  buildJob, canMove, expiredJobs, isSingleLabel, isStale, nextJob, printerPresence,
} from './print-queue-model';
import { toZpl } from './label-zpl';
import { DEFAULT_PROFILE, resolveLabel } from './label-template-model';
import { buildLabel } from './recipe-label-model';
import { outputLanguage } from './market';
import { LABEL_CORPUS, LOCATIONS } from './fixtures/label-corpus';
import * as legacy from '../../js/print-queue-model.js';

type Obj = Record<string, any>;

const T0 = Date.parse('2026-09-03T10:00:00.000Z');
const at = (ms: number): string => new Date(T0 + ms).toISOString();

// ── What a job may become ────────────────────────────────────────────────────

describe('what a job may become (ported from tests/print-queue-model.test.mjs)', () => {
  test('a job goes queued → claimed → done, and nowhere else', () => {
    expect(canMove('queued', 'claimed')).toBe(true);
    expect(canMove('claimed', 'done')).toBe(true);
    expect(canMove('claimed', 'failed')).toBe(true);
  });

  test('⚠️⚠️ a claimed job is NEVER put back in the queue', () => {
    // If the agent died mid-print the paper may already be out. Re-queueing would print the label twice, and the
    // RIGHT answer is that a person notices and asks again.
    expect(canMove('claimed', 'queued')).toBe(false);
    expect(canMove('done', 'queued')).toBe(false);
    expect(canMove('failed', 'queued')).toBe(false);
  });

  test('a finished job is finished — nothing reopens it', () => {
    for (const to of JOB_STATES) {
      expect(canMove('done', to), `done → ${to} must be refused`).toBe(false);
      expect(canMove('failed', to), `failed → ${to} must be refused`).toBe(false);
    }
  });

  test('a state nobody recognises grants nothing', () => {
    // The app can be an old build on somebody's phone and the agent is a program on a computer nobody watches.
    // Anything unrecognised is refused, never assumed.
    expect(canMove('queued', 'printing')).toBe(false);
    expect(canMove('printing', 'done')).toBe(false);
    expect(canMove(undefined, 'done')).toBe(false);
    expect(canMove('queued', null)).toBe(false);
  });
});

// ── Building one ─────────────────────────────────────────────────────────────

describe('building a job', () => {
  test('a job carries what the agent needs and nothing else', () => {
    const job = buildJob({ payload: '^XA^XZ', createdBy: 'uid1', bakery: 'main', now: T0 });
    expect(job).toStrictEqual({
      bakery: 'main', status: 'queued', payload: '^XA^XZ', copies: 1,
      createdAt: '2026-09-03T10:00:00.000Z', createdBy: 'uid1',
    });
  });

  test('⚠️ an empty job is not queued — it is a sheet of blank paper', () => {
    expect(buildJob({ payload: '', createdBy: 'u', bakery: 'main', now: T0 })).toBeNull();
    expect(buildJob({ payload: '   \n ', createdBy: 'u', bakery: 'main', now: T0 })).toBeNull();
    expect(buildJob({ payload: null, createdBy: 'u', bakery: 'main', now: T0 })).toBeNull();
  });

  test('⚠️ a runaway job is refused rather than stored', () => {
    const huge = '^'.repeat(MAX_JOB_CHARS + 1);
    expect(buildJob({ payload: huge, createdBy: 'u', bakery: 'main', now: T0 })).toBeNull();
    const big = 'a'.repeat(MAX_JOB_CHARS);
    expect(buildJob({ payload: big, createdBy: 'u', bakery: 'main', now: T0 })).toBeTruthy();
  });

  test('a job with nobody to own it is not a job', () => {
    expect(buildJob({ payload: '^XA', createdBy: '', bakery: 'main', now: T0 })).toBeNull();
    expect(buildJob({ payload: '^XA', createdBy: 'u', bakery: '', now: T0 })).toBeNull();
  });

  test('copies are clamped, never trusted', () => {
    const of = (c: unknown): number => (buildJob({ payload: '^XA', copies: c, createdBy: 'u', bakery: 'main', now: T0 }) as { copies: number }).copies;
    expect(of(undefined)).toBe(1);
    expect(of(0)).toBe(1);
    expect(of(-5)).toBe(1);
    expect(of('3')).toBe(3);
    expect(of(1e9), 'a typo must not print a whole roll').toBe(99);
    expect(of(NaN)).toBe(1);
  });
});

// ── Is the printer there? ────────────────────────────────────────────────────

describe('is the printer there', () => {
  test('a heartbeat nobody has ever written reads as ABSENT, never as fine', () => {
    // An agent that has not started yet and one that never will look identical from here, and the safe reading of
    // both is that nothing is listening.
    expect(isStale(undefined, T0)).toBe(true);
    expect(isStale(null, T0)).toBe(true);
    expect(isStale('not a date', T0)).toBe(true);
    expect(isStale('', T0)).toBe(true);
  });

  test('⚠️ one missed beat is not an absent printer — three are', () => {
    // A single miss is a laptop lid or a Windows update. Warning every time one packet is late teaches people to
    // ignore the warning.
    expect(isStale(at(-HEARTBEAT_MS), T0)).toBe(false);
    expect(isStale(at(-HEARTBEAT_MS * 2), T0)).toBe(false);
    expect(isStale(at(-STALE_AFTER_MS - 1), T0)).toBe(true);
  });

  test('printerPresence answers with what the screen has to say', () => {
    expect(printerPresence([{ lastSeenAt: at(-1000) }], T0)).toStrictEqual({ ready: true, agents: 1 });
    expect(printerPresence([{ lastSeenAt: at(-STALE_AFTER_MS - 1) }], T0)).toStrictEqual({ ready: false, agents: 0 });
    expect(printerPresence([], T0)).toStrictEqual({ ready: false, agents: 0 });
    expect(printerPresence(null, T0)).toStrictEqual({ ready: false, agents: 0 });
  });

  test('⚠️ a shop computer with a wrong clock cannot look permanently ready', () => {
    // A heartbeat stamped in the future would never go stale. More than one beat ahead of now is no answer at all
    // rather than a very good one.
    expect(printerPresence([{ lastSeenAt: at(HEARTBEAT_MS * 5) }], T0)).toStrictEqual({ ready: false, agents: 0 });
    // A little ahead is ordinary clock drift and is accepted.
    expect(printerPresence([{ lastSeenAt: at(1000) }], T0)).toStrictEqual({ ready: true, agents: 1 });
  });

  test('two agents listening is two, so somebody can be told it is odd', () => {
    const both = printerPresence([{ lastSeenAt: at(-1000) }, { lastSeenAt: at(-2000) }], T0);
    expect(both.agents).toBe(2);
  });
});

// ── Which job is next ────────────────────────────────────────────────────────

describe('which job is next', () => {
  test('the oldest waiting job goes first', () => {
    const jobs = [
      { status: 'queued', createdAt: at(-3000) },
      { status: 'queued', createdAt: at(-9000) },
      { status: 'queued', createdAt: at(-1000) },
    ];
    expect(nextJob(jobs, T0)?.createdAt).toBe(at(-9000));
  });

  test('⚠️ a job somebody has already claimed is never taken again', () => {
    const jobs = [{ status: 'claimed', createdAt: at(-9000) }, { status: 'queued', createdAt: at(-1000) }];
    expect(nextJob(jobs, T0)?.createdAt).toBe(at(-1000));
  });

  test('⚠️ nothing from last week comes out of the printer this morning', () => {
    // The counter tapped Print, the computer was off, and the job waited. Printing it a day later puts a label
    // with yesterday's date on today's food.
    const stale = [{ status: 'queued', createdAt: at(-JOB_TTL_MS - 1) }];
    expect(nextJob(stale, T0)).toBeNull();
    expect(nextJob([{ status: 'queued', createdAt: 'rubbish' }], T0)).toBeNull();
  });

  test('an empty queue is not an error', () => {
    expect(nextJob([], T0)).toBeNull();
    expect(nextJob(null, T0)).toBeNull();
  });
});

// ── Cleaning up ──────────────────────────────────────────────────────────────

describe('cleaning up', () => {
  test('a finished job is rubbish the moment it is finished', () => {
    const jobs = [
      { status: 'done', createdAt: at(-1000) },
      { status: 'failed', createdAt: at(-1000) },
      { status: 'queued', createdAt: at(-1000) },
    ];
    expect(expiredJobs(jobs, T0).map(j => j.status)).toStrictEqual(['done', 'failed']);
  });

  test('⚠️ a job an agent claimed and then died holding still ages out', () => {
    // Otherwise it sits in the collection for ever, read on every app open.
    expect(expiredJobs([{ status: 'claimed', createdAt: at(-JOB_TTL_MS - 1) }], T0)).toHaveLength(1);
    expect(expiredJobs([{ status: 'claimed', createdAt: at(-1000) }], T0)).toHaveLength(0);
  });

  test('a job with no date can still be thrown away', () => {
    // Without this it could never age out, which is the one shape that accumulates.
    expect(expiredJobs([{ status: 'queued', createdAt: undefined }], T0)).toHaveLength(1);
  });

  test('something that is not a job is left alone rather than deleted', () => {
    expect(expiredJobs([null, { status: 'invented', createdAt: at(-1) }], T0)).toStrictEqual([]);
  });
});

// ── Only a label reaches the printer (ported from tests/print-single-label.test.mjs) ──

const ing = (name: string, emphasise = false): Obj => ({ id: name, name, grams: 100, allergens: [], emphasise });
const label = (over: Obj = {}): Obj => ({
  ok: true, reason: null, shows: 'allergens',
  name: 'Pane semplice',
  ingredients: [ing('Farina 0', true), ing('Acqua')],
  allergens: ['gluten-wheat'], mayContain: [], nutrition: null, nutritionMissing: false,
  ...over,
});
const zpl = (over: Obj = {}, profile: Obj = {}, opts?: { copies?: number }): string =>
  toZpl(resolveLabel(label(over), { ...DEFAULT_PROFILE, printerLanguage: 'zpl', ...profile }, {}, 'it') as never, opts);

describe('only a label reaches the printer (ported from tests/print-single-label.test.mjs)', () => {
  test('a label the app makes is a single label', () => {
    const out = zpl();
    expect(out.startsWith('^XA'), 'the fixture did not produce a label at all').toBe(true);
    expect(isSingleLabel(out)).toBe(true);
  });

  test('…at the other resolution, with copies, and with the three characters ZPL reserves in the text', () => {
    expect(isSingleLabel(zpl({}, { dpi: 300 }))).toBe(true);
    expect(isSingleLabel(zpl({}, {}, { copies: 3 })), '^PQ is how copies are asked for').toBe(true);
    const tricky = zpl({ name: 'Aroma ~ naturale ^ al 100_%', ingredients: [ing('Sale ~ fino')] });
    expect(isSingleLabel(tricky), 'a product called «Aroma ~ naturale» must still print').toBe(true);
  });

  test('every command the app writes is on the list, so the list cannot fall behind silently', () => {
    const out = zpl({}, {}, { copies: 2 });
    const used = new Set([...out.matchAll(/\^([A-Z0-9]{2})/g)].map(m => m[1] as string));
    for (const c of used) expect(LABEL_COMMANDS.includes(c), `label-zpl writes ^${c}, which the agent would refuse`).toBe(true);
  });

  test('a printer command that is not a label is refused', () => {
    for (const [what, payload] of [
      ['a reset', '~JR'],
      ['a reset inside a label', '^XA\n^FDPane^FS\n~JR\n^XZ'],
      ['settings saved over the set-up ones', '^XA^JUS^XZ'],
      ['the same in lower case, which a printer also obeys', '^xa^jus^xz'],
      ['the command character changed', '^XA^CC!^XZ'],
      ['a configuration label', '~WC'],
      ['two labels in one job', '^XA^FDone^FS^XZ^XA^FDtwo^FS^XZ'],
      ['a label with no end', '^XA^FDPane^FS'],
      ['text before the label', 'hello^XA^FDPane^FS^XZ'],
    ] as const) expect(isSingleLabel(payload), `${what} was let through`).toBe(false);
  });

  test('nothing that is not text gets through, and nothing too big', () => {
    for (const v of [null, undefined, 42, {}, ['^XA^XZ'], '']) expect(isSingleLabel(v)).toBe(false);
    expect(isSingleLabel('^XA^FD' + 'x'.repeat(MAX_JOB_CHARS) + '^FS^XZ')).toBe(false);
  });

  // The agent’s own half of this test — that agent.mjs asks before it prints and marks a refused job failed — is
  // pinned by tests/print-single-label.test.mjs, which reads print-agent/agent.mjs and stays in the root suite.

  // ⚠️ A label for three loaves may ask for three copies; ^PQ99999 would run a whole roll through the printer
  // (code review, 23 Sep 2026).
  test('a label may ask for a few copies, never a roll', () => {
    expect(isSingleLabel('^XA^FDx^FS^PQ3^XZ')).toBe(true);
    expect(isSingleLabel('^XA^FDx^FS^PQ99^XZ')).toBe(true);
    expect(isSingleLabel('^XA^FDx^FS^PQ100^XZ')).toBe(false);
    expect(isSingleLabel('^XA^FDx^FS^PQ99999^XZ')).toBe(false);
    expect(isSingleLabel('^XA^FDx^FS^PQ2^PQ2^XZ'), 'one ^PQ per label').toBe(false);
    expect(isSingleLabel('^XA^FDx^FS^PQ^XZ'), 'a ^PQ with no number is not a count').toBe(false);
    // And the app never makes one the agent would refuse.
    expect(isSingleLabel(zpl({}, {}, { copies: 5000 }))).toBe(true);
  });
});

// ── The port and the original, over a table of inputs ────────────────────────

describe('the port decides what the original decides', () => {
  test('the constants are the original’s', () => {
    expect([...JOB_STATES]).toStrictEqual([...legacy.JOB_STATES]);
    expect([...LABEL_COMMANDS]).toStrictEqual([...legacy.LABEL_COMMANDS]);
    expect(
      [MAX_JOB_CHARS, MAX_COPIES, HEARTBEAT_MS, STALE_AFTER_MS, JOB_TTL_MS],
    ).toStrictEqual([legacy.MAX_JOB_CHARS, legacy.MAX_COPIES, legacy.HEARTBEAT_MS, legacy.STALE_AFTER_MS, legacy.JOB_TTL_MS]);
  });

  test('canMove, for every pair of states and for strangers', () => {
    const values = [...JOB_STATES, 'printing', '', null, undefined, 3, {}];
    for (const from of values) for (const to of values) {
      expect(canMove(from, to), `${String(from)} → ${String(to)}`).toBe(legacy.canMove(from, to));
    }
  });

  test('buildJob, over copies, payloads, owners and clocks', () => {
    const payloads: unknown[] = [
      '^XA^XZ', '', '   ', null, undefined, 42, '^XA\n^FDAroma _7E naturale^FS\n^XZ\n', '^XA~JR^XZ',
      'a'.repeat(MAX_JOB_CHARS), 'a'.repeat(MAX_JOB_CHARS + 1), 'ù'.repeat(100),
    ];
    const copiesList: unknown[] = [undefined, 0, 1, 2, 3, '3', 99, 100, 1e9, -5, NaN, 2.9, 'x', null, '', Infinity];
    const owners: Array<[unknown, unknown]> = [['uid1', 'main'], ['', 'main'], ['uid1', ''], [undefined, undefined], [7, 'main']];
    for (const payload of payloads) for (const copies of copiesList) for (const [createdBy, bakery] of owners) {
      const input = { payload, copies, createdBy, bakery, now: T0 };
      expect(buildJob(input), JSON.stringify({ copies, createdBy, bakery, n: String(payload).length })).toStrictEqual(legacy.buildJob(input as never));
    }
    for (const now of [T0, new Date(T0), at(0), 0, undefined, 'garbage', NaN, new Date(NaN)]) {
      const mine = buildJob({ payload: '^XA^XZ', createdBy: 'u', bakery: 'b', now }) as Obj;
      const theirs = legacy.buildJob({ payload: '^XA^XZ', createdBy: 'u', bakery: 'b', now }) as Obj;
      const meaningful = (typeof now === 'number' && Number.isFinite(now) && now !== 0)
        || (now instanceof Date && !Number.isNaN(now.getTime()))
        || now === at(0);
      if (meaningful) {
        expect(mine, String(now)).toStrictEqual(theirs);
      } else {
        // A clock that says nothing sensible means «now», which two calls apart can differ by a millisecond.
        expect({ ...mine, createdAt: '' }, String(now)).toStrictEqual({ ...theirs, createdAt: '' });
        expect(Math.abs(Date.parse(mine.createdAt) - Date.parse(theirs.createdAt)), String(now)).toBeLessThan(5000);
      }
    }
  });

  test('isSingleLabel, over payloads', () => {
    const payloads: unknown[] = [
      '^XA^XZ', '  ^XA^XZ  ', '^XA\n^FDx^FS\n^XZ\n', '^xa^fdx^fs^xz', '^XA^FDa~b^FS^XZ', '^XA^FDa_7Eb^FS^XZ',
      '^XA^PQ3^XZ', '^XA^PQ99^XZ', '^XA^PQ100^XZ', '^XA^PQ0^XZ', '^XA^PQ^XZ', '^XA^PQ2^PQ2^XZ', '^XA^pq3^XZ',
      '^XA^PQ3.5^XZ', '^XA^JUS^XZ', '^XA^CC!^XZ', '^XA^FDx^FS', '^XZ^XA', '^XA^XA^XZ', '^XA^XZ^XZ', '^XA^X',
      '^XA^FD^^^FS^XZ', '^XA^XZ^', '^XA^FDÈ^FS^XZ', '~JR', '', '   ', null, undefined, 42, {}, ['^XA^XZ'],
      '^XA^FD' + 'x'.repeat(MAX_JOB_CHARS) + '^FS^XZ', '^XA^FD' + 'x'.repeat(MAX_JOB_CHARS - 20) + '^FS^XZ',
    ];
    for (const payload of payloads) {
      expect(isSingleLabel(payload), JSON.stringify(payload)?.slice(0, 60)).toBe(legacy.isSingleLabel(payload));
    }
  });

  test('isStale and printerPresence, with heartbeats in the future, missing or garbage', () => {
    const seen: unknown[] = [
      at(0), at(-1000), at(-HEARTBEAT_MS), at(-STALE_AFTER_MS), at(-STALE_AFTER_MS - 1), at(1000), at(HEARTBEAT_MS),
      at(HEARTBEAT_MS + 1), at(HEARTBEAT_MS * 5), '', 'not a date', null, undefined, 42, {}, [], true,
    ];
    for (const lastSeenAt of seen) {
      expect(isStale(lastSeenAt, T0), String(lastSeenAt)).toBe(legacy.isStale(lastSeenAt, T0));
      expect(isStale(lastSeenAt, T0, 1000), String(lastSeenAt)).toBe(legacy.isStale(lastSeenAt, T0, 1000));
      const agents = [{ lastSeenAt }];
      expect(printerPresence(agents, T0), String(lastSeenAt)).toStrictEqual(legacy.printerPresence(agents, T0));
    }
    const lists: unknown[] = [
      [], null, undefined, 'x', 3, {}, [null], [undefined], [{}], [{ lastSeenAt: at(-1000) }, { lastSeenAt: at(-2000) }],
      [{ lastSeenAt: at(-1000) }, null, { lastSeenAt: 'bad' }, { lastSeenAt: at(HEARTBEAT_MS * 5) }, { lastSeenAt: at(-STALE_AFTER_MS - 1) }],
      [{ lastSeenAt: T0 }],
    ];
    for (const agents of lists) {
      expect(printerPresence(agents, T0), JSON.stringify(agents)).toStrictEqual(legacy.printerPresence(agents, T0));
    }
  });

  test('expiredJobs and nextJob, over a queue of every shape', () => {
    const jobs: unknown[] = [
      { id: 'a', status: 'queued', createdAt: at(-3000) },
      { id: 'b', status: 'queued', createdAt: at(-9000) },
      { id: 'c', status: 'queued', createdAt: at(-1000) },
      { id: 'd', status: 'queued', createdAt: at(-9000) },
      { id: 'e', status: 'claimed', createdAt: at(-9000) },
      { id: 'f', status: 'claimed', createdAt: at(-JOB_TTL_MS - 1) },
      { id: 'g', status: 'claimed', createdAt: 'rubbish' },
      { id: 'h', status: 'done', createdAt: at(-1) },
      { id: 'i', status: 'failed' },
      { id: 'j', status: 'queued' },
      { id: 'k', status: 'queued', createdAt: at(-JOB_TTL_MS) },
      { id: 'l', status: 'queued', createdAt: at(-JOB_TTL_MS - 1) },
      { id: 'm', status: 'queued', createdAt: at(5000) },
      { id: 'n', status: 'invented', createdAt: at(-1) },
      null, undefined, 'x', 7,
    ];
    const queues: unknown[] = [jobs, jobs.slice(0, 4), jobs.slice(4), [], null, undefined, 'x', {}, [jobs[0]], [jobs[11]]];
    for (const queue of queues) {
      for (const ttl of [undefined, 1000, 0]) {
        expect(expiredJobs(queue as never, T0, ttl), `expired ${JSON.stringify(queue)?.slice(0, 40)} ${String(ttl)}`)
          .toStrictEqual(legacy.expiredJobs(queue, T0, ttl));
        expect(nextJob(queue as never, T0, ttl), `next ${JSON.stringify(queue)?.slice(0, 40)} ${String(ttl)}`)
          .toStrictEqual(legacy.nextJob(queue, T0, ttl));
      }
    }
  });
});

// ── The end-to-end pin: what the shop computer runs ──────────────────────────

describe('every label Mise 2 can make is a job the shop computer’s agent accepts', () => {
  test('for every corpus label, paper head and number of copies: the port’s ZPL, queued, passes the ORIGINAL isSingleLabel', () => {
    let checked = 0;
    for (const entry of LABEL_CORPUS) {
      for (const shows of ['allergens', 'both']) {
        const built = buildLabel(entry.recipe as never, entry.tables as never, { shows });
        for (const [venue, location] of Object.entries(LOCATIONS)) {
          const lang = outputLanguage(location as never) ?? 'en';
          for (const dpi of [203, 300]) {
            const resolved = resolveLabel(built, { ...DEFAULT_PROFILE, printerLanguage: 'zpl', dpi }, {}, lang);
            if (!resolved.ok) continue;
            for (const copies of [1, 3, 99, 5000]) {
              const name = `${entry.id} · ${shows} · ${venue} · ${dpi} dpi · ${copies} copies`;
              const payload = toZpl(resolved, { copies });
              expect(isSingleLabel(payload), name).toBe(true);
              expect(legacy.isSingleLabel(payload), `${name} (the agent’s own check)`).toBe(true);
              const job = buildJob({ payload, copies, createdBy: 'uid1', bakery: 'main', now: T0 });
              expect(job, `${name} (buildJob refused it)`).not.toBeNull();
              expect(legacy.isSingleLabel((job as { payload: string }).payload), `${name} (queued payload)`).toBe(true);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test('a long label that does not fit is still a well-formed job (the screen refuses it, the agent would not)', () => {
    const long = label({ ingredients: Array.from({ length: 80 }, (_, i) => ing(`Ingrediente numero ${i}`, i % 3 === 0)) });
    const payload = toZpl(resolveLabel(long, { ...DEFAULT_PROFILE, printerLanguage: 'zpl' }, {}, 'it') as never, { copies: 3 });
    expect(isSingleLabel(payload)).toBe(true);
    expect(legacy.isSingleLabel(payload)).toBe(true);
  });
});
