import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import pageCss from '../shell/Page.module.css?raw';
import detailCss from './FoodcostDetail.module.css?raw';
import settingsCss from './FoodcostSettings.module.css?raw';
import historyCss from './MarginHistory.module.css?raw';
import listCss from './FoodcostList.module.css?raw';
import editorCss from './ProductEditor.module.css?raw';
import rowCss from './ProductRow.module.css?raw';
import sectionCss from './FoodcostSection.module.css?raw';
import lineCss from './LineRow.module.css?raw';
import weighCss from './CookingSection.module.css?raw';
import previewCss from './PreviewPanel.module.css?raw';
import readCss from './ReadSections.module.css?raw';

// What a stylesheet decides and jsdom cannot see: jsdom applies no layout, so a row too short to
// tap, a card that clips the bar stuck to its top or a pane that does not scroll on its own is
// invisible to every other spec. These read the CSS text.
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

function token(name: string): number {
  const value = Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(tokensCss)?.[1]);
  if (!Number.isFinite(value)) throw new Error(`${name} is not a px token`);
  return value;
}

describe('the row of a product', () => {
  it('is at least as tall as a thumb\'s target, and the whole row is the button', () => {
    const row = rule(rowCss, '.row');
    expect(Number(/^(\d+)px$/.exec(declaration(row, 'min-height') ?? '')?.[1])).toBeGreaterThanOrEqual(token('--hit'));
    expect(declaration(row, 'width')).toBe('100%');
  });

  it('lets the name take what is left and wrap, instead of pushing the figure off a 296px phone', () => {
    expect(declaration(rule(rowCss, '.main'), 'flex')).toBe('1');
    expect(declaration(rule(rowCss, '.main'), 'min-width')).toBe('0');
    expect(declaration(rule(rowCss, '.name'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(rowCss, '.sub'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(rowCss, '.figure'), 'flex')).toBe('none');
  });

  it('draws a visible focus ring', () => {
    expect(declaration(rule(rowCss, '.row:focus-visible'), 'outline')).toContain('var(--accent)');
  });

  it('colours the light in three different tokens, and the unknown one quietly', () => {
    const colours = ['green', 'amber', 'red'].map(status => declaration(rule(rowCss, `.dot[data-status="${status}"]`), 'background'));
    expect(colours).toEqual(['var(--ok)', 'var(--warn)', 'var(--danger)']);
    expect(declaration(rule(rowCss, '.dot'), 'background')).toBe('var(--line-2)');
  });

  it('marks a product that cannot be costed in the to-do colour, which stays readable', () => {
    expect(declaration(rule(rowCss, '.sub[data-todo="true"]'), 'color')).toBe('var(--warn-ink)');
  });
});

describe('the frame keeps a form bar able to stick', () => {
  // The form bar of a screen sticks to the top of the scroll area only if nothing between them
  // clips. An `overflow` on any of these would turn it into an ordinary row. The one scroll area on
  // purpose, the right-hand side of the split, is pinned under «the split of the frame».
  it('has nothing that clips between a bar and the scroll area', () => {
    const clippers: string[] = [];
    const phoneSection = sectionCss.slice(0, sectionCss.indexOf('@media (min-width: 1000px)'));
    const sheets: [string, string, string[]][] = [
      ['FoodcostSection', sectionCss, ['.layout', '.list']],
      ['FoodcostSection on a phone', phoneSection, ['.detail']],
      ['FoodcostList', listCss, ['.column', '.rows']],
      ['FoodcostDetail', detailCss, ['.prompt']],
      ['ProductEditor', editorCss, ['.editor', '.body']],
      ['MarginHistory', historyCss, ['.history', '.body', '.rows']],
      ['FoodcostSettings', settingsCss, ['.settings', '.body', '.card']],
      ['Page', pageCss, ['.body']],
    ];
    for (const [name, css, selectors] of sheets) {
      for (const selector of selectors) {
        if (/overflow(-[xy])?:\s*(hidden|auto|scroll|clip)/.test(rule(css, selector))) clippers.push(`${name} ${selector}`);
      }
    }
    expect(clippers).toEqual([]);
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
  });

  // A product tapped far down a long list opened at the top of the page, and its title taking the
  // focus scrolled the page back up: the place in the list was lost at every product.
  it('keeps the right-hand side on screen while the list scrolls, scrolling on its own', () => {
    const detail = rule(split, '.detail');
    expect(declaration(detail, 'position')).toBe('sticky');
    expect(declaration(detail, 'top')).toBe('var(--s4)');
    expect(declaration(detail, 'overflow-y')).toBe('auto');
    expect(declaration(detail, 'overscroll-behavior')).toBeUndefined();
    const heights = [...detail.matchAll(/max-height:\s*([^;]+);/g)].map(([, value = '']) => value.trim());
    expect(heights).toEqual([
      'calc(var(--vh100) - var(--topbar-h) - 2 * var(--s4))',
    ]);
  });

  it('makes both sides able to shrink, so a long name never pushes the figure off the screen', () => {
    expect(declaration(rule(css, '.list'), 'min-width')).toBe('0');
    expect(declaration(rule(css, '.detail'), 'min-width')).toBe('0');
  });

  it('hides, on a phone only, the prompt behind the list and the list behind a screen', () => {
    const hiddenOnPhone = [...phone.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)]
      .flatMap(([, selectors = '']) => selectors.split(',').map(s => s.trim()));
    expect(hiddenOnPhone).toContain('.layout[data-view="list"] .detail');
    expect(hiddenOnPhone).toContain('.layout[data-view="detail"] .list');
    expect(split).not.toContain('display: none');
  });
});

describe('the labour cost box', () => {
  const input = rule(settingsCss, '.input');

  it('is 48px tall and 16px or more, or iOS zooms the page in when it is focused', () => {
    expect(declaration(input, 'min-height')).toBe('var(--hit)');
    const size = /var\((--fs-[\w]+)\)/.exec(declaration(input, 'font') ?? '')?.[1] ?? '--none';
    expect(token(size)).toBeGreaterThanOrEqual(16);
  });

  it('shows a refused number in the danger colours, with the message saying it too', () => {
    expect(declaration(rule(settingsCss, '.isError'), 'border-color')).toBe('var(--danger)');
  });
});

// ── The weighing boxes and the amount boxes (current app df7e6313, tests/foodcost-line-units-and-switch.test.mjs) ─────────────
function luminance(name: string): number {
  const match = new RegExp(`${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`).exec(tokensCss);
  if (!match) throw new Error(`${name} is not an oklch token`);
  const [L, C, h] = [Number(match[1]), Number(match[2]), (Number(match[3]) * Math.PI) / 180];
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(v => Math.min(1, Math.max(0, v)));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

describe('the amount boxes', () => {
  it('are sized in ch for nine characters, not a guessed pixel width, so a weight is never cut', () => {
    for (const [css, selector] of [[lineCss, '.qty'], [weighCss, '.input']] as const) {
      const body = rule(css, selector);
      expect(declaration(body, selector === '.qty' ? 'width' : 'min-width'), selector).toMatch(/^calc\(9ch \+ 2 \* var\(--s[23]\) \+ 3px\)$/);
    }
    expect(declaration(rule(lineCss, '.qty'), 'flex')).toBe('none');
    expect(declaration(rule(lineCss, '.qty'), 'font-variant-numeric')).toBe('tabular-nums');
  });
});

describe('the «Cottura» pair', () => {
  it('puts a box under the other rather than run it over its neighbour, and «use the total» has no frame', () => {
    // jsdom has no layout: the slice's driver measures each box inside its cell at 1024, 360 and 296. These are the declarations that
    // decide it — a cell free to shrink below its box (min-width: 0) keeps the two on one line and overlaps them.
    expect(declaration(rule(weighCss, '.pair'), 'flex-wrap')).toBe('wrap');
    expect(declaration(rule(weighCss, '.cell'), 'min-width')).toBeUndefined();
    const link = rule(weighCss, '.useTotal');
    expect(declaration(link, 'border')).toBe('0');
    expect(declaration(link, 'background')).toBe('none');
  });
});

describe('a wrong dough weighing', () => {
  it('keeps its warning in red that reads on the card (4.5:1 for small text), and frames the cooked box', () => {
    expect(declaration(rule(weighCss, '.warn'), 'color')).toBe('var(--danger-ink)');
    expect(contrast('--danger-ink', '--surface')).toBeGreaterThanOrEqual(4.5);
    const framed = rule(weighCss, '.input[data-invalid="true"]');
    expect(declaration(framed, 'border-color')).toBe('var(--danger)');
    expect(declaration(framed, 'box-shadow')).toContain('var(--danger)');
  });
});

describe('the money under a line and the «Which?» list', () => {
  it('the money is quiet secondary text that wraps at 296px (muted token, small size), never a warning colour', () => {
    const body = rule(lineCss, '.cost');
    expect(declaration(body, 'color')).toBe('var(--ink-2)');
    expect(declaration(body, 'font-size')).toBe('var(--fs-sm)');
    expect(declaration(body, 'overflow-wrap')).toBe('anywhere');
    expect(contrast('--ink-2', '--surface')).toBeGreaterThanOrEqual(4.5);
    const read = rule(readCss, '.row dd.cost');
    expect(declaration(read, 'flex')).toBe('1 0 100%');
    expect(declaration(read, 'color')).toBe('var(--ink-2)');
  });

  it('«Which?» is a target as tall and wide as a thumb, quiet text with a visible focus ring', () => {
    const button = rule(previewCss, '.whichButton');
    expect(declaration(button, 'min-height')).toBe('var(--hit)');
    expect(declaration(button, 'min-width')).toBe('var(--hit)');
    expect(token('--hit')).toBeGreaterThanOrEqual(44);
    expect(declaration(rule(previewCss, '.whichButton[data-focus-visible]'), 'outline')).toContain('var(--accent)');
    expect(declaration(rule(previewCss, '.whichList'), 'font-size')).toBe('var(--fs-sm)');
    expect(declaration(rule(previewCss, '.whichList li'), 'overflow-wrap')).toBe('anywhere');
  });

  it('use nothing the lab tablet (Chrome 101) lacks', () => {
    for (const css of [lineCss, previewCss, readCss]) {
      expect(withoutComments(css)).not.toMatch(/:has\(|color-mix|@container|container-type/);
    }
  });
});
