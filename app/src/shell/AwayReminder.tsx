import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { toISODate } from '@mise/shared/away-model';
import { AWAY_REMINDER_KEY, reminderDue } from '@mise/shared/away-reminder';
import { useT } from '../i18n/useT';
import { useAway, useAwayStore } from './away/AwayContext';
import { awayDayLabel } from './away/awayWords';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { SECTIONS } from './sections';

// The section an address is in, when it is one that can remind: every section but the Home and Settings (they are where a holiday is
// SEEN and ended, so asking there would be asking twice). «More» is not a section, it is a list of them. null for anything else.
function remindingSection(pathname: string): string | null {
  for (const section of SECTIONS) {
    if (section.id === 'home' || section.id === 'settings') continue;
    if (pathname === section.path || pathname.startsWith(`${section.path}/`)) return section.id;
  }
  return null;
}

// The once-a-day holiday reminder (the current app's js/home-away.js `onCardTap`; the owner, 13 Sep 2026: «if I try to do something inside
// the app, the app reminds me I am on holiday, so if I am not any more and forgot to untick it, I untick it»).
//
// ONE PLACE, in the shell, not in every section: while away, the first time each day the person ARRIVES in a section other than the Home and
// Settings — by the rail, the tabs, «More», a door, or by opening the app straight into it — the app asks. The section opens either way:
// the question never blocks the navigation.
//
// ⚠️ MARKED BEFORE ASKING, so a reload in the middle cannot ask twice in one day. Storage that cannot be read reads as «not reminded yet»:
// an extra reminder is the safe mistake, a silent phone after somebody came back is not (shared away-reminder). The key is the current
// app's own and is NOT kept across a venue switch (KEEP_PREFIXES): the reminder simply comes back once, which is the harmless direction.
//
// ⚠️ «I AM BACK» IS THE MAIN BUTTON; «CONTINUE» — and Escape — keep the holiday exactly as it is. The dialog IS the question, so coming back
// from here asks nothing further.
export function AwayReminder() {
  const { t, locale } = useT();
  const { pathname } = useLocation();
  const store = useAwayStore();
  const away = useAway();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const section = remindingSection(pathname);
  // The section this arrival has already been judged for: staying in it, or the holiday changing under it, asks nothing new.
  const judged = useRef<string | null>(null);

  useEffect(() => {
    if (section === null) {
      judged.current = null;
      return;
    }
    // The one read has not answered yet: wait, the arrival is judged when it does.
    if (judged.current === section || away.status !== 'ready') return;
    judged.current = section;
    if (!away.away) return;

    const today = toISODate(Date.now());
    let last: string | null = null;
    try { last = localStorage.getItem(AWAY_REMINDER_KEY); } catch { /* storage that cannot be read: remind */ }
    if (!reminderDue(true, last, today)) return;
    try { localStorage.setItem(AWAY_REMINDER_KEY, today); } catch { /* nowhere to write it: it will ask again, which is the safe direction */ }

    void (async () => {
      const back = await confirm({
        title: t('away.reminder.title'),
        message: t('away.reminder.body', { day: awayDayLabel(away.until, locale) }),
        okLabel: t('away.back'),
        cancelLabel: t('away.reminder.continue'),
      });
      if (!back) return;
      const change = store.comeBack();
      if (change.accepted) {
        void change.saved.then(saved => {
          if (!saved) void alert({ message: t('away.saveFailed'), okLabel: t('common.ok') });
        });
      }
    })();
    // The words and the callbacks are read when the question is asked, not reasons to ask again.
  },[section, away.status, away.away]);

  return (
    <>
      {confirmDialog}
      {alertDialog}
    </>
  );
}
