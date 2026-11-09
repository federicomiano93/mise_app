import { describe, expect, it } from 'vitest';
import shellCss from '../shell/AppShell.module.css?raw';
import statusCss from './StatusMessage.module.css?raw';

// ⚠️ THE STATUS MESSAGE SITS A FIXED DISTANCE ABOVE THE PHONE'S TAB BAR, AND THE BAR'S HEIGHT IS
// WRITTEN IN TWO PLACES. A module cannot read another module's measure (a custom property invented
// in a component fails the token guard, and the bar's height is not a design token: it is the sum
// of its parts), so the message carries the number, 65px, as a copy. Change the bar (a taller tab,
// more padding) and the message would slide under it, with every other spec green. This adds the
// bar up from its own stylesheet and fails when the two stop agreeing.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of the FIRST rule whose selector is exactly `selector`.
function firstRule(css: string, selector: string): string {
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) return body;
  }
  throw new Error(`${selector} not found`);
}

function px(text: string | undefined, what: string): number {
  const value = Number(/(\d+(?:\.\d+)?)px/.exec(text ?? '')?.[1]);
  if (!Number.isFinite(value)) throw new Error(`no px in ${what}: ${text}`);
  return value;
}

describe('the status message clears the phone tab bar', () => {
  // Rule, line by line:
  //   .tabbar { padding: 6px 6px calc(6px + env(safe-area-inset-bottom)); border-top: 1px solid … }
  //   .tab    { min-height: 52px }
  // so the bar is 1 + 6 + 52 + 6 tall, plus the home-indicator inset (which the message adds too).
  function tabBarHeight(): number {
    const bar = firstRule(shellCss, '.tabbar');
    const tab = firstRule(shellCss, '.tab');
    const padding = /padding:\s*([^;]+);/.exec(bar)?.[1] ?? '';
    const top = px(padding, '.tabbar padding-top');
    const bottom = px(/calc\(([^+)]+)\+/.exec(padding)?.[1], '.tabbar padding-bottom');
    const border = px(/border-top:\s*([^;]+);/.exec(bar)?.[1], '.tabbar border-top');
    const height = px(/min-height:\s*([^;]+);/.exec(tab)?.[1], '.tab min-height');
    return border + top + height + bottom;
  }

  it('adds the bar up to 65px', () => {
    expect(tabBarHeight()).toBe(65);
  });

  it('offsets the message by exactly the bar\'s height, plus the same inset', () => {
    const bottom = /bottom:\s*([^;]+);/.exec(firstRule(statusCss, '.region'))?.[1] ?? '';
    expect(px(/\+\s*(\d+px)/.exec(bottom)?.[1], '.region bottom')).toBe(tabBarHeight());
    expect(bottom).toContain('env(safe-area-inset-bottom)');
  });

  // Both go at the same width: where the bar leaves, the message stops clearing it.
  it('stops clearing the bar where the bar goes (700px)', () => {
    expect(withoutComments(shellCss)).toMatch(/@media \(min-width: 700px\)[\s\S]*\.tabbar\s*\{\s*display:\s*none/);
    expect(withoutComments(statusCss)).toMatch(/@media \(min-width: 700px\)[\s\S]*\.region\s*\{[^}]*bottom:\s*var\(--s6\)/);
  });
});
