// retention.js — every night, delete the records the owner decided are kept no longer
// (UK/EU GDPR, his decision of 18 Nov 2026). WHAT goes and WHEN is retention-model.js; this
// file only reads, asks the model, deletes and logs.
//
// ⚠️ IT SHIPS DELETING NOTHING. Every kind is off in ENABLED (retention-model.js): the function
// still runs the queries every night and logs, per kind, how many records it WOULD delete and how
// many it skipped. The owner reads a week of those lines in production before switching any kind
// on, one line at a time.
//
// ⚠️ SAFETY, each pinned by tests/retention-model.test.mjs or tests/rules/retention-check.mjs:
//   • a record whose date cannot be read is never deleted (the model says 'skip');
//   • at most CAP deletions per kind per night, then that kind stops and logs an error;
//   • a delete carries the record's last update time as a precondition, so a record that changed
//     between the read and the delete (a phone refreshing its token at 3:30) is left alone — and,
//     a batch being all-or-nothing, so is the rest of its batch: that venue is reported as failed
//     for the kind and the next night tries again;
//   • one kind (or one venue) failing never stops the others;
//   • the logs carry counts, kind names and venue ids — never a name, an email, a uid, a token
//     or anything else from inside a record. Error lines carry the error CODE only: a Firestore
//     message names the document path, and an fcm-tokens path IS a phone's token.
//
// ⚠️ ONE RANGE FILTER PER QUERY, PER VENUE: `field < cutoff` on locations/{lid}/<collection>,
// ordered by the same field. That needs only the single-field index Firestore builds by itself —
// no collection-group index, no composite index, nothing to deploy beside the function. Every
// other condition (a print job's status, the strict date checks) is applied here in code.
// A range filter only matches values of the cutoff's own TYPE, so a record whose date is missing
// or of another type is never even returned: it can be neither deleted nor counted.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { KINDS, ENABLED, CAP, BATCH_SIZE, cutoffFor, decide, chunks } from './retention-model.js';

// Documents read per page, and the most read for one kind in one night (a collection full of
// unreadable dates must not turn into an unbounded read bill every night).
const PAGE = 500;
const MAX_READS = 5000;

function queryValue(spec, now) {
  const cutoff = cutoffFor(spec, now);
  return spec.type === 'timestamp' ? Timestamp.fromMillis(cutoff) : cutoff;
}

function errorCode(err) {
  const code = err && err.code;
  return code === undefined || code === null ? 'unknown' : String(code);
}

// One kind in one venue, page by page, oldest first. `state` is shared across the kind's venues
// so the cap and the read budget count the whole night, not each venue.
// `counts` is the caller's, filled in place, so a venue that fails half-way still reports the
// pages (and the deletions) it got through.
async function sweepVenue(db, lid, spec, now, enabled, cap, state, counts) {
  const base = db.collection(`locations/${lid}/${spec.collection}`)
    .where(spec.field, '<', queryValue(spec, now))
    .orderBy(spec.field);
  let last = null;
  while (!state.capped && state.reads < MAX_READS) {
    const page = await (last ? base.startAfter(last) : base).limit(Math.min(PAGE, MAX_READS - state.reads)).get();
    if (page.empty) break;
    state.reads += page.size;
    last = page.docs[page.docs.length - 1];

    const doomed = [];
    for (const snap of page.docs) {
      const verdict = decide(spec, snap.data(), now);
      if (verdict === 'skip') counts.skipped += 1;
      else if (verdict === 'keep') counts.kept += 1;
      else {
        doomed.push(snap);
        counts.wouldDelete += 1;
        state.wouldDelete += 1;
        if (state.wouldDelete >= cap) {
          state.capped = true;
          break;
        }
      }
    }

    if (enabled) {
      for (const group of chunks(doomed, BATCH_SIZE)) {
        const batch = db.batch();
        for (const snap of group) batch.delete(snap.ref, { lastUpdateTime: snap.updateTime });
        await batch.commit();
        counts.deleted += group.length;
      }
    }
    if (page.size < PAGE) break;
  }
}

// One kind across every venue. Never throws: a venue that fails is logged and counted, and the
// sweep goes on to the next venue.
async function sweepKind(db, venues, spec, now, enabled, cap, log) {
  const state = { wouldDelete: 0, reads: 0, capped: false };
  const total = { wouldDelete: 0, deleted: 0, kept: 0, skipped: 0 };
  const byVenue = {};
  const failedVenues = [];
  for (const lid of venues) {
    if (state.capped || state.reads >= MAX_READS) break;
    const counts = { wouldDelete: 0, deleted: 0, kept: 0, skipped: 0 };
    try {
      await sweepVenue(db, lid, spec, now, enabled, cap, state, counts);
    } catch (err) {
      failedVenues.push(lid);
      log.error('Retention: a venue failed', { kind: spec.kind, lid, code: errorCode(err) });
    }
    for (const key of Object.keys(total)) total[key] += counts[key];
    if (counts.wouldDelete || counts.skipped) byVenue[lid] = { wouldDelete: counts.wouldDelete, skipped: counts.skipped };
  }
  if (state.capped) {
    // Report-only deletes nothing, so nothing stops and an error alert would fire every night: a warning, and the
    // result's `capped: true` says the count is a floor («cap or more»).
    if (enabled) log.error('Retention: cap reached, this kind stops for tonight', { kind: spec.kind, cap });
    else log.warn('Retention: cap reached in report-only mode, the count is a floor', { kind: spec.kind, cap });
  }
  if (state.reads >= MAX_READS) {
    log.warn('Retention: read budget used up, this kind stops for tonight', { kind: spec.kind, reads: state.reads });
  }
  const result = {
    kind: spec.kind,
    mode: enabled ? 'delete' : 'report-only',
    ...total,
    capped: state.capped,
    failedVenues,
    byVenue,
  };
  log.info('Retention', result);
  return result;
}

// The whole night. Everything is injectable so the emulator test can run it with a fixed clock,
// every kind switched on and a small cap; production calls it with no argument.
export async function runRetention({
  db = getFirestore(),
  now = Date.now(),
  enabled = ENABLED,
  cap = CAP,
  kinds = KINDS,
  log = logger,
} = {}) {
  // listDocuments, not get(): the ids are all that is needed, never a venue's fields.
  const venues = (await db.collection('locations').listDocuments()).map(ref => ref.id);
  const results = [];
  for (const spec of kinds) {
    try {
      results.push(await sweepKind(db, venues, spec, now, enabled[spec.kind] === true, cap, log));
    } catch (err) {
      log.error('Retention: a kind failed', { kind: spec.kind, code: errorCode(err) });
      results.push({ kind: spec.kind, failed: true });
    }
  }
  return results;
}

// 03:30 on the owner's clock: after the last late order list, before the first early shift.
// Same region as every other function (index.js REGION).
export const retention = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'Europe/London', region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    await runRetention();
  },
);
