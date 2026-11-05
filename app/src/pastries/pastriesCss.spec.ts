import { describe, expect, it } from 'vitest';
import baseCss from '../styles/base.css?raw';
import tokensCss from '../styles/tokens.css?raw';
import shellCss from '../shell/AppShell.module.css?raw';
import pageCss from '../shell/Page.module.css?raw';
import formBarCss from '../ui/FormBar.module.css?raw';
import daysNavCss from './DaysNav.module.css?raw';
import dayPanelCss from './DayPanel.module.css?raw';
import editorCss from './Editor.module.css?raw';
import recordsCss from './Records.module.css?raw';
import sectionCss from './PastriesSection.module.css?raw';

// What a stylesheet decides and jsdom cannot see: jsdom applies no layout, so a chip pushed off the
// edge of a phone or a Confirm button scrolled out of reach is invisible to every other spec. These
// read the CSS text and add up the numbers.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of the first rule whose selector list names `selector` exactly.
function rule(css: string, selector: string): string {
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) return body;
  }
  throw new Error(`${selector} not found`);
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

// A token's value in px, from tokens.css itself.
function token(name: string): number {
  const value = Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(tokensCss)?.[1]);
  if (!Number.isFinite(value)) throw new Error(`${name} is not a px token`);
  return value;
}

describe('the seven days fit a 360px phone without a sideways scroll', () => {
  const list = rule(daysNavCss, '.list');
  const columns = declaration(list, 'grid-template-columns') ?? '';
  const min = Number(/repeat\(7,\s*minmax\((\d+)px,\s*1fr\)\)/.exec(columns)?.[1]);
  const gap = token(declaration(list, 'gap')?.replace(/var\((--[\w-]+)\)/, '$1') ?? '--none');
  // 360px wide, the page's own padding on both sides (a phone is below the shell's 700px).
  const pagePadding = token(/padding:\s*var\((--[\w-]+)\)/.exec(rule(pageCss, '.body'))?.[1] ?? '--none');
  const strip = 360 - 2 * pagePadding;

  it('shares the width in seven equal columns, none wider than its share', () => {
    expect(columns).toMatch(/^repeat\(7,\s*minmax\(\d+px,\s*1fr\)\)$/);
  });

  it('fits seven chips and six gaps in the strip of a 360px phone (328px)', () => {
    expect(strip).toBe(328);
    expect(7 * min + 6 * gap).toBeLessThanOrEqual(strip);
  });

  // Below that (a 296px phone) the strip scrolls, and the chosen day is scrolled into view (DaysNav).
  it('scrolls sideways rather than squeezing a day to a sliver', () => {
    expect(declaration(list, 'overflow-x')).toBe('auto');
    expect(7 * min + 6 * gap).toBeGreaterThan(296 - 2 * pagePadding);
  });

  it('lets a chip shrink to its column, and keeps it at least 44px tall', () => {
    const tab = rule(daysNavCss, '.tab');
    expect(declaration(tab, 'min-width')).toBe('0');
    expect(declaration(tab, 'min-height')).toBe('var(--hit-lg)');
    expect(token('--hit-lg')).toBeGreaterThanOrEqual(44);
  });
});

describe('the bottom row of a day is always on screen', () => {
  const bar = rule(dayPanelCss, '.bar');

  it('sticks to the bottom of the scrolling area, on a surface, under a rule', () => {
    expect(declaration(bar, 'position')).toBe('sticky');
    expect(declaration(bar, 'bottom')).toBe('0');
    expect(declaration(bar, 'background')).toBe('var(--surface)');
    expect(declaration(bar, 'border-top')).toMatch(/^1px solid var\(--line\)$/);
  });

  it('is followed by Records in the normal flow: the link is not sticky', () => {
    const foot = rule(dayPanelCss, '.foot');
    expect(declaration(foot, 'position')).toBeUndefined();
    const source = dayPanelCss.indexOf('.bar {') < dayPanelCss.indexOf('.foot {');
    expect(source).toBe(true);
  });

  // ⚠️ THE ROW STICKS ONLY IF NOTHING BETWEEN IT AND THE SCROLL AREA CLIPS. An `overflow` on any of
  // these would turn it into an ordinary row at the end of a long list, and Confirm would fall off
  // a tablet's screen again (1024 x 768).
  it('has nothing that clips between it and the scroll area', () => {
    const clippers: string[] = [];
    const sheets: [string, string, string[]][] = [
      ['DayPanel', dayPanelCss, ['.panel']],
      ['PastriesSection', sectionCss, ['.layout', '.days', '.detail']],
      ['Page', pageCss, ['.body']],
    ];
    for (const [name, css, selectors] of sheets) {
      for (const selector of selectors) {
        if (/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/.test(rule(css, selector))) clippers.push(`${name} ${selector}`);
      }
    }
    expect(clippers).toEqual([]);
  });

  // The scroll area is the shell's `main`, and it ends where the phone's tab bar begins: the bar is
  // the second row of the shell's grid, so the sticky row can never sit behind it.
  it('scrolls inside the shell\'s main, which ends above the tab bar', () => {
    expect(declaration(rule(shellCss, '.content'), 'overflow')).toBe('auto');
    expect(declaration(rule(shellCss, '.shell'), 'grid-template-rows')).toBe('minmax(0, 1fr) auto');
    expect(declaration(rule(shellCss, '.main'), 'min-height')).toBe('0');
  });
});

describe('the editor and Records keep their bar in reach', () => {
  it('sticks the form bar to the top of the scrolling area', () => {
    const bar = rule(formBarCss, '.bar');
    expect(declaration(bar, 'position')).toBe('sticky');
    expect(declaration(bar, 'top')).toBe('0');
    expect(declaration(bar, 'background')).toBe('var(--surface)');
  });

  it.each([['Editor', editorCss, '.editor'], ['Records', recordsCss, '.records']] as const)(
    '%s: nothing on its card clips the sticky bar',
    (_name, css, selector) => {
      expect(withoutComments(css)).not.toMatch(/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/);
      expect(rule(css, selector)).toBeTruthy();
    },
  );
});

describe('the visually-hidden recipe', () => {
  const recipe = rule(baseCss, '.visually-hidden');

  it('is defined once, in base.css, with the clip that keeps it out of sight but in the name', () => {
    expect(declaration(recipe, 'position')).toBe('absolute');
    expect(declaration(recipe, 'clip')).toBe('rect(0 0 0 0)');
    expect(declaration(recipe, 'clip-path')).toBe('inset(50%)');
    expect(declaration(recipe, 'overflow')).toBe('hidden');
    // display: none would take the text out of the accessible name.
    expect(declaration(recipe, 'display')).toBeUndefined();
    expect(declaration(recipe, 'visibility')).toBeUndefined();
  });

  it('is not copied into a component\'s stylesheet', () => {
    for (const [name, css] of Object.entries({ daysNavCss, dayPanelCss, editorCss, recordsCss, formBarCss })) {
      expect(withoutComments(css), name).not.toContain('rect(0 0 0 0)');
    }
  });
});
