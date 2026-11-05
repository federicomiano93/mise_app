import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MESSAGE_MS, StatusMessageProvider, useStatusMessage } from './StatusMessage';

function Sayer({ text }: { text: string }) {
  const say = useStatusMessage();
  return <button type="button" onClick={() => say(text)}>{`say ${text}`}</button>;
}

function draw(...texts: string[]) {
  return render(
    <StatusMessageProvider>
      {texts.map(text => <Sayer key={text} text={text} />)}
    </StatusMessageProvider>,
  );
}

const press = (text: string) => fireEvent.click(screen.getByRole('button', { name: `say ${text}` }));
const region = () => screen.getByRole('status');

describe('StatusMessage', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // A live region inserted already filled in is announced unreliably: it must be on the page,
  // empty, before there is anything to say.
  it('has its live region on the page, empty, before the first message', () => {
    draw('Saved.');
    expect(region()).toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();
  });

  it('puts the message into the region that was already there', () => {
    draw('Saved.');
    const before = region();
    press('Saved.');
    expect(region()).toBe(before);
    expect(region()).toHaveTextContent('Saved.');
  });

  it('clears itself after 2.6 seconds, and not before', () => {
    draw('Saved.');
    press('Saved.');
    act(() => { vi.advanceTimersByTime(MESSAGE_MS - 1); });
    expect(region()).toHaveTextContent('Saved.');
    act(() => { vi.advanceTimersByTime(1); });
    expect(region()).toBeEmptyDOMElement();
    expect(MESSAGE_MS).toBe(2600);
  });

  it('replaces the old message with the new one, and restarts the clock', () => {
    draw('First.', 'Second.');
    press('First.');
    act(() => { vi.advanceTimersByTime(2000); });
    press('Second.');
    expect(region()).toHaveTextContent('Second.');
    expect(region()).not.toHaveTextContent('First.');
    // The first message's clock must not clear the second one early.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(region()).toHaveTextContent('Second.');
    act(() => { vi.advanceTimersByTime(MESSAGE_MS); });
    expect(region()).toBeEmptyDOMElement();
  });

  // The same sentence said twice is a new node, so a screen reader says it again.
  it('draws the same sentence said twice as a new node', () => {
    draw('Saved.');
    press('Saved.');
    const first = screen.getByText('Saved.', { selector: 'p' });
    press('Saved.');
    const second = screen.getByText('Saved.', { selector: 'p' });
    expect(second).not.toBe(first);
  });

  it('refuses to be used outside its provider, naming it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Sayer text="x" />)).toThrow('<StatusMessageProvider>');
    logged.mockRestore();
  });

  it('stops its clock when it goes away', () => {
    const { unmount } = draw('Saved.');
    press('Saved.');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
