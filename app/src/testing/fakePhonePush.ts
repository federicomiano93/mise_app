import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PhonePush, PushOutcome, PushSupport } from '../push/phonePush';

// A PhonePush a spec can steer: what the phone supports, whether it is registered for somebody, and what a tap answers.
export type FakePhonePush = PhonePush & {
  // What support() answers; change it to move the phone to another state.
  reason: PushSupport;
  // The uid this phone is registered for, '' when none.
  owner: string;
  // What the next register() answers. On 'on' the phone becomes registered for `registerAs`.
  outcome: PushOutcome;
  registerAs: string;
  // Permission-only mode (null = off) and what verify() answers; 'cleared' forgets the registration, as the real one does.
  only: 'default' | 'granted' | 'denied' | null;
  verifyAnswer: 'ok' | 'cleared' | 'unknown';
  register: Mock<PhonePush['register']>;
  verify: Mock<PhonePush['verify']>;
};

export function fakePhonePush(initial: Partial<Pick<FakePhonePush, 'reason' | 'owner' | 'outcome' | 'registerAs' | 'only' | 'verifyAnswer'>> = {}): FakePhonePush {
  const fake: FakePhonePush = {
    reason: 'ask',
    owner: '',
    outcome: 'on',
    registerAs: 'u1',
    only: null,
    verifyAnswer: 'ok',
    ...initial,
    support: () => fake.reason,
    onForMe: uid => fake.reason === 'granted' && fake.owner !== '' && fake.owner === uid,
    permissionOnly: () => fake.only,
    verify: vi.fn<PhonePush['verify']>(async () => {
      if (fake.verifyAnswer === 'cleared') {
        fake.owner = '';
        window.localStorage.removeItem('push-token');
        window.localStorage.removeItem('push-token-uid');
      }
      return fake.verifyAnswer;
    }),
    register: vi.fn<PhonePush['register']>(async () => {
      if (fake.only !== null) {
        if (fake.outcome === 'on') fake.only = 'granted';
        else if (fake.outcome === 'blocked') fake.only = 'denied';
        return fake.outcome;
      }
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
