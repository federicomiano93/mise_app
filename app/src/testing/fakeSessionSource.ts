// A stand-in for the app's SessionStore, for the specs of the modules that follow the session
// (the error reporter, the device count, the usage tracker).
//
// Like the real store, `subscribe` does NOT call back at once: a change is announced only by set().

import type { SessionSource, TelemetrySession } from '../telemetry/common';

export interface FakeSessionSource extends SessionSource {
  // The session changes: every subscriber is told.
  set(next: TelemetrySession): void;
  // How many subscribers are listening now.
  listening(): number;
  // What was asked of the source, in order (`subscribe`), so a spec can pin the order of start-up.
  calls: string[];
}

export function fakeSessionSource(initial: TelemetrySession): FakeSessionSource {
  let current = initial;
  const listeners = new Set<() => void>();
  const source: FakeSessionSource = {
    calls: [],
    getSnapshot: () => current,
    subscribe(listener) {
      source.calls.push('subscribe');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next) {
      current = next;
      listeners.forEach(listener => listener());
    },
    listening: () => listeners.size,
  };
  return source;
}
