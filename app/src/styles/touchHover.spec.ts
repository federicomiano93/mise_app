import { describe, expect, it } from 'vitest';

// ⚠️ A :hover LOOK STICKS AFTER A TAP ON A TOUCH SCREEN. Driven on the lab tablet (14 Oct 2026): the rail item last
// tapped kept its hover colour after another one had been chosen, so two items looked picked. Every :hover rule
// therefore sits inside `@media (hover: hover)`, which a touch screen does not match. This reads every stylesheet.
const sheets = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true });

// A :hover that looks exactly like the state it belongs to cannot stick visibly: it exists to beat another hover rule.
const SAME_AS_STATE = new Set(['.switchOn:hover']);

function unguardedHovers(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  const stack: string[] = [];
  let prelude = '';
  for (const ch of text) {
    if (ch === '{') {
      if (/:hover/.test(prelude) && !stack.some(s => /@media[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(s))) {
        for (const selector of prelude.split(',').map(s => s.trim()).filter(s => s.includes(':hover'))) {
          if (!SAME_AS_STATE.has(selector)) found.push(selector);
        }
      }
      stack.push(prelude.trim());
      prelude = '';
    } else if (ch === '}') {
      stack.pop();
      prelude = '';
    } else if (ch === ';') {
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  return found;
}

describe(':hover on a touch screen', () => {
  it('finds the stylesheets, and finds a hover rule it would refuse', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(20);
    expect(unguardedHovers('.a:hover { color: red; }')).toEqual(['.a:hover']);
    expect(unguardedHovers('@media (hover: hover) { .a:hover { color: red; } }')).toEqual([]);
  });

  it('keeps every :hover inside @media (hover: hover)', () => {
    const missing = Object.entries(sheets).flatMap(([file, css]) => unguardedHovers(css).map(s => `${file} ${s}`));
    expect(missing).toEqual([]);
  });
});
