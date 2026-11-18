import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KioskSection } from '@mise/shared/kiosk-lines';
import { useOptionalDataServices } from '../data/DataContext';
import { useJoinFlow } from '../session/JoinFlowContext';
import { joinShown } from '../session/SessionGate';
import { useSession } from '../session/SessionContext';
import { visibleSectionIds } from '../session/visibility';
import { createKioskController } from './kioskController';
import type { KioskEnv } from './kioskController';
import { browserKioskEnv } from './kioskEnv';
import type { KioskOrdersSource } from './kioskOrdersSource';
import { useKioskSettings } from './kioskSettings';
import { liveKioskLines, liveKioskLinesShown } from './liveOrdersLines';
import { onRestNow } from './restNow';
import { createRestOrdersFeed, fetchRestSections } from './restOrders';
import { RestScreen } from './RestScreen';

const NO_SECTIONS: readonly KioskSection[] = Object.freeze([]);

// Kiosk mode (staff slices 5 and 6): mounted ONCE, beside the session gate (main.tsx), so it sees every state of the session — the
// rest screen only while a person is signed in with a venue open, the screen lock held while a fresh page is still loading its
// session, and the cover of a page resumed in the night kept until the session answers. With the setting off it does nothing.
//
// `env` and `orders` are for the specs (fake timers, a fake wake lock, a fake reload; the rest screen's reads); the app uses the
// browser's and the data services'.
export function Kiosk({ env, orders }: { env?: KioskEnv; orders?: (locationId: string) => KioskOrdersSource }) {
  const settings = useKioskSettings();
  const session = useSession();
  const join = useJoinFlow();
  const services = useOptionalDataServices();
  const [controller] = useState(() => createKioskController(env ?? browserKioskEnv()));
  // Signed in and working: a venue is open and on screen — not the join form drawn over it, not a venue being left.
  const signedIn = session.status === 'ready' && !session.leaving && !joinShown(session.status, join);

  // ⚠️ The session first, then the setting: starting needs to know whether a person is signed in (the screen lock).
  useEffect(() => { controller.setSession({ status: session.status, signedIn }); }, [controller, session.status, signedIn]);
  useEffect(() => { controller.applySettings(settings); }, [controller, settings]);
  useEffect(() => () => { controller.stop(); }, [controller]);
  // The Home's «Rest» (staff slice 6).
  useEffect(() => onRestNow(() => { controller.restNow(); }), [controller]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  // ⚠️ THE ORDERS LINES ONLY FOR SOMEBODY THE VENUE SHOWS ORDERS TO (the current app's restOrdersAllowed: the venue has Orders and
  // the card is shown to this person — the same question as the rail's, session/visibility.ts). UX only: the rules refuse the
  // records and the draft to anybody else as well.
  const allowed = session.status === 'ready' && session.locationId !== null
    && visibleSectionIds(session.location, session.canManage, session.role).has('orders');
  const makeSource = orders ?? (services === null ? null : services.kioskOrders);
  const sections = useRestOrders(snapshot.state, allowed, session.locationId, makeSource);

  if (snapshot.state === 'active') return null;
  return (
    <RestScreen
      venue={session.status === 'ready' ? session.name : ''}
      reloading={snapshot.reloading}
      now={snapshot.paintedAt}
      sections={allowed ? liveKioskLines() ?? sections : NO_SECTIONS}
      armAt={snapshot.armAt}
      onWake={controller.wakeTap}
    />
  );
}

// The reads behind the lines (restOrders.ts): started when the tablet goes to REST, stopped when it wakes or goes to night, refreshed
// when the page comes back into view while resting. What was read last is still drawn in the night.
function useRestOrders(
  state: 'active' | 'rest' | 'night', allowed: boolean, locationId: string | null,
  makeSource: ((locationId: string) => KioskOrdersSource) | null,
): readonly KioskSection[] {
  const [sections, setSections] = useState<readonly KioskSection[]>(NO_SECTIONS);
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  const feed = useMemo(() => {
    if (locationId === null || makeSource === null) return null;
    const source = makeSource(locationId);
    const made = createRestOrdersFeed({
      allowed: () => allowedRef.current,
      pageAnswers: liveKioskLinesShown,
      fetchSections: () => fetchRestSections(source),
      onChange: () => { setSections(made.current()); },
    });
    return made;
  }, [locationId, makeSource]);

  useEffect(() => {
    if (feed === null) return undefined;
    if (state === 'rest' && allowed) feed.start();
    else feed.stop();
    setSections(feed.current());
    return undefined;
  }, [feed, state, allowed]);

  useEffect(() => () => { feed?.stop(); }, [feed]);

  useEffect(() => {
    if (feed === null || state !== 'rest') return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') feed.refreshIfStale(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); };
  }, [feed, state]);

  return sections;
}
