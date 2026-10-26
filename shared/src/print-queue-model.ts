// print-queue-model.ts — the rules of a print queue: what a job may become, when a printer counts as absent, and
// when a job is old enough to throw away. A faithful port of js/print-queue-model.js (step 3d-4), pinned against
// it by print-queue-model.spec.ts. PURE, no imports.
//
// ⚠️ THE ORIGINAL STAYS, AND IS NOT TO BE EDITED OR COPIED. print-agent/agent.mjs, a program on the shop
// computer, imports js/print-queue-model.js directly: the app writes jobs and the agent takes them, and both
// halves must agree about what «claimed» means, or two agents print the same label twice or none at all. This
// port is the app's half; the cross-check spec is what keeps the two from parting, because nothing you can do
// with the app would reveal it.

// ── What a job is ────────────────────────────────────────────────────────────

export const JOB_STATES = Object.freeze(['queued', 'claimed', 'done', 'failed'] as const);
export type JobState = (typeof JOB_STATES)[number];

// ⚠️ THE ONLY MOVES A JOB MAY MAKE. Anything else is refused by the rules as well as here — the app can be an
// old build on somebody's phone, and the agent is a program on a computer nobody watches.
const MOVES: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  queued: ['claimed'],
  // An agent that took a job and then found the printer switched off has to be able to say so, and it must not
  // be able to put the job back for another agent to take: printing twice is worse than not printing.
  claimed: ['done', 'failed'],
  done: [],
  failed: [],
});

const isState = (value: unknown): value is JobState => (JOB_STATES as readonly unknown[]).includes(value);

export function canMove(from: unknown, to: unknown): boolean {
  if (!isState(from) || !isState(to)) return false;
  return MOVES[from].includes(to);
}

// The largest ZPL job worth carrying. A label is a few hundred bytes; this is generous by two orders of
// magnitude and still nowhere near Firestore's 1 MB document ceiling, so a runaway generator cannot fill the
// database.
export const MAX_JOB_CHARS = 20000;

// The most copies one job may print: the ceiling firestore.rules puts on `copies`.
export const MAX_COPIES = 99;

export interface PrintJob {
  bakery: string;
  status: 'queued';
  payload: string;
  copies: number;
  createdAt: string;
  createdBy: string;
}

// ⚠️ A JOB IS BUILT IN ONE PLACE so the app and the rules describe the same document. Returns null when there is
// nothing worth queueing — an empty job that reaches the agent is a sheet of blank paper.
export function buildJob({ payload, copies = 1, createdBy, bakery, now }: {
  payload?: unknown; copies?: unknown; createdBy?: unknown; bakery?: unknown; now?: unknown;
}): PrintJob | null {
  const text = typeof payload === 'string' ? payload : '';
  if (!text.trim()) return null;
  if (text.length > MAX_JOB_CHARS) return null;
  if (!createdBy || !bakery) return null;
  return {
    bakery: bakery as string,
    status: 'queued',
    payload: text,
    copies: clampCopies(copies),
    createdAt: iso(now),
    createdBy: String(createdBy),
  };
}

// ── Is it a label, and only a label? ─────────────────────────────────────────
//
// ⚠️⚠️ THE AGENT USED TO SEND WHATEVER THE QUEUE HELD (security audit, 23 Sep 2026). Every member may queue a
// job, and a ZPL printer obeys more than labels: `~JR` resets it, `^JUS` saves settings over the ones it was set
// up with, `^CC` changes which character starts a command. So the agent prints only a payload shaped like the
// labels this app makes (label-zpl.ts): ONE ^XA … ^XZ, built from the commands below and nothing else.
//
// ⚠️ NO TILDE ANYWHERE, AND THAT COSTS NO LABEL ANYTHING: label-zpl writes every ^, ~ and _ in a product's text
// as its hex code, so a tilde in the job can only be a control command. For the same reason every ^ in the job
// begins a command.
//
// ⚠️ GF, PO AND PR ARE THE IMAGE LABEL'S (zpl-z64.ts), and each is let through in the ONE shape that label writes and
// no other (SHAPES below): a ^GF that is not `A` + Z64 could be hex or raw bytes the printer reads as it pleases, and a
// ^PO or ^PR with anything after its digits is not something the app wrote.
export const LABEL_COMMANDS: readonly string[] = Object.freeze([
  'XA', 'XZ', 'CI', 'PW', 'LL', 'LH', 'LT', 'FO', 'A0', 'FB', 'FH', 'FD', 'FS', 'PQ',
  'GF', 'PO', 'PR',
]);

// What may follow each of those three, up to the next ^ (a Z64 field has no ^ in it: Base64, digits and colons only).
// Read the way a printer reads it, case aside.
const SHAPES: readonly (readonly [RegExp, RegExp])[] = Object.freeze([
  [/\^GF([^^]*)/gi, /^A,\d{1,6},\d{1,6},\d{1,4},:Z64:[A-Za-z0-9+/]+={0,2}:[0-9A-F]{4}$/i],
  [/\^PO([^^]*)/gi, /^[NI]$/i],
  [/\^PR([^^]*)/gi, /^\d{1,2}(,\d{1,2}){0,2}$/],
] as const);

export function isSingleLabel(payload: unknown): boolean {
  if (typeof payload !== 'string' || payload.length > MAX_JOB_CHARS) return false;
  const text = payload.trim();
  if (!text.startsWith('^XA') || !text.endsWith('^XZ')) return false;
  if (text.includes('~')) return false;
  // Every command, read the way a printer reads it: case does not protect anything.
  const commands: string[] = [];
  for (let i = text.indexOf('^'); i !== -1; i = text.indexOf('^', i + 1)) {
    commands.push(text.slice(i + 1, i + 3).toUpperCase());
  }
  if (commands.filter(c => c === 'XA').length !== 1) return false;
  if (commands.filter(c => c === 'XZ').length !== 1) return false;
  if (!commands.every(c => LABEL_COMMANDS.includes(c))) return false;
  for (const [command, shape] of SHAPES) {
    for (const m of text.matchAll(command)) {
      if (!shape.test((m[1] ?? '').trim())) return false;
    }
  }
  // ⚠️ AND NO MORE COPIES THAN A JOB MAY ASK FOR (code review, 23 Sep 2026). ^PQ is on the list because a label
  // for three loaves asks for three, but `^PQ99999` would run a whole roll through the printer. The same ceiling
  // the rules put on `copies`.
  const copies = [...text.matchAll(/\^PQ(\d*)/gi)].map(m => Number(m[1]));
  return copies.length <= 1 && copies.every(n => Number.isInteger(n) && n >= 1 && n <= MAX_COPIES);
}

function clampCopies(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, 99);
}

function iso(now: unknown): string {
  const d = now instanceof Date ? now : new Date((now as number | string | undefined) || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ── Is the printer there? ────────────────────────────────────────────────────
//
// ⚠️⚠️ THE PHONE MUST BE TOLD, NOT LEFT TO GUESS (P17). Somebody at the counter who taps Print and sees nothing
// happen has no way to tell a slow network from a computer that was switched off last night. The agent writes a
// heartbeat; the screen reads it and says so BEFORE anybody taps.
//
// The beat is slow on purpose. Every 4 minutes is ~360 writes a day against a free allowance of 20 000 — stated
// as a number rather than as «it is cheap», because P14 asks for the number.
export const HEARTBEAT_MS = 4 * 60 * 1000;

// ⚠️ THREE BEATS, NOT ONE. A single missed beat is a laptop lid, a Wi-Fi hiccup or a Windows update — telling
// somebody their printer is gone every time one packet is late teaches them to ignore the warning, which is
// worse than not showing it.
export const STALE_AFTER_MS = HEARTBEAT_MS * 3;

export function isStale(lastSeenAt: unknown, now: number = Date.now(), staleAfterMs: number = STALE_AFTER_MS): boolean {
  const seen = Date.parse(lastSeenAt as string);
  // ⚠️ A HEARTBEAT NOBODY HAS EVER WRITTEN IS «ABSENT», NEVER «FINE». An agent that has not started yet and one
  // that never will look identical from here, and the safe reading of both is that nothing is listening.
  if (!Number.isFinite(seen)) return true;
  return (now - seen) > staleAfterMs;
}

// The one answer the screen shows: which agent, if any, is listening.
//
// ⚠️ A CLOCK ON A SHOP COMPUTER CAN BE WRONG, and a heartbeat stamped in the future would look permanently
// fresh. Anything more than one beat ahead of now is treated as no answer at all rather than as a very good one.
export function printerPresence(agents: unknown, now: number = Date.now()): { ready: boolean; agents: number } {
  const list: unknown[] = Array.isArray(agents) ? agents : [];
  const live = list.filter((a) => {
    const lastSeenAt = a ? (a as { lastSeenAt?: unknown }).lastSeenAt : undefined;
    if (typeof lastSeenAt !== 'string') return false;
    const seen = Date.parse(lastSeenAt);
    if (!Number.isFinite(seen)) return false;
    if (seen - now > HEARTBEAT_MS) return false;
    return !isStale(lastSeenAt, now);
  });
  return { ready: live.length > 0, agents: live.length };
}

// ── Throwing jobs away ───────────────────────────────────────────────────────
//
// ⚠️ AN UNBOUNDED QUEUE IS UNBOUNDED READS (P14/P13). The agent deletes what it prints; this is what catches the
// rest — a job created while the computer was off, or one an agent claimed and then died holding.
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;

interface JobLike {
  status?: unknown;
  createdAt?: unknown;
}

// ⚠️ A CLAIMED JOB IS RECLAIMED LATER THAN A QUEUED ONE IS DROPPED, and never re-queued. If the agent died
// mid-print the paper may already be out; putting the job back would print it twice, and two identical allergen
// labels is a smaller harm than one missing but still a wrong count on a shelf.
export function expiredJobs<T>(jobs: readonly T[] | null | undefined, now: number = Date.now(), ttlMs: number = JOB_TTL_MS): T[] {
  return (Array.isArray(jobs) ? jobs : []).filter((item) => {
    const job = item as JobLike | null | undefined;
    if (!job || !isState(job.status)) return false;
    if (job.status === 'done' || job.status === 'failed') return true;
    const made = Date.parse(job.createdAt as string);
    if (!Number.isFinite(made)) return true;   // a job with no date can never age out otherwise
    return (now - made) > ttlMs;
  });
}

// Which job an agent should take next: the oldest one nobody has claimed.
//
// ⚠️ OLDEST FIRST, and by the field rather than by document id. Firestore refuses orderBy(documentId(), 'desc')
// outright, and a random-id ordering is not an ordering at all — the label somebody asked for first must come
// out first.
export function nextJob<T>(jobs: readonly T[] | null | undefined, now: number = Date.now(), ttlMs: number = JOB_TTL_MS): T | null {
  const waiting = (Array.isArray(jobs) ? jobs : []).filter((item) => {
    const job = item as JobLike | null | undefined;
    if (!job || job.status !== 'queued') return false;
    const made = Date.parse(job.createdAt as string);
    if (!Number.isFinite(made)) return false;
    return (now - made) <= ttlMs;      // never print something from last week
  });
  waiting.sort((a, b) => Date.parse((a as JobLike).createdAt as string) - Date.parse((b as JobLike).createdAt as string));
  return waiting[0] || null;
}
