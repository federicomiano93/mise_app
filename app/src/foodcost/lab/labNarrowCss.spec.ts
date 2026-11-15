import { describe, expect, it } from 'vitest';
import css from './LabMode.module.css?raw';
import keypadCss from './Keypad.module.css?raw';

// What the stylesheets decide and jsdom cannot see: on a phone the step's content scrolls above a docked keypad, an ingredient is two rows,
// and both bottom buttons fit at 296. Read from the CSS text (jsdom applies no layout).
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

// The text between the braces of an `@media (query) { … }` that holds `marker` (the file has several for the same query), found by counting braces.
function media(source: string, query: string, marker: string): string {
  const text = strip(source);
  let from = 0;
  for (;;) {
    const start = text.indexOf(`@media (${query}) {`, from);
    if (start < 0) throw new Error(`@media (${query}) holding ${marker} not found`);
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          const block = text.slice(open + 1, i);
          if (block.includes(marker)) return block;
          from = i;
          break;
        }
      }
    }
  }
}

function rule(text: string, selector: string): string {
  for (const [, selectors = '', body = ''] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim().replace(/\s+/g, ' ')).includes(selector)) return body;
  }
  throw new Error(`${selector} not found`);
}

const decl = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim().replace(/\s+/g, ' ');
const px = (value: string | undefined): number => Number(/^(\d+)px$/.exec(value ?? '')?.[1]);

const narrow = media(css, 'max-width: 719px', '.scroll');
const tiny = media(css, 'max-width: 359px', '.backText');
const wide = media(css, 'min-width: 720px', '.line');

describe('lab mode on a phone', () => {
  it('has one scroll area per step: the fields above the keypad, or the step\'s own region', () => {
    expect(decl(rule(strip(css), '.fields'), 'overflow-y')).toBe('auto');
    expect(decl(rule(narrow, '.scroll'), 'overflow-y')).toBe('auto');
    expect(decl(rule(narrow, '.scroll'), 'min-height')).toBe('0');
    expect(decl(rule(narrow, '.scroll'), 'flex')).toBe('1 1 0');
    // The keypad is docked under the scroll area and never shrinks over it.
    expect(decl(rule(strip(css), '.padCell'), 'flex')).toBe('none');
    expect(decl(rule(strip(css), '.work'), 'flex-direction')).toBe('column');
  });

  it('lays an ingredient out in two rows: the name across, then the tick, the planned amount and the weighed box', () => {
    const line = rule(narrow, '.line');
    expect(decl(line, 'grid-template-areas')).toBe('"name name name" "tick planned field"');
    expect(px(/^(\d+px)/.exec(decl(line, 'grid-template-columns') ?? '')?.[1])).toBeGreaterThanOrEqual(44);
  });

  it('keeps every target at 44px or more', () => {
    expect(px(decl(rule(narrow, '.tick'), 'width'))).toBeGreaterThanOrEqual(44);
    expect(px(decl(rule(narrow, '.tick'), 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(decl(rule(narrow, '.stepperButton'), 'width'))).toBeGreaterThanOrEqual(44);
    expect(px(decl(rule(narrow, '.stepperButton'), 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(decl(rule(narrow, '.field[data-size="line"]'), 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(decl(rule(strip(keypadCss), '.key'), 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(decl(rule(tiny, '.bottom .secondaryBig'), 'width'))).toBeGreaterThanOrEqual(44);
  });

  it('wraps a name by words, never one letter per line', () => {
    expect(decl(rule(narrow, '.lineTitle'), 'overflow-wrap')).toBe('break-word');
    expect(narrow).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('shares the bottom bar between the two buttons, and shrinks «Indietro» to an arrow below 360px', () => {
    const buttons = rule(narrow, '.secondaryBig');
    expect(decl(buttons, 'flex')).toBe('1 1 0');
    expect(decl(buttons, 'min-width')).toBe('0');
    const back = rule(tiny, '.bottom .secondaryBig');
    expect(decl(back, 'flex')).toBe('0 0 56px');
    // Its name stays for assistive technology: clipped, never display: none.
    expect(decl(rule(tiny, '.backText'), 'clip')).toBeDefined();
    expect(tiny).not.toMatch(/\.backText\s*\{[^}]*display:\s*none/);
  });

  it('puts «Persone» on one line beside the stepper and the note on the «Tempo» line', () => {
    expect(decl(rule(narrow, '.peopleRow'), 'flex-direction')).toBe('row');
    expect(decl(rule(narrow, '.timeHead'), 'display')).toBe('flex');
  });
});

describe('the tablet layout is left as it was', () => {
  it('keeps the four columns of a line, and the tick at 60px', () => {
    expect(decl(rule(wide, '.line'), 'grid-template-areas')).toBe('"tick name planned field"');
    expect(px(decl(rule(strip(css), '.tick'), 'width'))).toBe(60);
    expect(px(decl(rule(strip(css), '.stepperButton'), 'width'))).toBe(64);
    expect(decl(rule(strip(css), '.lineTitle'), 'overflow-wrap')).toBe('anywhere');
  });

  it('keeps the note under the box through display: contents and order', () => {
    expect(decl(rule(strip(css), '.timeHead'), 'display')).toBe('contents');
    expect(decl(rule(strip(css), '.timeNote'), 'order')).toBe('2');
    expect(decl(rule(strip(css), '.backIcon'), 'display')).toBe('none');
  });
});
