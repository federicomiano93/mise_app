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
