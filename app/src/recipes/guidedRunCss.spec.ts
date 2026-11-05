import { describe, expect, it } from 'vitest';
import runCss from './GuidedRun.module.css?raw';
import sectionCss from './RecipesSection.module.css?raw';

// What a stylesheet decides and jsdom cannot see (see recipesCss.spec.ts): the guided mix is read standing up with hands in dough,
// so its targets, its digits and its width are part of what it does.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(css: string, selector: string): string {
  const found = [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors = '']) => selectors.split(',').map(s => s.trim()).includes(selector))
    .map(([, , body = '']) => body);
  if (found.length === 0) throw new Error(`${selector} not found`);
  return found.join(';');
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(String.raw`(?:^|[;\s])${property}:\s*([^;]+);`).exec(body)?.[1]?.trim();

describe('the guided mix’s targets and digits', () => {
  it('makes every button at least 56px tall: the next action is as big as a stepper', () => {
    expect(declaration(rule(runCss, '.actions .go'), 'min-height')).toBe('var(--hit-lg)');
    expect(declaration(rule(runCss, '.actions .small'), 'min-height')).toBe('var(--hit-lg)');
  });

  it('sets the countdown in tabular digits that never wrap', () => {
    expect(declaration(rule(runCss, '.time'), 'font-variant-numeric')).toBe('tabular-nums');
    expect(declaration(rule(runCss, '.time'), 'white-space')).toBe('nowrap');
  });

  it('sets the amounts in tabular digits too, and lets a name wrap rather than push out of the card', () => {
    expect(declaration(rule(runCss, '.amount'), 'font-variant-numeric')).toBe('tabular-nums');
    expect(declaration(rule(runCss, '.name'), 'min-width')).toBe('0');
    expect(declaration(rule(runCss, '.name'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(runCss, '.text'), 'overflow-wrap')).toBe('anywhere');
  });

  it('centres an icon on its words, not on the text baseline', () => {
    expect(declaration(rule(runCss, '.dueText'), 'display')).toBe('flex');
    expect(declaration(rule(runCss, '.dueText'), 'align-items')).toBe('center');
    expect(declaration(rule(runCss, '.done'), 'display')).toBe('flex');
    expect(declaration(rule(runCss, '.done'), 'align-items')).toBe('center');
  });

  it('draws a visible focus ring on the step’s instruction and on the finished line, which take the focus', () => {
    expect(declaration(rule(runCss, '.text:focus-visible'), 'outline')).toContain('var(--accent)');
    expect(declaration(rule(runCss, '.done:focus-visible'), 'outline')).toContain('var(--accent)');
  });

  it('turns the card when the timer is up, with a border as well as a tint', () => {
    expect(declaration(rule(runCss, '.due'), 'background')).toBe('var(--warn-tint)');
    expect(declaration(rule(runCss, '.due'), 'border')).toContain('var(--warn)');
  });

  it('stops the speed flash for anyone who asked for less motion', () => {
    expect(withoutComments(runCss)).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.speedChanged\s*\{\s*animation:\s*none/);
  });
});

describe('the guided mix on a 296px phone', () => {
  it('clips nothing: the form bar sticks to the top of the scrolling area', () => {
    expect(withoutComments(runCss)).not.toMatch(/overflow\s*:\s*(hidden|auto|scroll|clip)/);
  });

  it('uses no viewport unit and no hover outside a hover media query', () => {
    expect(withoutComments(runCss)).not.toMatch(/\d(vh|vw|vmin|vmax)\b/);
    expect(withoutComments(runCss)).not.toMatch(/:hover/);
  });

  it('wraps the +1 min / Done early pair rather than squeezing it', () => {
    expect(declaration(rule(runCss, '.adjust'), 'flex-wrap')).toBe('wrap');
  });
});

describe('the guided mix is full width', () => {
  it('hides the list at every width and gives the right-hand side the whole row on the split', () => {
    const css = withoutComments(sectionCss);
    expect(css).toContain('.layout[data-view="run"] .list');
    expect(declaration(rule(sectionCss, '.layout[data-view="run"] .list'), 'display')).toBe('none');
    expect(declaration(rule(sectionCss, '.layout[data-view="run"]'), 'grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(declaration(rule(sectionCss, '.layout[data-view="run"] .detail'), 'position')).toBe('static');
    expect(declaration(rule(sectionCss, '.layout[data-view="run"] .detail'), 'max-height')).toBe('none');
  });
});
