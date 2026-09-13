// away-screen.js — the "I am on holiday" control, and everything that reads or ends it.
//
// It lives in the Home's Settings screen, beside Log out, because it is a fact about
// the PERSON rather than about the venue. The Home's band and its once-a-day reminder
// (js/home-away.js) read and end the same holiday through the exports below.
//
// ⚠️ THE DATE PICKER IS THE PLATFORM'S OWN (`<input type="date">`), on purpose
// (P19). A hand-rolled calendar is one of the things this project's rules name as
// notoriously fragile to build by hand, and the phone's own picker is the one
// every person already knows how to use — including its language and its idea of
// which day a week starts on.

import { t, localeTag } from './i18n.js';
import { confirmDialog } from './confirm-dialog.js';
import { currentSession } from './firebase.js';
import { buildAwayDoc, isAway, maxAwayDate, toISODate } from './away-model.js';
import { dayFromISO } from './away-reminder.js';
import { getAwayDaysOnce, saveAwayDay } from './orders/firebase-orders.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The dialog: one date, and a way back from it.
//
// ⚠️ IT SAYS WHAT BEING AWAY DOES AND WHAT IT DOES NOT. "Your phone stops
// ringing; the lists still arrive and are still waiting for you." Without that
// line somebody reasonably assumes the work is being handled by somebody else,
// which is the one belief this feature must never create.
async function askUntil(current) {
  const wrap = el('div', 'away-form');
  wrap.appendChild(el('p', 'away-what', t('away.whatItDoes')));

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'away-date';
  input.min = toISODate(Date.now());
  // ⚠️ The ceiling is a property of the CONTROL, not an error afterwards: a
  // picker that cannot reach 2028 is kinder than one that refuses it later.
  input.max = maxAwayDate(Date.now());
  if (current) input.value = current;
  input.setAttribute('aria-label', t('away.untilLabel'));
  wrap.appendChild(el('label', 'away-label', t('away.untilLabel')));
  wrap.appendChild(input);

  const ok = await confirmDialog({
    title: t('away.title'),
    node: wrap,
    message: '',
    okLabel: t('away.set'),
    cancelLabel: t('ui.cancel'),
  });
  return ok ? input.value : null;
}

// This person's holiday right now: `{ uid, mine, away }`, or null when nobody is signed
// in to have one.
export async function readMyAway() {
  const { user } = currentSession();
  if (!user?.uid) return null;

  let mine = null;
  try {
    // ⚠️ READ ONCE, not a live listener: this screen is opened many times a day
    // on every phone and the answer changes about twice a year (P14).
    const all = await getAwayDaysOnce();
    mine = all.find(d => d.id === user.uid) || null;
  } catch (err) {
    // A venue that has never used this, or an offline phone. The button still
    // works — it simply starts from nothing.
    console.warn('Could not read your own holiday:', err);
  }
  return { uid: user.uid, mine, away: isAway(mine, Date.now()) };
}

// «16 September» / «16 settembre», in the language the screen speaks. The stored
// 2026-09-16 is for machines; until 13 Sep 2026 people were shown exactly that.
export function awayDayLabel(until) {
  const day = dayFromISO(until);
  return day ? day.toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' }) : String(until || '');
}

// Ending a holiday early, asked once.
//
// ⚠️ COMING BACK IS ONE TAP AND IS NOT A DESTRUCTIVE ACT — no danger red, no warning.
// The whole point is that it ends easily and by itself.
export async function askComeBack(state) {
  if (!state?.away) return;
  const back = await confirmDialog({
    title: t('away.backTitle'),
    message: t('away.backMessage', { day: awayDayLabel(state.mine.until) }),
    okLabel: t('away.back'),
    cancelLabel: t('ui.cancel'),
  });
  if (back) await comeBack(state.uid);
}

// ⚠️ ASKS NOTHING — its callers already have: askComeBack above, or the once-a-day
// reminder in js/home-away.js whose own button says «I am back».
export async function comeBack(uid) {
  await write(uid, '');
}

// The Settings row. Returns the button, or null when there is nobody to be.
export async function buildAwayButton() {
  const state = await readMyAway();
  if (!state) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'session-logout' + (state.away ? ' session-away' : '');
  btn.textContent = state.away ? t('away.onUntil', { day: awayDayLabel(state.mine.until) }) : t('away.title');

  btn.addEventListener('click', async () => {
    if (state.away) {
      await askComeBack(state);
      return;
    }
    const until = await askUntil('');
    if (!until) return;
    await write(state.uid, until);
  });

  return btn;
}

async function write(uid, until) {
  const doc = buildAwayDoc({ uid, until, now: Date.now() });
  if (!doc) {
    await confirmDialog({
      title: t('away.title'), message: t('away.badDate'),
      okLabel: t('ui.cancel'), cancelLabel: null,
    });
    return;
  }
  try {
    await saveAwayDay(uid, doc);
    // Rebuilt rather than patched, so the button's words and the stored fact
    // cannot drift apart.
    window.dispatchEvent(new CustomEvent('away-changed'));
  } catch (err) {
    console.error('Saving the holiday failed:', err);
    await confirmDialog({
      title: t('away.title'), message: t('away.saveFailed'),
      okLabel: t('ui.cancel'), cancelLabel: null,
    });
  }
}
