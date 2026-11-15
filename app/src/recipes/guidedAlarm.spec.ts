import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Audio element: what it was told, and whether it is playing.
type FakeAudio = {
  src: string; loop: boolean; preload: string; muted: boolean; paused: boolean; currentTime: number;
  calls: string[]; mutedWhenPlayed: boolean[];
  play: () => Promise<void>; pause: () => void; load: () => void;
};
let made: FakeAudio[] = [];
let playRejects = false;

class FakeAudioClass {
  src: string;
  loop = false;
  preload = '';
  muted = false;
  paused = true;
  currentTime = 0;
  calls: string[] = [];
  mutedWhenPlayed: boolean[] = [];
  constructor(src: string) {
    this.src = src;
    made.push(this as unknown as FakeAudio);
  }
  play() {
    this.calls.push('play');
    this.mutedWhenPlayed.push(this.muted);
    this.paused = false;
    return playRejects ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
  }
  pause() { this.calls.push('pause'); this.paused = true; }
  load() { this.calls.push('load'); }
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

let alarm: typeof import('./guidedAlarm');
let vibrate: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  made = [];
  playRejects = false;
  vibrate = vi.fn();
  vi.stubGlobal('Audio', FakeAudioClass);
  vi.stubGlobal('navigator', { vibrate });
  vi.resetModules();
  alarm = await import('./guidedAlarm');
});

afterEach(() => {
  alarm.stopAlarm();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authorising the sound at the tap that starts a timer', () => {
  it('plays it MUTED for an instant, then stops, rewinds and unmutes it', async () => {
    alarm.unlockAlarm();
    const sound = made[0]!;
    expect(sound.mutedWhenPlayed).toEqual([true]);
    expect(sound.muted).toBe(true);
    await flush();
    expect(sound.paused).toBe(true);
    expect(sound.muted).toBe(false);
    expect(sound.currentTime).toBe(0);
    expect(alarm.isRinging()).toBe(false);
  });

  it('makes one looping, preloaded element from a real file, and asks for the file at once', () => {
    alarm.unlockAlarm();
    alarm.unlockAlarm();
    expect(made).toHaveLength(1);
    expect(made[0]?.loop).toBe(true);
    expect(made[0]?.preload).toBe('auto');
    expect(made[0]?.src).toMatch(/alarm.*\.wav/);
    expect(made[0]?.src.startsWith('data:')).toBe(false);
    expect(made[0]?.calls[0]).toBe('load');
  });

  it('settles even when the browser refuses to play', async () => {
    playRejects = true;
    alarm.unlockAlarm();
    await flush();
    expect(made[0]?.paused).toBe(true);
    expect(made[0]?.muted).toBe(false);
  });
});

describe('ringing', () => {
  it('rings unmuted, loudly enough to be proved, and vibrates', () => {
    alarm.unlockAlarm();
    alarm.startAlarm();
    expect(alarm.isRinging()).toBe(true);
    expect(made[0]?.muted).toBe(false);
    expect(vibrate).toHaveBeenCalledWith(alarm.BUZZ);
  });

  it('repeats the buzz every two seconds while it rings', () => {
    alarm.startAlarm();
    const buzzes = () => vibrate.mock.calls.filter(call => call[0] === alarm.BUZZ).length;
    expect(buzzes()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(buzzes()).toBe(2);
    vi.advanceTimersByTime(4000);
    expect(buzzes()).toBe(4);
  });

  it('⚠️ stops by itself after 60 seconds: sound and buzz', () => {
    alarm.startAlarm();
    vi.advanceTimersByTime(alarm.MAX_RING_MS - 1);
    expect(alarm.isRinging()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(alarm.isRinging()).toBe(false);
    const buzzes = vibrate.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    // Only the cancelling `vibrate(0)` came after the last pulse; the repeat is gone.
    expect(vibrate.mock.calls.length).toBe(buzzes);
    expect(vibrate).toHaveBeenLastCalledWith(0);
  });

  it('stopAlarm silences the sound, cancels the vibration and clears both timers', () => {
    alarm.startAlarm();
    alarm.stopAlarm();
    expect(alarm.isRinging()).toBe(false);
    expect(made[0]?.currentTime).toBe(0);
    expect(vibrate).toHaveBeenLastCalledWith(0);
    const calls = vibrate.mock.calls.length;
    vi.advanceTimersByTime(alarm.MAX_RING_MS * 2);
    expect(vibrate.mock.calls.length).toBe(calls);
  });

  it('starting again does not stack a second repeat', () => {
    alarm.startAlarm();
    alarm.startAlarm();
    vibrate.mockClear();
    vi.advanceTimersByTime(2000);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('a refused play() is swallowed', async () => {
    playRejects = true;
    expect(() => { alarm.startAlarm(); }).not.toThrow();
    await flush();
  });
});

describe('a phone without the pieces', () => {
  it('no Audio at all: nothing throws, nothing rings, the buzz still goes', () => {
    vi.stubGlobal('Audio', class { constructor() { throw new Error('no audio'); } });
    expect(() => { alarm.unlockAlarm(); alarm.startAlarm(); alarm.stopAlarm(); }).not.toThrow();
    expect(alarm.isRinging()).toBe(false);
    expect(vibrate).toHaveBeenCalled();
  });

  it('no vibration API (iOS): the sound alone', () => {
    vi.stubGlobal('navigator', {});
    expect(() => { alarm.startAlarm(); alarm.stopAlarm(); }).not.toThrow();
    expect(made).toHaveLength(1);
  });

  it('a play() that throws outright does not stop the alarm from being started', () => {
    alarm.unlockAlarm();
    const sound = made[0]!;
    sound.play = () => { throw new Error('boom'); };
    expect(() => { alarm.startAlarm(); }).not.toThrow();
    expect(vibrate).toHaveBeenCalled();
  });

  it('a rewind that throws does not leave the sound playing', () => {
    alarm.startAlarm();
    const sound = made[0]!;
    Object.defineProperty(sound, 'currentTime', { get: () => 0, set: () => { throw new Error('not loaded'); } });
    alarm.stopAlarm();
    expect(sound.paused).toBe(true);
  });
});
