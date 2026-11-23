import { describe, expect, it } from 'vitest';
import css from './Cake3D.module.css?raw';
import tokens from '../styles/tokens.css?raw';
import { BAR_BAND } from './cake3dModel';

// ⚠️ BAR_BAND (cake3dModel.ts) is the strip the floating view buttons take at the top of the stage, written there as a number because the label
// layout is computed in script. It is the stylesheet's own sum: the bar's offset from the top, plus the height of its pill (as tall as the Home
// button beside it, `--hit`), plus the gap the labels keep under it. A change to one side that forgets the other puts the labels under the buttons.

const bare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of the rule whose selector is exactly `selector`.
function ruleBody(source: string, selector: string): string {
  for (const rule of bare(source).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if ((rule[1] ?? '').trim() === selector) return rule[2] ?? '';
  }
  throw new Error(`no rule for ${selector}`);
}

function tokenPx(name: string): number {
  const found = new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(bare(tokens));
  if (found === null) throw new Error(`no px token ${name}`);
  return Number(found[1]);
}

// «top: var(--s3)» is 12.
function declared(body: string, property: string): number {
  const found = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body);
  if (found === null) throw new Error(`no ${property}`);
  const value = (found[1] ?? '').trim();
  const token = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return token === null ? Number.parseFloat(value) : tokenPx(token[1] ?? '');
}

describe('BAR_BAND', () => {
  it('is the bar’s top offset + the pill’s height + the gap under it, as the stylesheet says them', () => {
    const top = declared(ruleBody(css, '.bar'), 'top');
    const pill = declared(ruleBody(css, '.home'), 'min-height');
    const gap = declared(ruleBody(css, '.bar'), 'gap');
    expect(top + pill + gap).toBe(BAR_BAND);
  });

  it('reads the stylesheet for real: a missing rule is an error, not a zero', () => {
    expect(() => ruleBody(css, '.nothingLikeThis')).toThrow();
  });
});
