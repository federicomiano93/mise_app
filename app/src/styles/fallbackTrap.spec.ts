import { describe, expect, it } from 'vitest';

// ⚠️ A "fallback" line that cannot fall back. In one rule, `prop: A; prop: calc(… var(--x) …)`: a value
// holding var() is accepted at parse time and invalidated only at computed-value time, where the property
// becomes its INITIAL value — it does NOT fall back to the earlier line. Measured on the lab tablet (Chrome 101,
// 14 Oct 2026): computed max-height `none`. So a property declared twice whose LATER declaration holds var()
// is a bug, whatever the earlier line says.
const sheets = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true });

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function findTraps(file: string, css: string): string[] {
  const traps: string[] = [];
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seen = new Set<string>();
    for (const decl of body.split(';').map(d => d.trim()).filter(Boolean)) {
      const colon = decl.indexOf(':');
      const property = decl.slice(0, colon).trim();
      if (seen.has(property) && decl.slice(colon).includes('var(')) {
        traps.push(`${file} ${selectors.trim()} → ${property}`);
      }
      seen.add(property);
    }
  }
  return traps;
}

describe('a repeated property whose later value holds var()', () => {
  it('reads the stylesheets', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(20);
  });

  it('spots the shape it forbids', () => {
    const bad = '.a { max-height: calc(var(--vh100) - 1px); max-height: calc(100dvh - var(--s4)); }';
    expect(findTraps('x.css', bad)).toEqual(['x.css .a → max-height']);
    expect(findTraps('x.css', '.a { height: 10px; height: 20px; }')).toEqual([]);
  });

  it('is never declared that way in any app stylesheet', () => {
    const traps = Object.entries(sheets).flatMap(([file, css]) => findTraps(file, css));
    expect(traps).toEqual([]);
  });
});
