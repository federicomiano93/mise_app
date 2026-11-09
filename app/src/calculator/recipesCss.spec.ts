import { describe, expect, it } from 'vitest';
import listCss from './RecipeList.module.css?raw';
import screenCss from './RecipeScreen.module.css?raw';
import pickerCss from './CataloguePicker.module.css?raw';

// What the stylesheets of the Recipes editor decide and jsdom cannot see (it applies no layout).
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

describe('the targets of the Recipes editor', () => {
  it.each([
    ['a row head', listCss, '.open', 'min-height'],
    ['the delete icon of a row', listCss, '.del', 'min-height'],
    ['the delete icon of a row (width)', listCss, '.del', 'width'],
    ['a field of the open row', listCss, '.input', 'min-height'],
    ['a switch row of the open row', listCss, '.switchRow', 'min-height'],
    ['the name box', screenCss, '.input', 'min-height'],
    ['the delete icon of a recipe', screenCss, '.del', 'min-height'],
    ['the delete icon of a recipe (width)', screenCss, '.del', 'width'],
    ['a switch row of the leavening box', screenCss, '.switchRow', 'min-height'],
    ['a read-only row', screenCss, '.readonlyRow', 'min-height'],
    ['a recipe of the picker', pickerCss, '.row', 'min-height'],
    ['the search box of the picker', pickerCss, '.search', 'min-height'],
  ])('%s is at least 48px', (_name, css, selector, property) => {
    expect(declaration(rule(css, selector), property)).toBe('var(--hit)');
  });

  it('the fields are 18px or more: a smaller field makes iOS zoom the page in', () => {
    expect(declaration(rule(listCss, '.input'), 'font')).toContain('var(--fs-lg)');
    expect(declaration(rule(screenCss, '.input'), 'font')).toContain('var(--fs-lg)');
    expect(declaration(rule(pickerCss, '.search'), 'font')).toContain('var(--fs-lg)');
  });

  it('a field that cannot be left blank is marked in the danger colour, and not by colour alone (aria-invalid)', () => {
    expect(declaration(rule(listCss, '.invalid'), 'border-color')).toBe('var(--danger)');
    expect(declaration(rule(screenCss, '.invalid'), 'border-color')).toBe('var(--danger)');
  });
});

describe('the look of the accordion', () => {
  it('a closed panel is really hidden: the display set on the panel would beat the hidden attribute', () => {
    expect(declaration(rule(listCss, '.panel[hidden]'), 'display')).toBe('none');
  });

  it('nothing on the list clips, so the bar above it keeps sticking', () => {
    for (const selector of ['.list', '.card', '.head', '.panel']) {
      expect(declaration(rule(listCss, selector), 'overflow')).toBeUndefined();
    }
  });

  it('the chevron turns when its row is open, and stops turning for whoever asked for less motion', () => {
    expect(declaration(rule(listCss, '.isOpen .chevron'), 'transform')).toBe('rotate(90deg)');
    expect(withoutComments(listCss)).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.chevron\s*\{\s*transition: none;/);
  });

  it('uses the app\'s tokens only: no colour is written out', () => {
    for (const css of [listCss, screenCss, pickerCss]) {
      expect(withoutComments(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(/);
    }
  });
});
