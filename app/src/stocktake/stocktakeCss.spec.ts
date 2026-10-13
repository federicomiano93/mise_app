import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import shellCss from '../shell/AppShell.module.css?raw';
import pageCss from '../shell/Page.module.css?raw';
import boxCss from './CountBox.module.css?raw';
import costCss from './StocktakeCost.module.css?raw';
import detailCss from './StocktakeDetail.module.css?raw';
import listCss from './CountList.module.css?raw';
import monthActionsCss from './MonthActions.module.css?raw';
import monthBarCss from './MonthBar.module.css?raw';
import productCss from './StocktakeProduct.module.css?raw';
import rowCss from './ProductRow.module.css?raw';
import columnCss from './StocktakeList.module.css?raw';
import sectionCss from './StocktakeSection.module.css?raw';

// What a stylesheet decides and jsdom cannot see: jsdom applies no layout, so a count box too small
// to type into, a name squeezed to a sliver or a row whose button covers the whole page is invisible
// to every other spec. These read the CSS text and add up the numbers.
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

// `var(--s4)` → 16.
const spaceOf = (value: string | undefined): number => token(/var\((--[\w-]+)\)/.exec(value ?? '')?.[1] ?? '--none');

describe('the count box', () => {
  const box = rule(boxCss, '.box');

  it('is at least 48px tall and 96px wide: a thumb\'s target', () => {
    expect(declaration(box, 'min-height')).toBe('var(--hit)');
    expect(token('--hit')).toBeGreaterThanOrEqual(48);
    expect(declaration(box, 'width')).toBe('96px');
  });

  it('is set in the mono face with same-width digits, right-aligned, so a column of numbers reads down', () => {
    expect(declaration(box, 'font')).toContain('var(--mono)');
    expect(declaration(box, 'font-variant-numeric')).toBe('tabular-nums');
    expect(declaration(box, 'text-align')).toBe('right');
  });

  it('is 16px or more, or iOS zooms the page in when it is focused', () => {
    const size = /var\((--fs-[\w]+)\)/.exec(declaration(box, 'font') ?? '')?.[1] ?? '--none';
    expect(token(size)).toBeGreaterThanOrEqual(16);
  });

  it('never shrinks, so the number is never cut', () => {
    expect(declaration(box, 'flex')).toBe('none');
  });

  it('looks shut when it is disabled', () => {
    expect(rule(boxCss, '.box:disabled')).toContain('background: var(--sunken)');
  });
});

describe('the row of a product', () => {
  // ⚠️ THE BUTTON IS STRETCHED OVER THE LEFT SIDE BY A PSEUDO-ELEMENT. It is positioned against
  // `.main`; if `.main` stopped being positioned, the overlay would cover the whole page and every
  // tap on it would open a product.
  it('positions the left side the button is stretched over', () => {
    expect(declaration(rule(rowCss, '.main'), 'position')).toBe('relative');
    const overlay = rule(rowCss, '.open::after');
    expect(declaration(overlay, 'position')).toBe('absolute');
    expect(declaration(overlay, 'inset')).toBe('0');
  });

  it('keeps the box clear of the button\'s overlay', () => {
    // The box is in `.count`, a sibling of `.main`, so the overlay (inside `.main`) never reaches it.
    expect(declaration(rule(rowCss, '.count'), 'flex')).toBe('none');
    expect(declaration(rule(rowCss, '.main'), 'flex')).toBe('1');
    expect(declaration(rule(rowCss, '.main'), 'min-width')).toBe('0');
  });

  it('draws the focus ring around the whole side the button covers, not around the name', () => {
    expect(declaration(rule(rowCss, '.open:focus-visible'), 'outline')).toBe('none');
    expect(declaration(rule(rowCss, '.open:focus-visible::after'), 'outline')).toContain('var(--accent)');
  });

  it('is at least as tall as a thumb\'s target', () => {
    const height = Number(/^(\d+)px$/.exec(declaration(rule(rowCss, '.row'), 'min-height') ?? '')?.[1]);
    expect(height).toBeGreaterThanOrEqual(token('--hit'));
  });

  // What is left for the name in a row of `available` px: the box, its unit (as long as the CSS lets
  // it be) and the gaps come off first.
  function nameRoom(available: number): number {
    const card = 2 * 1;
    const padding = 2 * spaceOf(/\S+$/.exec(declaration(rule(rowCss, '.row'), 'padding') ?? '')?.[0]);
    const rowGap = spaceOf(declaration(rule(rowCss, '.row'), 'gap'));
    const countGap = spaceOf(declaration(rule(rowCss, '.count'), 'gap'));
    const boxWidth = Number(/^(\d+)px$/.exec(declaration(rule(boxCss, '.box'), 'width') ?? '')?.[1]);
    const unitMax = Number(/^(\d+)px$/.exec(declaration(rule(rowCss, '.unit'), 'max-width') ?? '')?.[1]);
    return available - card - padding - rowGap - boxWidth - countGap - unitMax;
  }

  // 296px is the narrowest phone the app is measured at; the page pads both sides of it.
  it('leaves the name room on a 296px phone', () => {
    const page = spaceOf(declaration(rule(pageCss, '.body'), 'padding'));
    expect(nameRoom(296 - 2 * page)).toBeGreaterThanOrEqual(56);
  });

  it('leaves the name room in the tablet\'s list', () => {
    expect(nameRoom(token('--list-w'))).toBeGreaterThanOrEqual(120);
  });

  it('marks a row nobody has counted in the to-do colour, and keeps it readable', () => {
    expect(declaration(rule(rowCss, '.sub[data-todo="true"]'), 'color')).toBe('var(--warn-ink)');
  });
});

describe('the month bar', () => {
  it('has arrows of 48px, with the icon centred on the box', () => {
    const arrow = rule(monthBarCss, '.arrow');
    expect(declaration(arrow, 'width')).toBe('var(--hit)');
    expect(declaration(arrow, 'min-height')).toBe('var(--hit)');
    expect(declaration(arrow, 'display')).toBe('inline-flex');
    expect(declaration(arrow, 'align-items')).toBe('center');
    expect(declaration(arrow, 'justify-content')).toBe('center');
    expect(declaration(arrow, 'flex')).toBe('none');
  });

  it('lets the month\'s name take what is left and wrap, instead of pushing an arrow off a 296px phone', () => {
    const centre = rule(monthBarCss, '.centre');
    expect(declaration(centre, 'flex')).toBe('1');
    expect(declaration(centre, 'min-width')).toBe('0');
    expect(declaration(rule(monthBarCss, '.month'), 'overflow-wrap')).toBe('anywhere');
  });
});

describe('the frame keeps a bottom bar able to stick', () => {
  // ⚠️ A STICKY BAR (the month's bottom actions; the form bar of a product or of «What it cost»
  // sticks to the top) STICKS ONLY IF NOTHING BETWEEN IT AND THE SCROLL AREA CLIPS. An `overflow` on
  // any of these would turn it into an ordinary row at the end of a long list. The one scroll area
  // on purpose, the right-hand side of the split, is pinned under «the split of the frame».
  it('has nothing that clips between a bar and the scroll area', () => {
    const clippers: string[] = [];
    const phoneSection = sectionCss.slice(0, sectionCss.indexOf('@media (min-width: 1000px)'));
    const sheets: [string, string, string[]][] = [
      ['StocktakeSection', sectionCss, ['.layout', '.list']],
      ['StocktakeSection on a phone', phoneSection, ['.detail']],
      ['StocktakeList', columnCss, ['.column']],
      ['CountList', listCss, ['.list', '.group']],
      ['StocktakeDetail', detailCss, ['.prompt']],
      ['StocktakeProduct', productCss, ['.product', '.body', '.answer', '.field']],
      ['StocktakeCost', costCss, ['.cost', '.body', '.rows']],
      ['Page', pageCss, ['.body']],
    ];
    for (const [name, css, selectors] of sheets) {
      for (const selector of selectors) {
        if (/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/.test(rule(css, selector))) clippers.push(`${name} ${selector}`);
      }
    }
    expect(clippers).toEqual([]);
  });

  it('scrolls inside the shell\'s main, which ends above the tab bar', () => {
    expect(declaration(rule(shellCss, '.content'), 'overflow')).toBe('auto');
    expect(declaration(rule(shellCss, '.shell'), 'grid-template-rows')).toBe('minmax(0, 1fr) auto');
    expect(declaration(rule(shellCss, '.main'), 'min-height')).toBe('0');
  });
});

describe('the split of the frame', () => {
  const css = withoutComments(sectionCss);
  const at = css.indexOf('@media (min-width: 1000px)');
  const phone = css.slice(0, at);
  const split = css.slice(at);

  it('puts the list at the list width and gives the right-hand side the rest', () => {
    expect(at).toBeGreaterThan(0);
    expect(declaration(rule(split, '.layout'), 'grid-template-columns')).toBe('var(--list-w) minmax(0, 1fr)');
    expect(token('--list-w')).toBe(384);
  });

  // ⚠️ A product tapped far down a long list opened at the top of the page, and its title taking the
  // focus scrolled the page back up: the place in the list was lost at every product.
  it('keeps the right-hand side on screen while the list scrolls, scrolling on its own', () => {
    const detail = rule(split, '.detail');
    expect(declaration(detail, 'position')).toBe('sticky');
    expect(declaration(detail, 'top')).toBe('var(--s4)');
    expect(declaration(detail, 'overflow-y')).toBe('auto');
    // None: with `contain` a swipe on the pane could never scroll the page to show the pane's bottom
    // lines, which are under the screen's edge at scroll 0.
    expect(declaration(detail, 'overscroll-behavior')).toBeUndefined();
    // Never taller than the scroll area: the screen less the top bar and the gap above and below.
    // Two declarations, `vh` first: Chrome 101 (the lab tablet's ceiling) has no `dvh`.
    const heights = [...detail.matchAll(/max-height:\s*([^;]+);/g)].map(([, value = '']) => value.trim());
    expect(heights).toEqual([
      'calc(var(--vh100, 100vh) - var(--topbar-h) - 2 * var(--s4))',
      'calc(100dvh - var(--topbar-h) - 2 * var(--s4))',
    ]);
  });

  it('takes the top bar\'s height from the token the top bar is drawn at', () => {
    expect(declaration(rule(shellCss, '.topbar'), 'height')).toBe('var(--topbar-h)');
    expect(token('--topbar-h')).toBe(60);
  });

  it('makes both sides able to shrink, so a long name never pushes the box off the screen', () => {
    expect(declaration(rule(css, '.list'), 'min-width')).toBe('0');
    expect(declaration(rule(css, '.detail'), 'min-width')).toBe('0');
  });

  // The two phone-only rules: with the list on screen the prompt on the right is not drawn, and with
  // a product or the cost open the list is not drawn behind it. Hidden, not unmounted.
  it('hides, on a phone only, the prompt behind the list and the list behind a product', () => {
    const hiddenOnPhone = [...phone.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)]
      .flatMap(([, selectors = '']) => selectors.split(',').map(s => s.trim()));
    expect(hiddenOnPhone).toContain('.layout[data-view="list"] .detail');
    expect(hiddenOnPhone).toContain('.layout[data-view="product"] .list');
    expect(hiddenOnPhone).toContain('.layout[data-view="cost"] .list');
    expect(split).not.toContain('display: none');
  });
});

describe('the month\'s bottom bar', () => {
  const css = withoutComments(monthActionsCss);
  const at = css.indexOf('@media (min-width: 1000px)');
  const bar = rule(css.slice(0, at), '.bar');

  // ⚠️ Stuck to the bottom of a 296×668 phone it took a fifth of the screen, and the first screen
  // showed no product at all.
  it('is the list\'s last block on a phone, never stuck over the rows', () => {
    expect(at).toBeGreaterThan(0);
    expect(declaration(bar, 'position')).toBeUndefined();
    expect(declaration(bar, 'bottom')).toBeUndefined();
  });

  it('sticks to the bottom of the scrolling area on the split, above the rows that pass under it', () => {
    const split = rule(css.slice(at), '.bar');
    expect(declaration(split, 'position')).toBe('sticky');
    expect(declaration(split, 'bottom')).toBe('0');
    expect(Number(declaration(split, 'z-index'))).toBeGreaterThan(0);
    expect(declaration(bar, 'background')).toBe('var(--surface)');
  });

  it('lets its buttons wrap onto a second line on the narrowest phone, instead of squeezing a word', () => {
    expect(declaration(bar, 'display')).toBe('flex');
    expect(declaration(bar, 'flex-wrap')).toBe('wrap');
    expect(declaration(rule(monthActionsCss, '.action'), 'flex')).toBe('1 1 140px');
  });
});

describe('the answer of a product', () => {
  it('is quiet while it is not known, and in the warning colours when it cannot be right', () => {
    expect(declaration(rule(productCss, '.answer[data-state="unknown"]'), 'border-style')).toBe('dashed');
    const negative = rule(productCss, '.answer[data-state="negative"]');
    expect(declaration(negative, 'background')).toBe('var(--warn-tint)');
    expect(declaration(rule(productCss, '.answerWarn'), 'color')).toBe('var(--warn-ink)');
  });

  it('keeps the number in same-width digits and lets a long unit wrap', () => {
    const value = rule(productCss, '.answerValue');
    expect(declaration(value, 'font-variant-numeric')).toBe('tabular-nums');
    expect(declaration(value, 'overflow-wrap')).toBe('anywhere');
  });
});

describe('what it cost', () => {
  it('sets the money on the right in same-width digits and never lets it shrink', () => {
    const value = rule(costCss, '.value');
    expect(declaration(value, 'flex')).toBe('none');
    expect(declaration(value, 'font-variant-numeric')).toBe('tabular-nums');
  });

  it('lets the name take what is left and wrap, so a long name never pushes the money off a 296px phone', () => {
    expect(declaration(rule(costCss, '.main'), 'min-width')).toBe('0');
    expect(declaration(rule(costCss, '.name'), 'overflow-wrap')).toBe('anywhere');
  });

  it('draws a row with no value quieter than one with', () => {
    const quiet = rule(costCss, '.row[data-unvalued="true"] .name');
    expect(declaration(quiet, 'color')).toBe('var(--ink-2)');
    expect(declaration(quiet, 'font-weight')).toBe('500');
  });
});
