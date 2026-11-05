import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import badgeCss from './DayBadge.module.css?raw';
import cardCss from './LogCard.module.css?raw';
import frameCss from './DoughHistory.module.css?raw';
import oneCss from './LogOne.module.css?raw';
import editorCss from './LogEditor.module.css?raw';

// What a stylesheet decides and jsdom cannot see: the split must not clip the list's sticky bar, the right-hand side
// must scroll on its own, a target must be a thumb's size, and a coloured word must be readable on its colour.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of every rule whose selector list names `selector` exactly, outside any @media (or, with
// `inMedia`, inside the stylesheet's @media (min-width) block).
function rule(css: string, selector: string, inMedia = false): string {
  const text = withoutComments(css);
  const media = /@media \(min-width: 1000px\)\s*\{([\s\S]*)\}\s*$/.exec(text)?.[1] ?? '';
  const scope = inMedia ? media : text.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const bodies: string[] = [];
  for (const [, selectors = '', body = ''] of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) bodies.push(body);
  }
  if (bodies.length === 0) throw new Error(`${selector} not found`);
  return bodies.join(';');
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

// ── Colour: tokens.css speaks oklch; contrast is worked out in sRGB (WCAG) ────────────────────────────────────
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

const varName = (value: string | undefined): string => /var\((--[\w-]+)\)/.exec(value ?? '')?.[1] ?? '--none';

describe('the day badge', () => {
  it.each([
    ['.badge', '.badge'],
    ['.badge[data-tone="today"]', '.badge[data-tone="today"]'],
    ['.badge[data-tone="tomorrow"]', '.badge[data-tone="tomorrow"]'],
  ])('%s reads at 4.5:1 or better: its own ink on its own tint', (selector) => {
    // The base rule is the muted «past» look; the others override both colours.
    const body = rule(badgeCss, selector);
    const ink = varName(declaration(body, 'color'));
    const ground = varName(declaration(body, 'background'));
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
  });

  it('is set in the small text size, which needs that ratio', () => {
    expect(declaration(rule(badgeCss, '.badge'), 'font-size')).toBe('var(--fs-sm)');
  });
});

describe('the Delete icon of a log', () => {
  const button = rule(oneCss, '.delete');

  it('is a 48px target drawn small, quiet at rest and in the danger colours when pressed or hovered', () => {
    expect(declaration(button, 'width')).toBe('var(--hit)');
    expect(declaration(button, 'height')).toBe('var(--hit)');
    expect(declaration(button, 'color')).toBe('var(--ink-3)');
    const state = rule(oneCss, '.delete[data-hovered]');
    expect(contrast(varName(declaration(state, 'color')), varName(declaration(state, 'background')))).toBeGreaterThanOrEqual(4.5);
  });

  it('is a visible icon at rest: 3:1 on the card it sits on', () => {
    expect(contrast('--ink-3', '--surface')).toBeGreaterThanOrEqual(3);
  });
});

describe('a log\'s card', () => {
  it('has a button as tall as a thumb\'s target, stretched over the whole card', () => {
    expect(declaration(rule(cardCss, '.open'), 'min-height')).toBe('var(--hit)');
    const stretch = rule(cardCss, '.open::after');
    expect(declaration(stretch, 'position')).toBe('absolute');
    expect(declaration(stretch, 'inset')).toBe('0');
    expect(declaration(rule(cardCss, '.card'), 'position')).toBe('relative');
  });

  it('shows a focus ring around the whole card', () => {
    expect(declaration(rule(cardCss, '.open:focus-visible::after'), 'outline')).toContain('var(--accent)');
  });

  it('shows the open log\'s card in the accent tint with an ink that reads on it', () => {
    expect(declaration(rule(cardCss, '.card[data-open="true"]'), 'background')).toBe('var(--accent-tint)');
    expect(contrast('--ink', '--accent-tint')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('--ink-2', '--accent-tint')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the split', () => {
  it('has the list on the left (--list-w) and the open log on the right, from 1000px', () => {
    expect(declaration(rule(frameCss, '.layout', true), 'grid-template-columns')).toContain('var(--list-w)');
  });

  it('lets nothing between the scroll area and the list clip: the list\'s bar sticks to the top of the screen', () => {
    for (const selector of ['.layout', '.list']) {
      expect(declaration(rule(frameCss, selector), 'overflow')).toBeUndefined();
      expect(declaration(rule(frameCss, selector), 'overflow-y')).toBeUndefined();
    }
    expect(withoutComments(frameCss)).not.toMatch(/overscroll-behavior/);
  });

  it('keeps the right-hand side on screen and scrolling on its own, never taller than the screen', () => {
    const detail = rule(frameCss, '.detail', true);
    expect(declaration(detail, 'position')).toBe('sticky');
    expect(declaration(detail, 'overflow-y')).toBe('auto');
    expect(detail).toContain('var(--vh100)');
  });

  it('does not clip the right-hand side on a phone, where the bar of a log sticks too', () => {
    expect(declaration(rule(frameCss, '.detail'), 'overflow-y')).toBeUndefined();
    expect(declaration(rule(frameCss, '.detail'), 'position')).toBeUndefined();
  });
});

describe('the choice buttons of Add dough', () => {
  it('are a thumb\'s target, and each state reads at 4.5:1 or better on its own ground', () => {
    expect(declaration(rule(editorCss, '.choice'), 'min-height')).toBe('var(--hit)');
    for (const selector of ['.choice', '.choice[data-selected]', '.missing .choice']) {
      const body = rule(editorCss, selector);
      expect(contrast(varName(declaration(body, 'color')), varName(declaration(body, 'background')))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('say «Choose Today or Tomorrow first» in the danger ink on the card', () => {
    expect(contrast(varName(declaration(rule(editorCss, '.alert'), 'color')), '--surface')).toBeGreaterThanOrEqual(4.5);
  });
});
