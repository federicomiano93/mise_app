import { describe, expect, it } from 'vitest';
import shellCss from './AppShell.module.css?raw';
import pageCss from './Page.module.css?raw';

// index.html says viewport-fit=cover, so the page reaches under a notch or a camera cut-out.
// jsdom has no notch, so these pin the rules in the stylesheet text: they fail if someone
// "simplifies" an env() away and the icons slide under the notch on an iPhone in landscape.

const rule = (css: string, selector: string): string => {
  const match = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`${selector} not found`);
  return match[1] ?? '';
};

describe('safe areas', () => {
  it('gives the rail column its width plus the left inset, from 700px', () => {
    const tablet = shellCss.slice(shellCss.indexOf('@media (min-width: 700px)'));
    expect(tablet).toMatch(
      /grid-template-columns:\s*calc\(var\(--rail-w\) \+ env\(safe-area-inset-left\)\) minmax\(0, 1fr\)/,
    );
  });

  it('pads the rail by the same left inset, so its items keep their width', () => {
    expect(rule(shellCss, '.rail')).toMatch(/padding:[^;]*calc\(var\(--s2\) \+ env\(safe-area-inset-left\)\)/);
  });

  it('keeps the top bar clear of the right inset', () => {
    expect(rule(shellCss, '.topbar')).toMatch(/padding:[^;]*calc\(var\(--s6\) \+ env\(safe-area-inset-right\)\)/);
  });

  it('keeps the page content clear of the right inset from 700px only', () => {
    const [phone = '', tablet = ''] = pageCss.split('@media (min-width: 700px)');
    expect(phone).not.toMatch(/safe-area-inset/);
    expect(rule(tablet, '.head')).toMatch(/calc\(var\(--s8\) \+ env\(safe-area-inset-right\)\)/);
    expect(rule(tablet, '.body')).toMatch(/calc\(var\(--s8\) \+ env\(safe-area-inset-right\)\)/);
  });

  it('leaves the phone tab bar with the bottom inset it already had', () => {
    expect(rule(shellCss, '.tabbar')).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(rule(shellCss, '.tabbar')).not.toMatch(/safe-area-inset-(left|right)/);
  });
});
