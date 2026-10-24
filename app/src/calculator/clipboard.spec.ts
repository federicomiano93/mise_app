import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_WAIT_MS, copyToClipboard } from './clipboard';

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
});

function clipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });
  return spy;
}

describe('copyToClipboard', () => {
  it('writes the text and says so', async () => {
    const write = clipboard(() => Promise.resolve());
    expect(await copyToClipboard('hello')).toBe(true);
    expect(write).toHaveBeenCalledWith('hello');
  });

  it('says false when the browser refuses', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    expect(await copyToClipboard('hello')).toBe(false);
  });

  it('says false when there is no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    expect(await copyToClipboard('hello')).toBe(false);
  });

  it('does not wait for ever on a write that never settles: the clock wins after two seconds', async () => {
    vi.useFakeTimers();
    clipboard(() => new Promise<void>(() => undefined));
    const outcome = copyToClipboard('hello');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_WAIT_MS - 1);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toBe(false);
    expect(CLIPBOARD_WAIT_MS).toBe(2000);
  });

  it('leaves no timer behind when the write is quick', async () => {
    vi.useFakeTimers();
    clipboard(() => Promise.resolve());
    await copyToClipboard('hello');
    expect(vi.getTimerCount()).toBe(0);
  });
});
