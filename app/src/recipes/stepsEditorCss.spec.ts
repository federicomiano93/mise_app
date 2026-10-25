import { describe, expect, it } from 'vitest';
import cardCss from './ProcedureCard.module.css?raw';
import editorCss from './StepsEditor.module.css?raw';

// What a stylesheet decides and jsdom cannot see (see recipesCss.spec.ts): the targets of the steps editor, its focus rings,
// and that nothing in it can clip the bar stuck to its top or push out of a 296px phone.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Every rule whose selector list names `selector` exactly, joined (a class may be set by a shared rule and by its own).
function rule(css: string, selector: string): string {
  const found = [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors = '']) => selectors.split(',').map(s => s.trim()).includes(selector))
    .map(([, , body = '']) => body);
  if (found.length === 0) throw new Error(`${selector} not found`);
  return found.join(';');
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

describe('the steps editor’s targets', () => {
  it('makes the three icon buttons, the boxes and every tick row at least 48px', () => {
    expect(declaration(rule(editorCss, '.icon'), 'width')).toBe('var(--hit)');
    expect(declaration(rule(editorCss, '.icon'), 'height')).toBe('var(--hit)');
    expect(declaration(rule(editorCss, '.box'), 'min-height')).toBe('var(--hit)');
    expect(declaration(rule(editorCss, '.pick'), 'min-height')).toBe('var(--hit)');
  });

  it('centres an icon on its button and a tick on its row, not on the text baseline', () => {
    expect(declaration(rule(editorCss, '.icon'), 'display')).toBe('flex');
    expect(declaration(rule(editorCss, '.icon'), 'align-items')).toBe('center');
    expect(declaration(rule(editorCss, '.pick'), 'display')).toBe('flex');
    expect(declaration(rule(editorCss, '.pick'), 'align-items')).toBe('center');
    expect(declaration(rule(editorCss, '.cardHead'), 'align-items')).toBe('center');
  });

  it('draws a visible focus ring on every control', () => {
    expect(declaration(rule(editorCss, '.icon:focus-visible'), 'outline')).toContain('var(--accent)');
    expect(declaration(rule(editorCss, '.box:focus-visible'), 'outline')).toContain('var(--accent)');
    expect(declaration(rule(editorCss, '.tick:focus-visible'), 'outline')).toContain('var(--accent)');
    expect(declaration(rule(editorCss, '.textarea:focus-visible'), 'outline')).toContain('var(--accent)');
  });

  it('types the boxes at 16px or more, so iOS does not zoom the page when one is focused', () => {
    expect(declaration(rule(editorCss, '.box'), 'font')).toMatch(/^var\(--fs-md\)/);
  });
});

describe('the steps editor on a 296px phone', () => {
  it('lets the timer’s parts wrap, and a tick row’s name take the room the amount leaves', () => {
    expect(declaration(rule(editorCss, '.time'), 'flex-wrap')).toBe('wrap');
    expect(declaration(rule(editorCss, '.pickName'), 'min-width')).toBe('0');
    expect(declaration(rule(editorCss, '.pickName'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(editorCss, '.pickAmount'), 'flex')).toBe('none');
    expect(declaration(rule(editorCss, '.stepName'), 'min-width')).toBe('0');
    expect(declaration(rule(editorCss, '.card'), 'min-width')).toBe('0');
  });

  it('clips nothing: the form bar sticks to the top of the scrolling area', () => {
    expect(withoutComments(editorCss)).not.toMatch(/overflow\s*:\s*(hidden|auto|scroll|clip)/);
    expect(withoutComments(cardCss)).not.toMatch(/overflow\s*:\s*(hidden|auto|scroll|clip)/);
  });
});

describe('hover and viewport units', () => {
  it('has a hover look only inside (hover: hover)', () => {
    const outside = withoutComments(editorCss).replace(/@media \(hover: hover\)\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
    expect(outside).not.toContain(':hover');
    expect(withoutComments(editorCss)).toContain('@media (hover: hover)');
  });

  it('writes no viewport unit', () => {
    expect(withoutComments(editorCss)).not.toMatch(/\d(vh|vw|dvh|svh|lvh)\b/);
    expect(withoutComments(cardCss)).not.toMatch(/\d(vh|vw|dvh|svh|lvh)\b/);
  });
});
