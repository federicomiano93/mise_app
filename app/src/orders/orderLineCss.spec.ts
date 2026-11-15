// The name door's hit area (OrderLine.module.css): grown without a negative bottom margin, so the caption lines under the name can never
// be painted over its lower padding and take the taps (a layout engine is needed to measure it; this pins how the CSS grows it).

import { describe, expect, it } from 'vitest';
import css from './OrderLine.module.css?raw';

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('the name door', () => {
  it('grows its area upward by a cancelled margin-top and downward by real padding, with no negative bottom margin', () => {
    const door = rule('.door');
    expect(door).toMatch(/margin-top:\s*calc\(-1 \* var\(--s4\)\)/);
    expect(door).toMatch(/padding:\s*var\(--s4\) 0 var\(--s2\)/);
    expect(door).not.toMatch(/margin:/);
    expect(door).not.toMatch(/margin-bottom/);
  });

  it('is at least a finger wide, whatever the name or the column', () => {
    expect(rule('.door')).toMatch(/min-width:\s*44px/);
  });

  it('is matched by the plain name’s bottom space, so a row does not move', () => {
    expect(rule('.plain')).toMatch(/padding-bottom:\s*var\(--s2\)/);
  });
});
