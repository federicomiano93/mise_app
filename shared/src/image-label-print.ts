// image-label-print.ts — how the «with logo» label reaches paper: which road its Print button takes, and the job it puts
// in the print queue. NEW IN MISE 2 (no original in js/), so not paired; PURE, no DOM.
//
// ⚠️⚠️ THE ROAD IS THE SHOP COMPUTER'S HEARTBEAT, NOT THE VENUE'S PRINTER SETTING. The standard label asks the venue
// whether its printer is a Zebra (config/labels `printerLanguage`); the image label IS a Zebra label (640 × 480 dots at
// 203 dpi, ^GFA Z64), and its settings screen hides that card. So the only question is whether a computer that can
// print it is listening RIGHT NOW:
//   'ready'    a computer answered within the stale limit with an agent that knows the image label → the queue;
//   'outdated' computers are answering, but every one runs an agent older than IMAGE_AGENT_VERSION, which would refuse
//              the picture as «not a single label» → the print dialog, and the screen says the program needs updating;
//   'offline'  computers reported once and none is answering now → the print dialog, and the screen says so;
//   'none'     no computer has ever reported → the print dialog and nothing said (a venue printing through the system
//              dialog must not be told every day about a computer it never had).

import { buildJob, isSingleLabel, printerPresence } from './print-queue-model';
import type { PrintJob } from './print-queue-model';

// The first agent version whose label filter takes ^GF, ^PO and ^PR (print-agent/agent.mjs `VERSION`).
export const IMAGE_AGENT_VERSION = '1.1.0';

export type ImageAgentState = 'ready' | 'outdated' | 'offline' | 'none';

// «1.10.0» is later than «1.9.2»: compared number by number, never as text. Anything that is not three whole numbers
// is not a version this app wrote, and is read as too old — the safe direction (the dialog still prints).
export function versionAtLeast(version: unknown, minimum: string): boolean {
  const parts = (text: unknown): number[] | null => {
    if (typeof text !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(text)) return null;
    return text.split('.').map(Number);
  };
  const have = parts(version);
  const want = parts(minimum);
  if (have === null || want === null) return false;
  for (let i = 0; i < 3; i++) {
    if ((have[i] as number) !== (want[i] as number)) return (have[i] as number) > (want[i] as number);
  }
  return true;
}

// The heartbeats (print-agents documents) read against `now`. Freshness is printerPresence's own judgement, one
// document at a time, so a clock in the future or a stale beat means here what it means on the standard label.
export function imageAgentState(agents: unknown, now: number): ImageAgentState {
  const list: unknown[] = Array.isArray(agents) ? agents : [];
  if (list.length === 0) return 'none';
  const fresh = list.filter(agent => printerPresence([agent], now).ready);
  if (fresh.length === 0) return 'offline';
  const knows = fresh.some(agent => versionAtLeast(agent ? (agent as { version?: unknown }).version : undefined, IMAGE_AGENT_VERSION));
  return knows ? 'ready' : 'outdated';
}

// The job for the queue, or null when there is none worth sending.
//
// ⚠️ CHECKED WITH THE AGENT'S OWN FILTER BEFORE IT IS QUEUED: a job the agent would refuse is never written, because
// the agent can only mark it «failed» in a document nobody on the screen is reading — the person would have been told
// «sent» for a label that will never come out. `copies` is the job's AND the payload's ^PQ, the same number twice, as
// the standard label writes it.
export function imageLabelJob({ payload, copies, createdBy, bakery, now }: {
  payload: string; copies: number; createdBy: unknown; bakery: unknown; now: number;
}): PrintJob | null {
  if (!isSingleLabel(payload)) return null;
  const job = buildJob({ payload, copies, createdBy, bakery, now });
  if (job === null) return null;
  const asked = /\^PQ(\d+)/i.exec(payload);
  if (asked === null || Number(asked[1]) !== job.copies) return null;
  return job;
}
