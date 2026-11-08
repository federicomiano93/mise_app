import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { isAway, toISODate } from '@mise/shared/away-model';
import { AWAY_REMINDER_KEY, reminderDue } from '@mise/shared/away-reminder';
import { useT } from '../i18n/useT';
import { useAway, useAwayStore } from './away/AwayContext';
import { awayDayLabel } from './away/awayWords';
import { useConfirm } from '../ui/useConfirm';
import { SECTIONS } from './sections';
import { useTodayKey } from './useTodayKey';
import { useVisibleSections } from './useVisibleSections';

// The section an address is in, when it is one that can remind: every section but the Home and Settings (they are where a holiday is
// SEEN and ended, so asking there would be asking twice), and only one this person is SHOWN — a hidden section's address opens «not
// available», and the current app's reminder came with a card's tap, which a hidden card never gets. «More» is not a section, it is a
// list of them. null for anything else.
function remindingSection(pathname: string, visible: ReadonlySet<string>): string | null {
  for (const section of SECTIONS) {
    if (section.id === 'home' || section.id === 'settings' || !visible.has(section.id)) continue;
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
  const [confirm, confirmDialog, dismiss] = useConfirm();
  const { visible } = useVisibleSections();
  const section = remindingSection(pathname, visible);
  // ⚠️ THE DAY IS WATCHED TOO: somebody sitting in a section when the day changes (or the tablet wakes on a new day) is judged again for
  // the new day, by the same rules.
  const day = useTodayKey();
  // The arrival (section and day) already judged: staying in it, or the holiday changing under it, asks nothing new.
  const judged = useRef<string | null>(null);

  // ⚠️ THE QUESTION CLOSES WHEN THE HOLIDAY IS NO LONGER THERE: a holiday set on a weak signal and then refused is put back while the
  // question is open, and «You are on holiday» must not stay on screen beside «Not saved» (review, 8 Nov 2026).
  useEffect(() => { if (!away.away) dismiss(); }, [away.away, dismiss]);

  useEffect(() => {
    if (section === null) {
      judged.current = null;
      return;
    }
    // The one read has not answered yet: wait, the arrival is judged when it does.
    const arrival = `${section}|${day}`;
    if (judged.current === arrival || away.status !== 'ready') return;
    judged.current = arrival;
    // ⚠️ ASKED OF THE CLOCK HERE, not taken from `away.away`: just after midnight this effect can run before the provider's recheck(), and
    // the store's flag still says «away» for a holiday that ended yesterday (review, 7 Nov 2026).
    if (away.until === null || !isAway({ until: away.until }, Date.now())) return;

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
      // A refusal is said by the shell (AwayRefusalAlert), wherever the person is when it arrives.
      if (back) store.comeBack();
    })();
    // The words and the callbacks are read when the question is asked, not reasons to ask again.
  }, [section, day, away.status, away.away]);

  return (
    <>
      {confirmDialog}
    </>
  );
}
