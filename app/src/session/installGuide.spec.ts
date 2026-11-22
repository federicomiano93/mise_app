import { describe, expect, test } from 'vitest';
import { installGuideAddress, runsInstalled } from './installGuide';
import { INSTALLED_DISPLAY_QUERY } from './displayMode';

// The install guide stays the current app's own page, at the site's root (staff slice 2).
describe('installGuideAddress', () => {
  test('after the switch, Mise 2 is at the root: the guide beside it', () => {
    expect(installGuideAddress('https://x.github.io/mise_app/#/home')).toBe('https://x.github.io/mise_app/install-guide.html');
    expect(installGuideAddress('https://x.github.io/mise_app/index.html#/home')).toBe('https://x.github.io/mise_app/install-guide.html');
  });

  test('before it, Mise 2 is in /mise2/: the folder is stepped out of', () => {
    expect(installGuideAddress('https://preview.web.app/mise2/#/home')).toBe('https://preview.web.app/install-guide.html');
    expect(installGuideAddress('https://preview.web.app/mise2/index.html')).toBe('https://preview.web.app/install-guide.html');
  });

  test('nothing of the page\'s address travels with it', () => {
    expect(installGuideAddress('https://x.github.io/mise_app/?a=1#join=secret')).toBe('https://x.github.io/mise_app/install-guide.html');
  });
});

describe('runsInstalled', () => {
  const win = (standaloneQuery: boolean, iosFlag?: boolean) => ({
    matchMedia: (query: string) => ({ matches: standaloneQuery && /display-mode: standalone/.test(query) }) as MediaQueryList,
    navigator: (iosFlag === undefined ? {} : { standalone: iosFlag }) as Navigator,
  });

  test('Chromium answers the media query; iOS Safari only the flag', () => {
    expect(runsInstalled(win(true))).toBe(true);
    expect(runsInstalled(win(false, true))).toBe(true);
    expect(runsInstalled(win(false, false))).toBe(false);
    expect(runsInstalled(win(false))).toBe(false);
  });

  test('the PC app with its title bar folded into the page (window-controls-overlay) counts as installed', () => {
    const overlay = { matchMedia: (query: string) => ({ matches: /display-mode: window-controls-overlay/.test(query) }) as MediaQueryList, navigator: {} as Navigator };
    expect(runsInstalled(overlay)).toBe(true);
    expect(INSTALLED_DISPLAY_QUERY).toContain('(display-mode: standalone)');
    expect(INSTALLED_DISPLAY_QUERY).toContain('(display-mode: window-controls-overlay)');
  });

  test('a matchMedia that throws is not a crash', () => {
    expect(runsInstalled({ matchMedia: () => { throw new Error('old engine'); }, navigator: {} as Navigator })).toBe(false);
  });
});
