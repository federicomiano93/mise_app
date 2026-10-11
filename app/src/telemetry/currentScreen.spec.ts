import { afterEach, describe, expect, test } from 'vitest';
import { currentScreen, trackScreens } from './currentScreen';
import { announceScreen, MISE2_PAGE, SCREEN_EVENT } from './usage';

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

describe('currentScreen', () => {
  test('before any screen has been announced it is the app itself', () => {
    stop = trackScreens();
    expect(currentScreen()).toBe(MISE2_PAGE);
    expect(currentScreen()).toBe('m2');
  });

  test('it is the last screen announced, named the way the usage record names it', () => {
    stop = trackScreens();
    announceScreen('orders');
    expect(currentScreen()).toBe('m2:orders');
    announceScreen('recipes');
    expect(currentScreen()).toBe('m2:recipes');
    announceScreen('not-found');
    expect(currentScreen()).toBe('m2:not-found');
  });

  test('an empty name is the app\'s own front, as in the usage tracker', () => {
    stop = trackScreens();
    announceScreen('orders');
    announceScreen('');
    expect(currentScreen()).toBe('m2');
  });

  test('a name the usage record would refuse is not kept either', () => {
    stop = trackScreens();
    announceScreen('orders');
    announceScreen('Has Capitals');
    announceScreen('x'.repeat(38));
    window.dispatchEvent(new CustomEvent(SCREEN_EVENT, { detail: 42 }));
    window.dispatchEvent(new CustomEvent(SCREEN_EVENT));
    expect(currentScreen()).toBe('m2:orders');
  });

  test('stopping it forgets the screen and stops listening', () => {
    stop = trackScreens();
    announceScreen('orders');
    stop();
    stop = null;
    expect(currentScreen()).toBe('m2');
    announceScreen('recipes');
    expect(currentScreen()).toBe('m2');
  });

  test('it can follow another target than the window', () => {
    const target = new EventTarget();
    stop = trackScreens(target);
    target.dispatchEvent(new CustomEvent(SCREEN_EVENT, { detail: 'settings' }));
    expect(currentScreen()).toBe('m2:settings');
    announceScreen('orders');
    expect(currentScreen()).toBe('m2:settings');
  });
});
