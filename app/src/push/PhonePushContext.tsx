import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { PhonePush } from './phonePush';
import type { TimerPush } from './timerPush';

// This phone's push registration (phonePush.ts) and the booking of a timer's push (timerPush.ts), both built once in main.tsx on
// the session's backend. A screen's spec passes fakes instead (testing/renderApp.tsx), so no screen ever needs a browser's push
// machinery to be tested.
//
// ⚠️ NO DEFAULT: a screen drawn outside the provider would otherwise say «this phone is not registered» and look fine; the
// error names the missing provider instead.
interface PushServices {
  readonly phonePush: PhonePush;
  readonly timerPush: TimerPush;
}
const PhonePushContext = createContext<PushServices | null>(null);

export function PhonePushProvider({ phonePush, timerPush, children }: PushServices & { children: ReactNode }) {
  return <PhonePushContext.Provider value={{ phonePush, timerPush }}>{children}</PhonePushContext.Provider>;
}

function useServices(): PushServices {
  const services = useContext(PhonePushContext);
  if (!services) throw new Error('usePhonePush / useTimerPush must be used inside a <PhonePushProvider>.');
  return services;
}

export function usePhonePush(): PhonePush {
  return useServices().phonePush;
}

export function useTimerPush(): TimerPush {
  return useServices().timerPush;
}
