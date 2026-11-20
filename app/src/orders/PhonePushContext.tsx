import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { PhonePush } from './phonePush';

// This phone's push registration (phonePush.ts), built once in main.tsx on the session's backend. A screen's spec passes a fake
// instead (testing/renderApp.tsx), so no screen ever needs a browser's push machinery to be tested.
//
// ⚠️ NO DEFAULT: a screen drawn outside the provider would otherwise say «this phone is not registered» and look fine; the
// error names the missing provider instead.
const PhonePushContext = createContext<PhonePush | null>(null);

export function PhonePushProvider({ phonePush, children }: { phonePush: PhonePush; children: ReactNode }) {
  return <PhonePushContext.Provider value={phonePush}>{children}</PhonePushContext.Provider>;
}

export function usePhonePush(): PhonePush {
  const phonePush = useContext(PhonePushContext);
  if (!phonePush) throw new Error('usePhonePush must be used inside a <PhonePushProvider>.');
  return phonePush;
}
