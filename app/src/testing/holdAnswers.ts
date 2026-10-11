import { vi } from 'vitest';
import type { FakePastriesSource } from './fakePastriesSource';

// Makes a fake Pastries source answer LATE, when the spec says so: the state of a phone that was
// just opened (or reloaded on an address) before Firestore has said anything. Until `answer()` the
// screen has only the phone's local copy; `fail()` is the stream dying before it ever answered.
export type HeldAnswer = {
  answer(): void;
  fail(): void;
};

type Waiting = { answer: () => void; fail: () => void };

function held(waiting: Waiting[]): HeldAnswer {
  return {
    answer: () => waiting.forEach(each => each.answer()),
    fail: () => waiting.forEach(each => each.fail()),
  };
}

// The seven days.
export function holdDays(source: FakePastriesSource): HeldAnswer {
  const original = vi.mocked(source.watchDays).getMockImplementation();
  const waiting: Waiting[] = [];
  vi.mocked(source.watchDays).mockImplementation((onChange, onError) => {
    let stop: (() => void) | undefined;
    waiting.push({ answer: () => { stop = original?.(onChange, onError); }, fail: () => onError(new Error('unavailable')) });
    return () => stop?.();
  });
  return held(waiting);
}

// Tonight's confirmations: which lists are recorded, and so locked.
export function holdConfirmations(source: FakePastriesSource): HeldAnswer {
  const original = vi.mocked(source.watchLogsForDate).getMockImplementation();
  const waiting: Waiting[] = [];
  vi.mocked(source.watchLogsForDate).mockImplementation((date, onChange, onError) => {
    let stop: (() => void) | undefined;
    waiting.push({ answer: () => { stop = original?.(date, onChange, onError); }, fail: () => onError(new Error('unavailable')) });
    return () => stop?.();
  });
  return held(waiting);
}
