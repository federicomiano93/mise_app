import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './StatusMessage.module.css';

// How long a message stays on screen.
export const MESSAGE_MS = 2600;

type Say = (text: string) => void;

const StatusMessageContext = createContext<Say | null>(null);

// One short message at a time («Cornetti: 24.», «Couldn’t save Tuesday — check your
// connection.»), drawn like a toast over the bottom of the content and spoken by a screen reader.
// A new message replaces the old one; it clears itself after MESSAGE_MS.
//
// ⚠️ THE LIVE REGION IS RENDERED EMPTY, WHEN THE SECTION OPENS, AND ONLY ITS TEXT COMES AND GOES.
// A role="status" element inserted already filled in is announced unreliably (VoiceOver on iOS
// often says nothing); text added to a region that was already on the page is. The message sits in
// a node keyed on a counter, so the SAME sentence said twice is a new node and is announced again.
//
// Wrap a section once; anything below it calls useStatusMessage().
export function StatusMessageProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const say = useCallback<Say>(text => {
    if (timer.current !== null) clearTimeout(timer.current);
    counter.current += 1;
    setShown({ id: counter.current, text });
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(null);
    }, MESSAGE_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return (
    <StatusMessageContext.Provider value={say}>
      {children}
      <div role="status" className={styles.region}>
        {shown === null ? null : <p key={shown.id} className={styles.message}>{shown.text}</p>}
      </div>
    </StatusMessageContext.Provider>
  );
}

export function useStatusMessage(): Say {
  const say = useContext(StatusMessageContext);
  if (!say) throw new Error('useStatusMessage must be used inside a <StatusMessageProvider>.');
  return say;
}
