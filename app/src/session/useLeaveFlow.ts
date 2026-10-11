import { useRef, useState } from 'react';
import { useSessionStore } from './SessionContext';

// What LeaveDialog needs to draw the flow; the rest of the hook's result is for the caller.
export interface LeaveStep {
  readonly step: 'closed' | 'ask' | 'unsent';
  close(): void;
  // «Go on anyway», on the «Not sent yet» step.
  goOn(): void;
}

// The shared shape of the two things that clear this phone's copy of the data: signing out and
// switching venue. First the caller's own question (`ask`: «Log out?», or the list of venues),
// then — only if something typed on this phone has not reached the server yet — «Not sent yet»
// (js/unsent-guard.js, the current app's version of the second step).
//
// ⚠️ WHY THE SECOND QUESTION EXISTS. That copy is also where a change made with no signal waits
// to be sent. Clearing it without a word would throw somebody's work away, which is the one
// thing this app promises never to do (P20).
//
// ⚠️ BOTH STEPS ARE ONE DIALOG, not one closing and another opening. A second dialog opened
// while the first is still giving the focus back captures the wrong "where to return to", and
// «Stay» then left the focus on the page body — a keyboard user lost, a screen reader silent.
// One dialog keeps the button that opened it as the place to return to, whichever way it ends.
export function useLeaveFlow<Arg = void>(leave: (value: Arg) => void | Promise<void>) {
  const store = useSessionStore();
  const [step, setStep] = useState<LeaveStep['step']>('closed');
  const [checking, setChecking] = useState(false);
  const [target, setTarget] = useState<{ value: Arg } | null>(null);
  // The last attempt failed: the caller shows `leave.failed` beside its button (P17 — a tap that
  // does nothing, with only the console knowing why, reads as a broken app).
  const [failed, setFailed] = useState(false);
  // Bumped whenever the dialog is closed, so an answer that arrives after the person pressed
  // Cancel or Escape does not open the dialog again.
  const generation = useRef(0);

  // A failed sign-out or switch must not become an unhandled rejection.
  async function run(value: Arg): Promise<void> {
    try {
      await leave(value);
    } catch (error) {
      console.error('Could not leave:', error);
      setFailed(true);
    }
  }

  function close() {
    generation.current += 1;
    setStep('closed');
    setChecking(false);
  }

  // The person said yes to the first question. If something is still waiting to be sent they
  // are told; otherwise they leave.
  async function proceed(value: Arg): Promise<void> {
    const asked = generation.current;
    setChecking(true);
    // ⚠️ A QUESTION THAT CANNOT BE ANSWERED IS "YES, SOMETHING MAY BE WAITING": asking once too
    // often costs a tap, guessing wrong costs the person's work.
    const waiting = await store.changesStillWaiting().catch(() => true);
    if (asked !== generation.current) return;
    setChecking(false);
    if (waiting) {
      setTarget({ value });
      setStep('unsent');
      return;
    }
    close();
    await run(value);
  }

  function goOn() {
    const pending = target;
    close();
    if (pending) void run(pending.value);
  }

  return { step, checking, failed, open: () => { setFailed(false); setStep('ask'); }, close, proceed, goOn };
}
