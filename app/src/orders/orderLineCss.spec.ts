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

// The open supplier's compact row (16 Nov 2026): its columns are the column names' (SupplierOrderScreen.module.css), on the split
// and on a phone; the card is one colour, its controls grey with no border, and a quantity tints only the − / box / + block.
import headCss from './SupplierOrderScreen.module.css?raw';

const bare = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const splitPart = (text: string) => bare(text).split('@media (min-width: 1000px)').slice(1).join('');
const phonePart = (text: string) => bare(text).split('@media (min-width: 1000px)')[0] ?? '';
const columnsOf = (text: string, selector: string) => new RegExp(`${selector.replace(/[.[\]"=]/g, m => `\\${m}`)}\\s*\\{[^}]*grid-template-columns:\\s*([^;]+);`).exec(text)?.[1];

describe('the compact row', () => {
  it('has the same columns as the column names, on the split and on a phone', () => {
    expect(columnsOf(splitPart(css), '.compact')).toBe('minmax(0, 1fr) 96px 148px 64px');
    expect(columnsOf(splitPart(headCss), '.columns')).toBe(columnsOf(splitPart(css), '.compact'));
    expect(columnsOf(phonePart(css), '.compact')).toBe('minmax(0, 1fr) 88px');
    expect(columnsOf(phonePart(headCss), '.columns')).toBe(columnsOf(phonePart(css), '.compact'));
  });

  it('is one row on the split and two levels on a phone', () => {
    expect(splitPart(css)).toMatch(/grid-template-areas:\s*"main unit qty stock"/);
    expect(phonePart(css)).toMatch(/grid-template-areas:\s*"main unit"\s*"qty stock"/);
  });

  it('draws no line between rows and does not tint a row with a quantity: only its block', () => {
    expect(bare(css)).toMatch(/\.compact\s*\{[^}]*border-bottom:\s*0/);
    expect(bare(css)).toMatch(/\.compact\[data-filled="true"\]\s*\{\s*background:\s*none;/);
    expect(bare(css)).toMatch(/\.compact\[data-filled="true"\] \.stepper\s*\{\s*background:\s*var\(--accent-tint\);/);
    expect(bare(css)).toMatch(/\.compact\[data-filled="true"\] \.stepper \.box\s*\{\s*color:\s*var\(--accent-ink\);/);
  });

  it('draws its controls as grey fields with no border, every target at least 44px', () => {
    for (const selector of ['.compact .unitSelect', '.compact .stock .box', '.stepper']) {
      const rule = new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(bare(css))?.[1] ?? '';
      expect(rule, selector).toMatch(/background:\s*var\(--sunken\)/);
      expect(rule, selector).toMatch(/(min-)?height:\s*44px/);
    }
    expect(bare(css)).toMatch(/\.stepper \.step\s*\{[^}]*width:\s*44px;[^}]*border:\s*0;/);
  });

  it('keeps the open card one colour on the split: no border, and the head\'s icons grey with no border', () => {
    expect(splitPart(headCss)).toMatch(/\.screen\s*\{[^}]*border:\s*0;/);
    expect(bare(headCss)).toMatch(/\.icon,\s*\.summary\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--sunken\)/);
    // The name on ONE line, cut with an ellipsis.
    expect(bare(headCss)).toMatch(/\.name\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  });
});
