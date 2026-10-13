import { describe, expect, it } from 'vitest';
import css from './SettingSwitch.module.css?raw';

// React Aria hides the switch's real checkbox in an absolutely positioned span. Without a positioned switch around it,
// that span was placed against the whole page and a switch low in a list made the page taller than the window
// (870px of the lab tablet's 648, 13 Oct 2026). jsdom lays nothing out, so the rule is read from the CSS.
describe('the setting switch', () => {
  it('is the positioned box its hidden checkbox is placed in', () => {
    const body = /\.switch\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? '';
    expect(body).toMatch(/position:\s*relative/);
  });
});
