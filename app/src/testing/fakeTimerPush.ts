import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { TimerBooking, TimerPush } from '../push/timerPush';

// A TimerPush a spec can steer: what schedule() answers (the id booked, '' for nothing; or a promise the spec settles later),
// and a record of every call.
export type FakeTimerPush = TimerPush & {
  // What the next schedule() resolves to: 'booking' = the id it was asked for, '' = nothing booked.
  answer: 'booking' | '';
  // Hold every schedule() until the spec calls release(), to test a booking that resolves late.
  hold: boolean;
  release(): void;
  schedule: Mock<TimerPush['schedule']>;
  cancel: Mock<TimerPush['cancel']>;
};

export function fakeTimerPush(initial: Partial<Pick<FakeTimerPush, 'answer' | 'hold'>> = {}): FakeTimerPush {
  const waiting: Array<() => void> = [];
  const fake: FakeTimerPush = {
    answer: 'booking',
    hold: false,
    ...initial,
    release: () => { waiting.splice(0).forEach(go => { go(); }); },
    schedule: vi.fn<TimerPush['schedule']>(async (booking: TimerBooking) => {
      if (fake.hold) await new Promise<void>(resolve => { waiting.push(resolve); });
      return fake.answer === 'booking' ? booking.id : '';
    }),
    cancel: vi.fn<TimerPush['cancel']>(),
  };
  return fake;
}
