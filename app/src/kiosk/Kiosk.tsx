import { useEffect, useState, useSyncExternalStore } from 'react';
import { useJoinFlow } from '../session/JoinFlowContext';
import { joinShown } from '../session/SessionGate';
import { useSession } from '../session/SessionContext';
import { createKioskController } from './kioskController';
import type { KioskEnv } from './kioskController';
import { browserKioskEnv } from './kioskEnv';
import { useKioskSettings } from './kioskSettings';
import { RestScreen } from './RestScreen';

// Kiosk mode (staff slice 5): mounted ONCE, beside the session gate (main.tsx), so it sees every state of the session — the rest
// screen only while a person is signed in with a venue open, the screen lock held while a fresh page is still loading its session,
// and the cover of a page resumed in the night kept until the session answers. With the setting off it does nothing.
//
// `env` is for the specs (fake timers, a fake wake lock, a fake reload); the app uses the browser's.
export function Kiosk({ env }: { env?: KioskEnv }) {
  const settings = useKioskSettings();
  const session = useSession();
  const join = useJoinFlow();
  const [controller] = useState(() => createKioskController(env ?? browserKioskEnv()));
  // Signed in and working: a venue is open and on screen — not the join form drawn over it, not a venue being left.
  const signedIn = session.status === 'ready' && !session.leaving && !joinShown(session.status, join);

  // ⚠️ The session first, then the setting: starting needs to know whether a person is signed in (the screen lock).
  useEffect(() => { controller.setSession({ status: session.status, signedIn }); }, [controller, session.status, signedIn]);
  useEffect(() => { controller.applySettings(settings); }, [controller, settings]);
  useEffect(() => () => { controller.stop(); }, [controller]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (snapshot.state === 'active') return null;
  return (
    <RestScreen
      venue={session.status === 'ready' ? session.name : ''}
      reloading={snapshot.reloading}
      now={snapshot.paintedAt}
      onWake={controller.wakeTap}
    />
  );
}
