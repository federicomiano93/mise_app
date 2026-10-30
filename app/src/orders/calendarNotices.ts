// calendarNotices.ts — the two things the bell keeps on THIS phone (step 3f-6, parity R11, R12): which calendar notices were put
// away with «I have read this», and the browser notification raised for a notice the first time it is seen.
//
// The browser halves of js/orders/notifications.js (renderAlerts' storage, maybeNotify, renderNotificationSettings' permission);
// the rules are pure in @mise/shared/alert-dismissal.
//
// ⚠️ ONLY THE CALENDAR NOTICES ARE CLOSEABLE (Federico, 24 Aug 2026): a coming holiday is read once; an order not placed or an
// addition nobody was told about is WORK, and is never handed to this file.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pruneDismissed, readDismissed, reopenAll, withDismissed, writeDismissed,
} from '@mise/shared/alert-dismissal';

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): KeyStore | null {
  try { return window.localStorage; } catch { return null; }
}

export interface DismissedNotices {
  // The keys put away on this phone, pruned by the date each one is about.
  readonly dismissed: readonly string[];
  close(key: string): void;
  // The pill: every closed notice comes back at once.
  reopen(): void;
}

// ⚠️⚠️ PRUNED AGAINST THE DATE, NEVER AGAINST THE NOTICES ON SCREEN (alert-dismissal.ts): the first paint comes before the
// suppliers, so «the notices right now» would forget a delivery clash somebody had put away.
// ⚠️ READ AGAIN BEFORE EVERY CHANGE: another tab of the app may have closed one meanwhile, and a write from a stale copy would
// reopen it. ⚠️ JOINED WITH THE LIST ON SCREEN too (review of step 3f-6): storage that refuses the write, or was emptied meanwhile,
// would otherwise bring back every notice put away earlier in this opening. Unreadable storage shows everything (silence would hide
// something true about the week).
export function useDismissedNotices(today: string, storage: KeyStore | null = browserStorage()): DismissedNotices {
  const [dismissed, setDismissed] = useState<readonly string[]>(() => pruneDismissed(readDismissed(storage), today));
  const shown = useRef(dismissed);
  shown.current = dismissed;
  useEffect(() => {
    const kept = pruneDismissed(readDismissed(storage), today);
    writeDismissed(storage, kept);
    setDismissed(kept);
  }, [storage, today]);
  const close = useCallback((key: string) => {
    const next = withDismissed([...new Set([...readDismissed(storage), ...shown.current])], key);
    writeDismissed(storage, next);
    setDismissed(next);
  }, [storage]);
  const reopen = useCallback(() => {
    const next = reopenAll();
    writeDismissed(storage, next);
    setDismissed(next);
  }, [storage]);
  return { dismissed, close, reopen };
}

// ── Browser notifications (parity R12, decision T12: per phone, no push) ─────────────────────────────────────────────────────

export type NoticePermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function noticePermission(): NoticePermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// The Settings button. A browser that throws on the question answers what it already knew.
export async function askNoticePermission(): Promise<NoticePermission> {
  if (noticePermission() === 'unsupported') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (err) {
    console.warn('Notification permission request failed:', err);
    return noticePermission();
  }
}

export interface PhoneNotice {
  // The notice's stable key (`bh-<date>`, `conf-<supplier>-<date>`): it is the notification's tag too, so the phone shows one.
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

export interface NotifyDeps {
  readonly permission: () => NoticePermission;
  // The service worker's registration, when one controls this page.
  readonly registration: () => Promise<Pick<ServiceWorkerRegistration, 'showNotification'> | null | undefined>;
  readonly construct: (title: string, options: NotificationOptions) => void;
}

const browserNotifyDeps: NotifyDeps = {
  permission: noticePermission,
  registration: async () => {
    try { return await navigator.serviceWorker?.getRegistration(); } catch { return null; }
  },
  construct: (title, options) => { new Notification(title, options); },
};

// The keys already raised while the app has been open: a notice is raised ONCE, however many times the bell is drawn.
const raised = new Set<string>();

// ⚠️ ONLY THE NOTICES STILL OPEN (finding F-7: the current app raised the ones put away too). The caller hands the visible ones.
// ⚠️⚠️ THROUGH THE SERVICE WORKER WHEN THERE IS ONE (decision D4 of the slice): Chrome for Android refuses `new Notification()`
// («Illegal constructor») — the way the current app raises them, so on the lab tablet they never appeared. The constructor is
// kept for a desktop page that no service worker controls. A failure is logged and never stops the screen.
export async function notifyOnce(notices: readonly PhoneNotice[], deps: NotifyDeps = browserNotifyDeps): Promise<void> {
  if (deps.permission() !== 'granted') return;
  const fresh = notices.filter(notice => !raised.has(notice.key));
  if (!fresh.length) return;
  fresh.forEach(notice => raised.add(notice.key));
  const registration = await deps.registration();
  for (const notice of fresh) {
    const options: NotificationOptions = { body: notice.body, tag: notice.key };
    try {
      if (registration) {
        try {
          await registration.showNotification(notice.title, options);
        } catch (err) {
          // A worker that refuses (being replaced, say): the constructor, which a desktop page still has.
          console.warn('Notification through the service worker failed, trying the page:', err);
          deps.construct(notice.title, options);
        }
      } else {
        deps.construct(notice.title, options);
      }
    } catch (err) {
      // ⚠️ NOT RAISED, SO NOT REMEMBERED AS RAISED: the next drawing of the bell tries again.
      raised.delete(notice.key);
      console.warn('Notification failed:', err);
    }
  }
}

// For specs only: forget what was raised.
export function forgetRaisedNotices(): void {
  raised.clear();
}
