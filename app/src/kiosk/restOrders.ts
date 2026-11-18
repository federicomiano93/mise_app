// restOrders.ts — the Orders lines of the kiosk's rest screen (staff slice 6): what to order today and what arrives today, a port
// of js/kiosk-orders.js. The pure rules are @mise/shared/kiosk-lines through app/src/orders/kioskFeed.ts (`kioskSectionsFor`, which
// honours the goods-arrived switch, decision F4), so the rest screen can never disagree with Orders.
//
// Two ways to an answer, as in the current app:
//   - the Orders section is open: its store answers from its own live data (liveOrdersLines.ts), and nothing is read;
//   - anywhere else: a few one-time reads (kioskOrdersSource.ts) while the tablet RESTS, kept in memory, refreshed every 15 minutes
//     while it stays there, never in the night, never while the page is hidden. An answer younger than REFRESH_MS is reused (P14).
// A failed read keeps the previous answer and never reaches the cover (P17); only the error's code is logged, never a name.

import { deliveryCheckOf } from '@mise/shared/delivery-check';
import { todayISO } from '@mise/shared/day';
import type { KioskSection } from '@mise/shared/kiosk-lines';
import { normalizeOrdersConfig } from '@mise/shared/orders-config';
import { weekStart } from '@mise/shared/work-week';
import { kioskSectionsFor } from '../orders/kioskFeed';
import type { KioskOrdersSource } from './kioskOrdersSource';

export const REFRESH_MS = 15 * 60 * 1000;

// The reads. Returns the sections to draw for today. config/orders first: it says which day the week starts on (a failed read of it
// means the default week, Sunday, and the switch on). A failed read of the draft only means the closes are not known — never that the
// rest screen goes blank.
export async function fetchRestSections(source: KioskOrdersSource, today: string = todayISO()): Promise<KioskSection[]> {
  let config: Readonly<Record<string, unknown>> | null = null;
  try { config = await source.readConfig(); } catch { config = null; }
  const weekStartsOn = normalizeOrdersConfig(config).weekStartsOn;
  const [suppliers, history, skipped] = await Promise.all([
    source.readSuppliers(),
    source.readHistoryFrom(weekStart(today, weekStartsOn)),
    source.readDraft().then(draft => (draft?.skipped ?? null) as Readonly<Record<string, string>> | null, () => null),
  ]);
  return kioskSectionsFor({ suppliers, history, today, weekStartsOn, deliveryCheck: deliveryCheckOf(config), skipped });
}

export interface RestOrdersFeedDeps {
  // May this person see Orders at all (re-checked on every refresh).
  allowed(): boolean;
  // Does the Orders section answer from its live data (then nothing is read).
  pageAnswers(): boolean;
  fetchSections(): Promise<KioskSection[]>;
  // Fresh data arrived: repaint.
  onChange(): void;
  // The local day, so yesterday's answer is never shown.
  today?(): string;
  now?(): number;
  // False while the page is hidden: nothing is read then.
  visible?(): boolean;
  timers?: { set(callback: () => void, ms: number): unknown; clear(id: unknown): void };
}

export interface RestOrdersFeed {
  // Idempotent: called on entering rest and whenever the session changes while resting.
  start(): void;
  stop(): void;
  // The page came back into view while resting: read only if the answer is stale.
  refreshIfStale(): void;
  // What the cover draws: the last answer of today, or nothing.
  current(): KioskSection[];
  isRunning(): boolean;
}

// The scheduler and the memory (createRestOrdersFeed of js/kiosk-orders.js, decision for decision).
export function createRestOrdersFeed({
  allowed, pageAnswers, fetchSections, onChange,
  today = () => todayISO(),
  now = () => Date.now(),
  visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  timers = { set: (callback, ms) => setInterval(callback, ms), clear: id => { clearInterval(id as ReturnType<typeof setInterval>); } },
}: RestOrdersFeedDeps): RestOrdersFeed {
  let timer: unknown = null;
  let running = false;
  let inFlight = false;
  let token = 0;
  let cache: { day: string; at: number; sections: KioskSection[] } | null = null;

  // An answer of today that is younger than REFRESH_MS: the screen is never staler than that.
  function fresh(): boolean {
    return cache !== null && cache.day === today() && now() - cache.at < REFRESH_MS;
  }

  async function refresh(): Promise<void> {
    if (!running || inFlight || !visible() || !allowed() || pageAnswers()) return;
    const mine = token;
    inFlight = true;
    try {
      const sections = await fetchSections();
      if (mine !== token) return;   // stopped (woken, night) while the reads were out
      cache = { day: today(), at: now(), sections: Array.isArray(sections) ? sections : [] };
      onChange();
    } catch (err) {
      // Keep what we had. Only the error code is logged: no names, no data.
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'error';
      console.warn('The kiosk Orders lines could not be refreshed:', code);
    } finally {
      if (mine === token) inFlight = false;
    }
  }

  return {
    start() {
      if (running || !allowed() || pageAnswers()) return;
      running = true;
      if (!fresh()) void refresh();
      timer = timers.set(() => { void refresh(); }, REFRESH_MS);
    },
    stop() {
      running = false;
      inFlight = false;
      token++;
      if (timer !== null) { timers.clear(timer); timer = null; }
    },
    refreshIfStale() {
      if (running && !fresh()) void refresh();
    },
    current() {
      return allowed() && cache !== null && cache.day === today() ? cache.sections : [];
    },
    isRunning: () => running,
  };
}
