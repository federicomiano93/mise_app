import { useState } from 'react';
import type { Log } from '@mise/shared/log-model';
import { useCalculator } from './CalculatorContext';

export type LogLookup =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'found'; readonly log: Log };

// The log an address names. ⚠️ «NOT THERE» IS ONLY BELIEVED ONCE THE LOGS HAVE ARRIVED: a log opened by its address
// (a reload, a link sent to a colleague) is not in the store for the first moments, and «not found» then would be a
// lie. After that a log that is gone — deleted on another phone while it was open — is simply missing.
export function useLog(id: string): LogLookup {
  const { logs, logsLoaded } = useCalculator();
  const log = logs.find(known => known.id === id);
  if (log) return { status: 'found', log };
  return { status: logsLoaded ? 'missing' : 'loading' };
}

// ⚠️ THE LOG AN EDIT SCREEN WORKS ON, KEPT WHILE IT IS BRIEFLY MISSING: a cached snapshot that lacks the log (the
// stream answers from the cache before the server) must not throw away what is being typed. Once the log has been
// seen, this returns the last copy seen whenever the live lookup does not find it; the editor's Save decides, from the
// store, whether the log is really gone.
export function useKeptLog(id: string): LogLookup {
  const lookup = useLog(id);
  const [kept, setKept] = useState<Log | null>(null);
  if (lookup.status === 'found' && kept !== lookup.log) setKept(lookup.log);
  if (lookup.status !== 'found' && kept !== null && kept.id === id) return { status: 'found', log: kept };
  return lookup;
}
