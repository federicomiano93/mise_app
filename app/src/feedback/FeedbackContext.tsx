import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { feedbackOn } from '@mise/shared/venue-features';
import { useLocation } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useSession } from '../session/SessionContext';
import { FeedbackDialog } from './FeedbackDialog';
import type { Place } from './FeedbackDialog';

// «Nota per Claude»: where the note button is drawn, and the one dialog both of its doors open (the top bar's icon from 700px, and the
// phone's «More» page). It knows WHERE the person is: the address, and the name of the open item when the screen says it
// (`usePlaceName`).
//
// ⚠️ ONLY IN A VENUE WHOSE DOCUMENT SAYS `feedbackToClaude: true` (feedbackOn: a literal true, like the rules' own check): `available`
// is false everywhere else and no door is drawn.
// ⚠️ ON A PHONE THE NOTE IS WRITTEN FROM «MORE»: that page is not where the person was, so «where» is the last place before it.

type Feedback = {
  readonly available: boolean;
  // The place a note is being written for, or null: read by `FeedbackHost`.
  readonly asked: Place | null;
  readonly close: () => void;
  // Opens the dialog for the place the person is on (or, from «More», the one they came from).
  readonly open: () => void;
};

const FeedbackContext = createContext<Feedback>({ available: false, asked: null, close: () => undefined, open: () => undefined });

// What a screen says about the item it has open («Pane di Miano»), so a note carries it. Null when there is none.
const SetPlaceName = createContext<(name: string | null) => void>(() => undefined);

export function useFeedback(): Feedback {
  return useContext(FeedbackContext);
}

// Called by a screen that shows one named item. The name goes with the screen: it is forgotten when the screen goes.
export function usePlaceName(name: string | null | undefined): void {
  const set = useContext(SetPlaceName);
  const wanted = name === undefined || name === '' ? null : name;
  useEffect(() => {
    set(wanted);
    return () => { set(null); };
  }, [set, wanted]);
}

const isMore = (pathname: string): boolean => pathname === '/more' || pathname.startsWith('/more/');

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { location: venue } = useSession();
  const { pathname } = useLocation();
  const available = feedbackOn(venue);
  const [name, setName] = useState<string | null>(null);
  const [asked, setAsked] = useState<Place | null>(null);
  // The last place that was not «More» (a phone writes its note from there).
  const before = useRef<Place>({ pathname, name: null });

  useEffect(() => {
    if (!isMore(pathname)) before.current = { pathname, name };
  }, [pathname, name]);

  const open = useCallback(() => {
    setAsked(isMore(pathname) ? before.current : { pathname, name });
  }, [pathname, name]);

  const close = useCallback(() => { setAsked(null); }, []);
  // ⚠️ THE SWITCH TURNING OFF WHILE THE DIALOG IS OPEN closes it for good: kept, `asked` would open it again unasked when the switch came back.
  useEffect(() => { if (!available) setAsked(null); }, [available]);

  const value = useMemo<Feedback>(() => ({ available, asked: available ? asked : null, close, open }), [available, asked, close, open]);

  return (
    <SetPlaceName.Provider value={setName}>
      <FeedbackContext.Provider value={value}>
        {children}
      </FeedbackContext.Provider>
    </SetPlaceName.Provider>
  );
}

// Where the dialog is declared: under the shell's status provider (a sibling of `main`, see AppShell), so «Note sent.» and a late «Note not sent.» are said by the page's one
// region and outlive the dialog. In a part of its own: a render error in the note must not take the app down.
export function FeedbackHost() {
  const { asked, close } = useFeedback();
  if (asked === null) return null;
  return (
    <PartBoundary>
      <FeedbackDialog place={asked} onClose={close} />
    </PartBoundary>
  );
}
