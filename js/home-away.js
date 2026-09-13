// home-away.js — the Home's two holiday signals.
//
// Federico, 13 Sep 2026: the bottom of the Home is ONLY «Settings», and a holiday shows
// elsewhere — «quando sono in ferie nella home vedo che sono in ferie, magari se cerco di
// fare qualcosa dentro l'app, l'app mi ricorda che sono in ferie così se non lo sono più
// e ho dimenticato di togliere la spunta la tolgo». Asked, he chose:
//   1. a BAND at the top of the Home while away — where «order to place today» sits —
//      and tapping it is how one comes back;
//   2. a REMINDER the first time a card is opened each day, whose main button is
//      «I am back», because catching a forgotten holiday is its whole job.
//
// The holiday itself — reading it, writing it, the dialogs about it — stays in
// js/away-screen.js; this file only decides when the Home says so.

import { t } from './i18n.js';
import { confirmDialog } from './confirm-dialog.js';
import { readMyAway, awayDayLabel, askComeBack, comeBack } from './away-screen.js';
import { reminderDue, AWAY_REMINDER_KEY } from './away-reminder.js';
import { toISODate } from './away-model.js';

// This person's holiday as last read: `{ uid, mine, away }` or null.
let state = null;
// Which read is the current one — an answer that arrives after a newer read must not
// paint over it.
let readSeq = 0;
let wired = false;

// Read the holiday again and redraw the band. Called when the venue opens and whenever
// the holiday changes (the `away-changed` event js/away-screen.js sends after a write).
export async function refreshAway() {
  const mine = ++readSeq;
  let next = null;
  try {
    next = await readMyAway();
  } catch (err) {
    console.warn('The holiday band is not available:', err);
  }
  if (mine !== readSeq) return;
  state = next;
  paintBand();
}

// ⚠️ A BUTTON, NOT A LINK: tapping it does something HERE (asks «back already?») rather
// than going somewhere. It borrows the holiday colours Orders already uses and the
// place and alignment of the order reminder beside it (#home-reminder).
function paintBand() {
  const host = document.getElementById('home-reminder');
  if (!host) return;
  host.querySelector('.home-away')?.remove();
  if (!state?.away) return;

  const title = document.createElement('div');
  title.className = 'alert-title';
  title.textContent = t('away.onUntil', { day: awayDayLabel(state.mine.until) });
  const body = document.createElement('div');
  body.textContent = t('away.band.body');

  const band = document.createElement('button');
  band.type = 'button';
  band.className = 'alert-banner holiday home-reminder home-away';
  band.append(title, body);
  band.addEventListener('click', () => {
    askComeBack(state).catch(err => console.warn('Could not end the holiday:', err));
  });
  host.prepend(band);
}

// Listen on every card the Home still shows. Once per page: the cards are static and a
// second listener would ask twice.
export function wireAwayReminder() {
  if (wired) return;
  wired = true;
  document.querySelectorAll('.home-card').forEach(card => card.addEventListener('click', onCardTap));
}

async function onCardTap(event) {
  if (!state?.away) return;
  const today = toISODate(Date.now());
  let last = null;
  try { last = localStorage.getItem(AWAY_REMINDER_KEY); } catch { /* private mode: remind */ }
  if (!reminderDue(state.away, last, today)) return;

  // Held back only now, when there really is something to say.
  event.preventDefault();
  const href = event.currentTarget.getAttribute('href');
  // ⚠️ MARKED BEFORE ASKING, so a reload in the middle cannot ask twice in one day.
  try { localStorage.setItem(AWAY_REMINDER_KEY, today); } catch { /* ignore */ }

  // ⚠️ «I AM BACK» IS THE MAIN BUTTON; «CONTINUE» — and Escape, and a tap outside — keep
  // the holiday exactly as it is. The dialog IS the question, so coming back from here
  // asks nothing further.
  const back = await confirmDialog({
    title: t('away.reminder.title'),
    message: t('away.reminder.body', { day: awayDayLabel(state.mine.until) }),
    okLabel: t('away.back'),
    cancelLabel: t('away.reminder.continue'),
  });
  if (back) await comeBack(state.uid);
  // Either way, the card they tapped opens.
  location.href = href;
}
