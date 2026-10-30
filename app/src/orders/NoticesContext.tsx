import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { hiddenAlerts, visibleAlerts } from '@mise/shared/alert-dismissal';
import { todayISO } from '@mise/shared/day';
import { countryOf } from '@mise/shared/market';
import { computeAlerts } from '@mise/shared/notifications';
import type { PendingSupplier } from '@mise/shared/reminders';
import { notForLater } from '@mise/shared/order-day';
import { untoldChanges } from '@mise/shared/untold-changes';
import type { UntoldGroup } from '@mise/shared/untold-changes';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useOrders } from './OrdersContext';
import { notifyOnce, useDismissedNotices } from './calendarNotices';
import { dayTranslate } from './dayWords';
import { noticeText } from './noticeText';
import type { CalendarNotice } from './noticeText';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import { pendingNow, usePendingLatch } from './pendingLatch';
import { useUkHolidays } from './ukHolidays';

// Everything the bell and its panel draw (step 3f-6, parity R3–R12), computed ONCE here so the number on the bell and the panel it
// opens can never disagree. Pure data in, no markup.
export interface Notices {
  readonly open: boolean;
  setOpen(open: boolean): void;
  readonly panelId: string;
  // The bell, in the page's title line: Escape in the panel gives it the focus back.
  readonly bellRef: RefObject<HTMLButtonElement | null>;
  // The orders typed on an earlier day and never placed (latched, then derived: pendingLatch.tsx).
  readonly pending: readonly PendingSupplier<StoredDoc>[];
  // What the shared order holds that nobody was told about, one group per supplier.
  readonly untold: readonly UntoldGroup[];
  // The calendar notices still open, with the sentence each one says, and how many were put away on this phone.
  readonly calendar: ReadonlyArray<{ readonly key: string; readonly text: string }>;
  readonly closed: number;
  close(key: string): void;
  reopen(): void;
  // The bell's number: pending banners + untold blocks drawn + calendar notices open. The pill and the empty line are NOT notices
  // (js/orders/tablet-layout.js NOTICE_CLASSES).
  readonly count: number;
}

const NoticesContext = createContext<Notices | null>(null);

export function useNotices(): Notices {
  const notices = useContext(NoticesContext);
  if (!notices) throw new Error('useNotices must be used inside <NoticesProvider>.');
  return notices;
}

// ⚠️ THE PANEL IS CLOSED WHENEVER ORDERS OPENS (the state lives here, mounted with the section). A failure
// while working the notices out is logged and answered with «no notices» — it must never take the list down (T6).
export function NoticesProvider({ lens, ready, children }: { lens: OrdersLens; ready: boolean; children: ReactNode }) {
  const { t } = useT();
  const snapshot = useOrders();
  const { location } = useSession();
  const country = countryOf(location);
  const ukDates = useUkHolidays(country);
  const today = todayISO();
  const { dismissed, close, reopen } = useDismissedNotices(today);
  const { latched } = usePendingLatch();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const bellRef = useRef<HTMLButtonElement>(null);

  const model = useMemo(() => {
    try {
      const pending: PendingSupplier<StoredDoc>[] = latched && ready
        ? pendingNow(lens, snapshot.draft, today).filter(row => latched.has(row.supplier.id as string))
        : [];
      // ⚠️ `requests: []` ON PURPOSE: the order lists (what was SENT) arrive with slice 3f-7. Until then «told» is only what was
      // recorded, so a number is flagged only against a recorded order of the day.
      const untold: UntoldGroup[] = ready && snapshot.historyLoaded
        ? untoldChanges({
          suppliers: notForLater(lens.suppliers, snapshot.draft.days, today),
          ingredients: lens.lines,
          entries: snapshot.draft.entries,
          requests: [],
          history: snapshot.history,
          today,
        })
        : [];
      const alerts: CalendarNotice[] = snapshot.suppliersLoaded
        ? computeAlerts(snapshot.suppliers, new Date(), country, ukDates)
          .filter((alert): alert is CalendarNotice => alert.kind !== 'order')
        : [];
      return { pending, untold, shown: visibleAlerts(alerts, dismissed), hidden: hiddenAlerts(alerts, dismissed) };
    } catch (err) {
      console.error('The notices could not be worked out:', err);
      return { pending: [], untold: [], shown: [] as CalendarNotice[], hidden: [] as CalendarNotice[] };
    }
  }, [lens, ready, latched, snapshot.draft, snapshot.history, snapshot.historyLoaded, snapshot.suppliers, snapshot.suppliersLoaded,
    country, ukDates, dismissed, today]);

  const dt = dayTranslate(t);
  const calendar = model.shown.map(alert => ({ key: alert.key, text: noticeText(alert, t, dt) }));

  // ⚠️ ONLY THE NOTICES STILL OPEN raise a browser notification (finding F-7: the current app raised the ones put away too), and
  // each only once however often this is drawn. It works with the panel closed: the notice exists whether or not it is looked at.
  const latest = useRef(calendar);
  latest.current = calendar;
  const keys = calendar.map(notice => notice.key).join('|');
  useEffect(() => {
    if (latest.current.length === 0) return;
    void notifyOnce(latest.current.map(notice => ({ key: notice.key, title: 'Mise', body: notice.text })));
  }, [keys]);

  const untoldBlocks = model.untold.reduce((n, group) => n + (group.added.length > 0 ? 1 : 0) + (group.afterOrdering.length > 0 ? 1 : 0), 0);
  const value: Notices = {
    open, setOpen, panelId, bellRef,
    pending: model.pending,
    untold: model.untold,
    calendar,
    closed: model.hidden.length,
    close, reopen,
    count: model.pending.length + untoldBlocks + calendar.length,
  };
  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>;
}
