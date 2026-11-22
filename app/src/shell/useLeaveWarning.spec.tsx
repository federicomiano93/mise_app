import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { browserKioskEnv } from '../kiosk/kioskEnv';
import { hasUnsavedWork, isBusy, markBusy } from '../session/busy';
import { renderApp } from '../testing/renderApp';

// Closing or reloading the page while any editor holds the busy marker makes the browser ask first — and never for the kiosk's rest screen,
// whose hold means «nobody is looking».

const held: Array<() => void> = [];
afterEach(() => { while (held.length > 0) held.pop()?.(); });
const hold = (release: () => void) => { held.push(release); return release; };

function closeThePage(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('the browser\'s «leave this page?» question', () => {
  it('is asked while an editor holds the busy marker, and not once it lets go', async () => {
    renderApp('/home');
    await screen.findByRole('navigation', { name: 'All sections' });
    expect(closeThePage()).toBe(false);
    const release = hold(markBusy());
    expect(closeThePage()).toBe(true);
    release();
    expect(closeThePage()).toBe(false);
  });

  it('is not asked for the kiosk\'s rest screen alone, but is when somebody else holds something too', async () => {
    renderApp('/home');
    await screen.findByRole('navigation', { name: 'All sections' });
    const rest = hold(browserKioskEnv().markBusy());
    expect(isBusy()).toBe(true);
    expect(hasUnsavedWork()).toBe(false);
    expect(closeThePage()).toBe(false);
    const editor = hold(markBusy());
    expect(closeThePage()).toBe(true);
    editor();
    expect(closeThePage()).toBe(false);
    rest();
  });

  it('stops asking when the shell goes away', async () => {
    renderApp('/home');
    await screen.findByRole('navigation', { name: 'All sections' });
    cleanup();
    hold(markBusy());
    expect(closeThePage()).toBe(false);
  });
});
