import { describe, expect, it } from 'vitest';
import tokensCss from '../styles/tokens.css?raw';
import doorCss from './Door.module.css?raw';
import hubCss from './CalculatorSettings.module.css?raw';
import partsCss from './SettingsParts.module.css?raw';
import screenCss from './SettingsScreen.module.css?raw';
import switchCss from './SettingSwitch.module.css?raw';
import logCss from './LogSettings.module.css?raw';
import divisorCss from './DivisorSettings.module.css?raw';

// What the stylesheets of Settings decide and jsdom cannot see (it applies no layout).
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(css: string, selector: string): string {
  const bodies: string[] = [];
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) bodies.push(body);
  }
  if (bodies.length === 0) throw new Error(`${selector} not found`);
  return bodies.join(';');
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

describe('the targets of Settings', () => {
  it('the token behind them is a target for a thumb', () => {
    expect(Number(/--hit:\s*(\d+)px/.exec(tokensCss)?.[1])).toBeGreaterThanOrEqual(48);
  });

  it.each([
    ['a door', doorCss, '.door'],
    ['a row with a switch', hubCss, '.row'],
    ['a row of an editing screen', partsCss, '.row'],
    ['a row of the Dough history', logCss, '.row'],
    ['a product to tick', divisorCss, '.tick'],
    ['the switch', switchCss, '.switch'],
    ['the hours', logCss, '.select'],
  ])('%s is at least 48px tall', (_name, css, selector) => {
    expect(declaration(rule(css, selector), 'min-height')).toBe('var(--hit)');
  });

  it('the fields are 18px or more: a smaller field makes iOS zoom the page in', () => {
    expect(declaration(rule(logCss, '.select'), 'font')).toContain('var(--fs-lg)');
  });
});

describe('the frame', () => {
  // The form bar sticks to the top of the scrolling area of the shell; a clipping ancestor would turn it into a row.
  it('does not clip: no overflow on the card that holds the bar', () => {
    expect(declaration(rule(screenCss, '.screen'), 'overflow')).toBeUndefined();
  });

  it('stays a centred column from tablet width', () => {
    expect(declaration(rule(screenCss, '.screen'), 'margin-inline')).toBe('auto');
    expect(declaration(rule(screenCss, '.screen'), 'max-width')).toBe('720px');
  });
});
