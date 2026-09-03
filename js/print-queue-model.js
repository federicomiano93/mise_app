// print-queue-model.js — the rules of a print queue: what a job may become, when a
// printer counts as absent, and when a job is old enough to throw away.
// PURE, zero imports, asserted under Node (P15).
//
// ⚠️ IT LIVES IN js/ ROOT, LIKE price-model.js AND venue-features.js, because TWO
// PROGRAMS READ IT: the app writes jobs and the agent on the shop computer takes
// them. Both halves must agree about what «claimed» means, or two agents print the
// same label twice or none at all.
//
// ⚠️⚠️ AND UNLIKE functions/push-model.js THERE IS NO SECOND COPY OF THIS FILE.
// That duplicate exists because a deploy uploads only functions/, so the server
// cannot import from js/. The print agent has no such excuse: it runs from a
// checkout of this repository, on the shop computer, and imports this file
// directly. This project calls that duplicate its most dangerous, precisely
// because nothing you can do with the app reveals that the halves have parted —
// so the moment somebody proposes copying this file into print-agent/, the
// answer is no, and the reason is written here.

// ── What a job is ────────────────────────────────────────────────────────────

export const JOB_STATES = Object.freeze(['queued', 'claimed', 'done', 'failed']);

// ⚠️ THE ONLY MOVES A JOB MAY MAKE. Anything else is refused by the rules as well
// as here — the app can be an old build on somebody's phone, and the agent is a
// program on a computer nobody watches.
const MOVES = Object.freeze({
  queued: ['claimed'],
  // An agent that took a job and then found the printer switched off has to be able
  // to say so, and it must not be able to put the job back for another agent to
  // take: printing twice is worse than not printing.
  claimed: ['done', 'failed'],
  done: [],
  failed: [],
});

export function canMove(from, to) {
  if (!JOB_STATES.includes(from) || !JOB_STATES.includes(to)) return false;
  return MOVES[from].includes(to);
}

// The largest ZPL job worth carrying. A label is a few hundred bytes; this is
// generous by two orders of magnitude and still nowhere near Firestore's 1 MB
// document ceiling, so a runaway generator cannot fill the database.
export const MAX_JOB_CHARS = 20000;

// ⚠️ A JOB IS BUILT IN ONE PLACE so the app and the rules describe the same
// document. Returns null when there is nothing worth queueing — an empty job that
// reaches the agent is a sheet of blank paper.
export function buildJob({ payload, copies = 1, createdBy, bakery, now }) {
  const text = typeof payload === 'string' ? payload : '';
  if (!text.trim()) return null;
  if (text.length > MAX_JOB_CHARS) return null;
  if (!createdBy || !bakery) return null;
  return {
    bakery,
    status: 'queued',
    payload: text,
    copies: clampCopies(copies),
    createdAt: iso(now),
    createdBy: String(createdBy),
  };
}

function clampCopies(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, 99);
}

function iso(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ── Is the printer there? ────────────────────────────────────────────────────
//
// ⚠️⚠️ THE PHONE MUST BE TOLD, NOT LEFT TO GUESS (P17). Somebody at the counter who
// taps Print and sees nothing happen has no way to tell a slow network from a
// computer that was switched off last night. The agent writes a heartbeat; the
// screen reads it and says so BEFORE anybody taps.
//
// The beat is slow on purpose. Every 4 minutes is ~360 writes a day against a free
// allowance of 20 000 — stated as a number rather than as «it is cheap», because
// P14 asks for the number.
export const HEARTBEAT_MS = 4 * 60 * 1000;

// ⚠️ THREE BEATS, NOT ONE. A single missed beat is a laptop lid, a Wi-Fi hiccup or
// a Windows update — telling somebody their printer is gone every time one packet
// is late teaches them to ignore the warning, which is worse than not showing it.
export const STALE_AFTER_MS = HEARTBEAT_MS * 3;

export function isStale(lastSeenAt, now = Date.now(), staleAfterMs = STALE_AFTER_MS) {
  const seen = Date.parse(lastSeenAt);
  // ⚠️ A HEARTBEAT NOBODY HAS EVER WRITTEN IS «ABSENT», NEVER «FINE». An agent that
  // has not started yet and one that never will look identical from here, and the
  // safe reading of both is that nothing is listening.
  if (!Number.isFinite(seen)) return true;
  return (now - seen) > staleAfterMs;
}

// The one answer the screen shows: which agent, if any, is listening.
//
// ⚠️ A CLOCK ON A SHOP COMPUTER CAN BE WRONG, and a heartbeat stamped in the future
// would look permanently fresh. Anything more than one beat ahead of now is treated
// as no answer at all rather than as a very good one.
export function printerPresence(agents, now = Date.now()) {
  const list = Array.isArray(agents) ? agents : [];
  const live = list.filter((a) => {
    if (!a || typeof a.lastSeenAt !== 'string') return false;
    const seen = Date.parse(a.lastSeenAt);
    if (!Number.isFinite(seen)) return false;
    if (seen - now > HEARTBEAT_MS) return false;
    return !isStale(a.lastSeenAt, now);
  });
  return { ready: live.length > 0, agents: live.length };
}

// ── Throwing jobs away ───────────────────────────────────────────────────────
//
// ⚠️ AN UNBOUNDED QUEUE IS UNBOUNDED READS (P14/P13). The agent deletes what it
// prints; this is what catches the rest — a job created while the computer was off,
// or one an agent claimed and then died holding.
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;

// ⚠️ A CLAIMED JOB IS RECLAIMED LATER THAN A QUEUED ONE IS DROPPED, and never
// re-queued. If the agent died mid-print the paper may already be out; putting the
// job back would print it twice, and two identical allergen labels is a smaller
// harm than one missing but still a wrong count on a shelf.
export function expiredJobs(jobs, now = Date.now(), ttlMs = JOB_TTL_MS) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => {
    if (!job || !JOB_STATES.includes(job.status)) return false;
    if (job.status === 'done' || job.status === 'failed') return true;
    const made = Date.parse(job.createdAt);
    if (!Number.isFinite(made)) return true;   // a job with no date can never age out otherwise
    return (now - made) > ttlMs;
  });
}

// Which job an agent should take next: the oldest one nobody has claimed.
//
// ⚠️ OLDEST FIRST, and by the field rather than by document id. Firestore refuses
// orderBy(documentId(), 'desc') outright, and a random-id ordering is not an
// ordering at all — the label somebody asked for first must come out first.
export function nextJob(jobs, now = Date.now(), ttlMs = JOB_TTL_MS) {
  const waiting = (Array.isArray(jobs) ? jobs : []).filter((job) => {
    if (!job || job.status !== 'queued') return false;
    const made = Date.parse(job.createdAt);
    if (!Number.isFinite(made)) return false;
    return (now - made) <= ttlMs;      // never print something from last week
  });
  waiting.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return waiting[0] || null;
}
