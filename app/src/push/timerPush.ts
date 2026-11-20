// timerPush.ts — booking a server push for a guided-mix timer, so the phone rings when a step ends with the app closed.
//
// The Mise 2 half of js/push.js `scheduleAlarm` / `cancelAlarm`, with everything injected so each rule is a spec. The server half
// (functions/index.js scheduleTimerPush → a Cloud Task → sendTimerPush) is untouched: it re-reads the document when the task
// fires and sends only while `active === true`, and only to a token that belongs to the timer's uid.
//
// ⚠️ NEVER THROWS, NEVER BLOCKS THE TAP: the countdown has already started when schedule() is called; a notification is a bonus
// for somebody who walks away, and a Start button hanging on the network while a mixer runs would cost the dough. '' is an
// ordinary outcome (notifications off, a timer too short to beat the delivery), not a failure worth reporting.
// ⚠️ BOOKS ONLY FOR A PHONE REGISTERED TO THE PERSON HOLDING IT (`onForMe`): the server rings only a token registered to whoever
// set the timer. Unlike js/push.js nothing is re-registered here: the screen's own button registers, from a tap.
// ⚠️ NOTHING OFFLINE: a write made offline would sit in Firestore's queue and a sign-out would then warn «your changes will be
// lost» about something nobody typed.
// ⚠️ A WRITE CUT OFF BY THE TIME LIMIT STAYS IN FIRESTORE'S QUEUE and may arrive later: harmless (the server checks `active`
// and the caller cancels what it no longer wants), but the id is not remembered, so that late booking cannot be cancelled.
// ⚠️ EVERY BOOKING NEEDS A FRESH ID: the rules refuse an update of anything but `active`, so setDoc on an existing id fails.
// ⚠️ CANCELLING MARKS `active: false`, it never deletes: the server can tell «cancelled» from «could not read».
// ⚠️ A FAILURE LOGS THE ERROR CODE ALONE: a message can name the document path.

import { buildPath } from '@mise/shared/location-id';
import { buildTimerDoc, isSchedulable, isValidTimerDoc } from '@mise/shared/push-model';
import type { KeyValueStorage } from '../session/backend';
import type { FirestoreKit } from '../session/firebaseBackend';
import { errorCode, type TelemetrySession } from '../telemetry/common';
import { PUSH_TOKEN_KEY } from './phoneKeys';
import { WRITE_TIMEOUT_MS, withTimeout } from './phonePush';
import type { PhonePush } from './phonePush';

export interface TimerBooking {
  readonly id: string;
  readonly fireAt: number;
  readonly title: string;
  readonly body: string;
}

export interface TimerPush {
  // Resolves to the id booked, or '' when nothing was booked. Never rejects.
  schedule(booking: TimerBooking): Promise<string>;
  // Best effort, not worth waiting for; never throws.
  cancel(id: string): void;
}

export interface TimerPushDeps {
  readonly phonePush: Pick<PhonePush, 'support' | 'onForMe'>;
  readonly storage: KeyValueStorage | null;
  readonly session: () => TelemetrySession | null | undefined;
  readonly online: () => boolean;
  readonly now: () => number;
  readonly firestore: () => Promise<FirestoreKit>;
  readonly writeTimeoutMs?: number;
}

export function createTimerPush(deps: TimerPushDeps): TimerPush {
  const limit = () => deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS;

  async function schedule({ id, fireAt, title, body }: TimerBooking): Promise<string> {
    try {
      if (!id || id.includes('/')) return '';
      if (deps.phonePush.support() !== 'granted') return '';
      const session = deps.session();
      const lid = session?.locationId;
      const uid = session?.user?.uid;
      if (session?.status !== 'ready' || !lid || !uid) return '';
      if (!deps.phonePush.onForMe(uid)) return '';
      if (!deps.online()) return '';
      const token = deps.storage?.getItem(PUSH_TOKEN_KEY) ?? '';
      if (!token) return '';
      const nowMs = deps.now();
      if (!isSchedulable(fireAt, nowMs)) return '';
      const payload = buildTimerDoc({ uid, token, fireAt, title, body, nowMs });
      if (!isValidTimerDoc(payload, nowMs)) return '';

      await withTimeout((async () => {
        const { fs, db } = await deps.firestore();
        // A create, not a merge: the rules allow a create of exactly these keys.
        await fs.setDoc(fs.doc(db, buildPath(lid, 'push-timers'), id), { bakery: lid, ...payload });
      })(), limit());
      return id;
    } catch (err) {
      console.warn('Could not schedule a notification:', errorCode(err));
      return '';
    }
  }

  function cancel(id: string): void {
    if (!id) return;
    try {
      const lid = deps.session()?.locationId;
      if (!lid) return;
      void withTimeout((async () => {
        const { fs, db } = await deps.firestore();
        await fs.updateDoc(fs.doc(db, buildPath(lid, 'push-timers'), id), { active: false });
      })(), limit()).catch((err: unknown) => {
        // Already gone, offline, or never written: the send-side check is what protects against a phantom buzz.
        console.warn('Could not cancel a scheduled notification:', errorCode(err));
      });
    } catch (err) {
      console.warn('Could not cancel a scheduled notification:', errorCode(err));
    }
  }

  return { schedule, cancel };
}
