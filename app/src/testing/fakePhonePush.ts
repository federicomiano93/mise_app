import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PhonePush, PushOutcome, PushSupport } from '../orders/phonePush';

// A PhonePush a spec can steer: what the phone supports, whether it is registered for somebody, and what a tap answers.
export type FakePhonePush = PhonePush & {
  // What support() answers; change it to move the phone to another state.
  reason: PushSupport;
  // The uid this phone is registered for, '' when none.
  owner: string;
  // What the next register() answers. On 'on' the phone becomes registered for `registerAs`.
  outcome: PushOutcome;
  registerAs: string;
  register: Mock<PhonePush['register']>;
};

export function fakePhonePush(initial: Partial<Pick<FakePhonePush, 'reason' | 'owner' | 'outcome' | 'registerAs'>> = {}): FakePhonePush {
  const fake: FakePhonePush = {
    reason: 'ask',
    owner: '',
    outcome: 'on',
    registerAs: 'u1',
    ...initial,
    support: () => fake.reason,
    onForMe: uid => fake.reason === 'granted' && fake.owner !== '' && fake.owner === uid,
    register: vi.fn<PhonePush['register']>(async () => {
      if (fake.outcome === 'on') {
        fake.reason = 'granted';
        fake.owner = fake.registerAs;
        // The screen reads this key for the mute switch, as js/push.js and phoneMute.ts agree.
        window.localStorage.setItem('push-token', 'fake-token');
        window.localStorage.setItem('push-token-uid', fake.registerAs);
      }
      return fake.outcome;
    }),
  };
  return fake;
}
