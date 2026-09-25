// unsent-guard.js — "some changes have not reached the server yet".
//
// ⚠️ WHY IT EXISTS. Signing out and switching venue now clear this phone's offline
// copy of the data (security audit, 23 Sep 2026) — and that copy is also where a
// change made with no signal waits to be sent. Clearing it without a word would throw
// somebody's work away, which is the one thing this app promises never to do (P20).
// So before either, the database is asked whether anything is still waiting, and if
// something is, the person is told and may stay.
//
// ⚠️ confirmDialog IS HANDED IN rather than imported: each part of the app carries its
// own copy of confirm-dialog.js, and the caller already holds the right one.

import { t } from './i18n.js';
import { changesStillWaiting } from './firebase.js';

// True when it is safe to go on: nothing is waiting, or the person chose to go anyway.
export async function mayLeaveWithUnsent(confirmDialog) {
  if (!await changesStillWaiting()) return true;
  return confirmDialog({
    title: t('unsent.title'),
    message: t('unsent.message'),
    okLabel: t('unsent.leave'),
    cancelLabel: t('unsent.stay'),
    danger: true,
  });
}
