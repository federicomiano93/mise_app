// How the «with logo» label reaches paper (image-label-print.ts): the road its Print button takes, and the job it
// queues. The job is cross-checked against the ORIGINAL js/print-queue-model.js, the file the shop computer's agent
// imports: a label the app queues and the agent then refuses is the failure this file exists against.

import { describe, expect, test } from 'vitest';
import { IMAGE_AGENT_VERSION, imageAgentState, imageLabelJob, versionAtLeast } from './image-label-print';
import { HEARTBEAT_MS, MAX_JOB_CHARS, STALE_AFTER_MS, isSingleLabel } from './print-queue-model';
import { toBitmap } from './label-image-raster';
import { imageLabelZpl } from './zpl-z64';
import type { Deflate } from './zpl-z64';
import rulesSource from '../../firestore.rules?raw';
import agentSource from '../../print-agent/agent.mjs?raw';
import * as legacy from '../../js/print-queue-model.js';

// shared/ has no DOM or Node types; Node 18+ has the Compression Streams as globals.
declare const CompressionStream: new (format: string) => { readable: unknown; writable: unknown };
declare const Blob: new (parts: unknown[]) => { stream(): { pipeThrough(t: unknown): unknown } };
declare const Response: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
const deflate: Deflate = async bytes =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

const T0 = Date.parse('2026-10-26T10:00:00.000Z');
const at = (ms: number): string => new Date(T0 + ms).toISOString();
const agent = (lastSeenAt: string, version?: string) => ({ lastSeenAt, ...(version === undefined ? {} : { version }) });

// A label-sized picture, white with black speckle one dot in `every`: deterministic, and busier than any real label.
function picture(every = 31): ReturnType<typeof toBitmap> {
  const w = 640, h = 480;
  const data = new Uint8Array(w * h).fill(255);
  let x = 7;
  for (let i = 0; i < data.length; i++) {
    if (i > w * 100 && i < w * 140) data[i] = 0;
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    if (x % every === 0) data[i] = 0;
  }
  return toBitmap({ width: w, height: h, data });
}

describe('which road Print takes', () => {
  test('no computer has ever reported: none (the print dialog, nothing said)', () => {
    expect(imageAgentState([], T0)).toBe('none');
    expect(imageAgentState(undefined, T0)).toBe('none');
    expect(imageAgentState('garbage', T0)).toBe('none');
  });

  test('a computer answering with an agent that knows the picture: ready', () => {
    expect(imageAgentState([agent(at(-1000), '1.1.0')], T0)).toBe('ready');
    expect(imageAgentState([agent(at(-STALE_AFTER_MS + 1000), '1.2.0')], T0)).toBe('ready');
    expect(imageAgentState([agent(at(-1000), '2.0.0')], T0)).toBe('ready');
  });

  test('computers that reported once and none answering now: offline', () => {
    expect(imageAgentState([agent(at(-STALE_AFTER_MS - 1), '1.1.0')], T0)).toBe('offline');
    expect(imageAgentState([agent('not a time', '1.1.0')], T0)).toBe('offline');
    // ⚠️ A clock in the future is no answer, exactly as on the standard label.
    expect(imageAgentState([agent(at(HEARTBEAT_MS + 1000), '1.1.0')], T0)).toBe('offline');
  });

  test('answering, but every agent too old to print a picture: outdated (it would refuse the job)', () => {
    expect(imageAgentState([agent(at(-1000), '1.0.1')], T0)).toBe('outdated');
    expect(imageAgentState([agent(at(-1000))], T0)).toBe('outdated');
    expect(imageAgentState([agent(at(-1000), 'nonsense')], T0)).toBe('outdated');
  });

  test('ONE old computer answering is enough to keep the queue off: it would take some of the jobs and refuse them', () => {
    expect(imageAgentState([agent(at(-1000), '1.0.1'), agent(at(-2000), '1.1.0')], T0)).toBe('outdated');
    expect(imageAgentState([agent(at(-1000), '1.2.0'), agent(at(-2000), '1.1.0')], T0)).toBe('ready');
    // A stale old computer is not answering, so it takes nothing: the new one alone decides.
    expect(imageAgentState([agent(at(-STALE_AFTER_MS - 1), '1.0.1'), agent(at(-2000), '1.1.0')], T0)).toBe('ready');
    expect(imageAgentState([agent(at(-1000), '1.0.1'), agent(at(-STALE_AFTER_MS - 1), '1.1.0')], T0)).toBe('outdated');
  });

  test('versions are compared number by number', () => {
    expect(versionAtLeast('1.10.0', '1.9.2')).toBe(true);
    expect(versionAtLeast('1.1.0', '1.1.0')).toBe(true);
    expect(versionAtLeast('1.0.9', '1.1.0')).toBe(false);
    expect(versionAtLeast('0.9.9', '1.1.0')).toBe(false);
    for (const odd of [undefined, null, 1.1, '1.1', '1.1.0-beta', '', 'v1.1.0']) expect(versionAtLeast(odd, '1.1.0')).toBe(false);
  });

  test('the version asked for is the agent’s own (print-agent/agent.mjs)', () => {
    const m = /const VERSION = '(\d+\.\d+\.\d+)'/.exec(agentSource);
    expect(m, 'the agent no longer declares its version where this test reads it').not.toBeNull();
    expect(versionAtLeast((m as RegExpExecArray)[1], IMAGE_AGENT_VERSION)).toBe(true);
  });
});

describe('the job it queues', () => {
  test('every image label is a job the shop computer’s agent accepts — turned round or not, any copies', async () => {
    const bitmap = picture();
    for (const rotate180 of [true, false]) {
      for (const copies of [1, 3, 99]) {
        const payload = await imageLabelZpl(bitmap, { copies, rotate180 }, deflate);
        const name = `${rotate180 ? 'turned' : 'upright'} · ${copies}`;
        expect(isSingleLabel(payload), name).toBe(true);
        expect(legacy.isSingleLabel(payload), `${name} (the agent’s own check)`).toBe(true);
        const job = imageLabelJob({ payload, copies, createdBy: 'uid1', bakery: 'main', now: T0 });
        expect(job, name).toStrictEqual({
          bakery: 'main', status: 'queued', payload, copies, createdAt: at(0), createdBy: 'uid1',
        });
      }
    }
  });

  test('the copies are the same number in the job and in the payload, or there is no job', async () => {
    const payload = await imageLabelZpl(picture(), { copies: 3, rotate180: true }, deflate);
    expect(imageLabelJob({ payload, copies: 2, createdBy: 'u', bakery: 'b', now: T0 })).toBeNull();
    expect(imageLabelJob({ payload: payload.replace('^PQ3\n', ''), copies: 1, createdBy: 'u', bakery: 'b', now: T0 })).toBeNull();
  });

  test('nothing the agent would refuse is ever queued, and nobody unnamed queues anything', async () => {
    const payload = await imageLabelZpl(picture(), { copies: 1, rotate180: true }, deflate);
    const base = { copies: 1, createdBy: 'u', bakery: 'b', now: T0 };
    expect(imageLabelJob({ ...base, payload: `~SD28\n${payload}` }), 'the darkness belongs to the agent').toBeNull();
    expect(imageLabelJob({ ...base, payload: payload.replace('^POI', '^POR') })).toBeNull();
    expect(imageLabelJob({ ...base, payload: '' })).toBeNull();
    expect(imageLabelJob({ ...base, payload, createdBy: undefined })).toBeNull();
    expect(imageLabelJob({ ...base, payload, bakery: '' })).toBeNull();
  });

  // ⚠️ MEASURED, NOT ASSUMED (image labels 1b, 26 Oct 2026): the queue's 20 000 characters were kept because a label far
  // busier than any real one stays well under them. A real label (its text and logo) measured 2 700–7 200 on 25 Oct.
  test('a label far busier than a real one stays well under the queue’s limit, which stays the rules’ own number', async () => {
    for (const every of [97, 31, 5]) {
      const payload = await imageLabelZpl(picture(every), { copies: 99, rotate180: true }, deflate);
      expect(payload.length, `speckle 1 in ${every}`).toBeLessThan(MAX_JOB_CHARS / 2);
    }
    expect(rulesSource).toMatch(new RegExp(`payload\\.size\\(\\) <= ${MAX_JOB_CHARS}\\b`));
  });
});
