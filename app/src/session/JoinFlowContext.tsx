import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { JoinFlow, JoinFlowState } from './joinFlow';

// The join flow (joinFlow.ts) is plain TypeScript, created before anything else runs
// (joinLinkBoot.ts); this is where React meets it, as SessionContext.tsx does for the session.
//
// ⚠️ THE DEFAULT IS null, NOT AN EMPTY FLOW: a gate drawn outside the provider would otherwise never
// see an invitation and look fine in a spec while being wired to nothing.
const JoinFlowContext = createContext<JoinFlow | null>(null);

export function JoinFlowProvider({ flow, children }: { flow: JoinFlow; children: ReactNode }) {
  return <JoinFlowContext.Provider value={flow}>{children}</JoinFlowContext.Provider>;
}

export function useJoinFlowStore(): JoinFlow {
  const flow = useContext(JoinFlowContext);
  if (!flow) throw new Error('useJoinFlow must be used inside a <JoinFlowProvider>.');
  return flow;
}

export function useJoinFlow(): JoinFlowState {
  const flow = useJoinFlowStore();
  return useSyncExternalStore(flow.subscribe, flow.getSnapshot);
}
