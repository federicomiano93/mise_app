import { describe, expect, it } from 'vitest';
import editorCss from './RecipeEditor.module.css?raw';
import listCss from './RecipesList.module.css?raw';
import rowCss from './IngredientRow.module.css?raw';
import viewCss from './RecipeView.module.css?raw';
import linkCss from './LinkSuggest.module.css?raw';
import dialogCss from './LinkDialog.module.css?raw';
import reorderCss from './ReorderRows.module.css?raw';

// What a stylesheet decides and jsdom cannot see (see recipesCss.spec.ts): the editor's row on a 296px phone, the targets,
// and where the «New recipe» button stands.
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(css: string, selector: string): string {
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) return body;
  }
  throw new Error(`${selector} not found`);
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

describe('the ingredient row', () => {
  it('keeps name, amount, unit and bin on ONE line, the name taking what the others leave', () => {
    expect(declaration(rule(rowCss, '.line'), 'display')).toBe('flex');
    expect(declaration(rule(rowCss, '.line'), 'flex-wrap')).toBeUndefined();
    expect(declaration(rule(rowCss, '.name'), 'flex')).toBe('1 1 0');
    expect(declaration(rule(rowCss, '.name'), 'min-width')).toBe('0');
    expect(declaration(rule(rowCss, '.amount'), 'flex')).toBe('none');
    expect(declaration(rule(rowCss, '.remove'), 'flex')).toBe('none');
  });

  it('makes the boxes and the bin 48px targets, with a visible focus ring', () => {
    expect(declaration(rule(rowCss, '.name'), 'min-height')).toBe('var(--hit)');
    expect(declaration(rule(rowCss, '.amount'), 'min-height')).toBe('var(--hit)');
    expect(declaration(rule(rowCss, '.remove'), 'width')).toBe('var(--hit)');
    expect(declaration(rule(rowCss, '.remove'), 'height')).toBe('var(--hit)');
    expect(declaration(rule(rowCss, '.name'), 'font')).toMatch(/^var\(--fs-md\)/);
    expect(declaration(rule(rowCss, '.name:focus-visible'), 'outline')).toContain('var(--accent)');
  });

  it('draws its own chevron on a select that has none of its own, and centres the bin’s icon', () => {
    expect(declaration(rule(rowCss, '.unit'), 'appearance')).toBe('none');
    expect(declaration(rule(rowCss, '.chevron'), 'pointer-events')).toBe('none');
    expect(declaration(rule(rowCss, '.remove'), 'display')).toBe('flex');
    expect(declaration(rule(rowCss, '.remove'), 'align-items')).toBe('center');
  });

  it('lines the Total up with the amount cell: the same width, and the number right-aligned', () => {
    expect(declaration(rule(rowCss, '.amount'), 'width')).toBe('116px');
    expect(declaration(rule(editorCss, '.totalCell'), 'width')).toBe('116px');
    expect(declaration(rule(editorCss, '.totalNum'), 'text-align')).toBe('right');
    expect(declaration(rule(editorCss, '.totalNum'), 'width')).toBe(declaration(rule(rowCss, '.grams'), 'width'));
  });
});

describe('the editor', () => {
  it('does not clip the screen, so the form bar can stick to the top', () => {
    expect(declaration(rule(editorCss, '.screen'), 'overflow')).toBeUndefined();
    expect(declaration(rule(editorCss, '.body'), 'overflow')).toBeUndefined();
  });

  it('puts the delete button at 48px, icon and words on one centred row', () => {
    const button = rule(editorCss, '.delete');
    expect(declaration(button, 'min-height')).toBe('var(--hit)');
    expect(declaration(button, 'display')).toBe('flex');
    expect(declaration(button, 'align-items')).toBe('center');
  });
});

describe('the recipe page’s delete icon', () => {
  it('is a 48px target at the end of the page, icon centred', () => {
    const icon = rule(viewCss, '.deleteIcon');
    expect(declaration(icon, 'width')).toBe('var(--hit)');
    expect(declaration(icon, 'height')).toBe('var(--hit)');
    expect(declaration(icon, 'display')).toBe('flex');
    expect(declaration(icon, 'align-items')).toBe('center');
  });
});

describe('the «New recipe» button above the list', () => {
  it('stands under the search box on a phone and beside it from 1000px', () => {
    const css = withoutComments(listCss);
    expect(declaration(rule(listCss, '.top'), 'flex-direction')).toBe('column');
    const split = css.slice(css.indexOf('@media (min-width: 1000px)'));
    expect(declaration(rule(split, '.top'), 'flex-direction')).toBe('row');
    expect(declaration(rule(split, '.top .search'), 'flex')).toBe('1');
  });
});

describe('linking a row', () => {
  it('makes the link line a full-width 48px target that wraps instead of pushing the page sideways', () => {
    const line = rule(rowCss, '.link');
    expect(declaration(line, 'width')).toBe('100%');
    expect(declaration(line, 'min-height')).toBe('var(--hit)');
    expect(declaration(line, 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(rowCss, '.link:focus-visible'), 'outline')).toContain('var(--accent)');
  });

  it('lets a suggestion’s name and meta wrap, as 48px rows, with the tick and its word on one centred line', () => {
    expect(declaration(rule(linkCss, '.row'), 'min-height')).toBe('var(--hit)');
    expect(declaration(rule(linkCss, '.row'), 'flex-wrap')).toBe('wrap');
    expect(declaration(rule(linkCss, '.name'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(linkCss, '.meta'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(linkCss, '.linked'), 'display')).toBe('flex');
    expect(declaration(rule(linkCss, '.linked'), 'align-items')).toBe('center');
  });

  it('keeps the chooser’s rows 48px and its names and meta wrapping', () => {
    expect(declaration(rule(dialogCss, '.row'), 'min-height')).toBe('var(--hit)');
    expect(declaration(rule(dialogCss, '.name'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(dialogCss, '.meta'), 'overflow-wrap')).toBe('anywhere');
  });

  it('puts every hover inside (hover: hover)', () => {
    for (const css of [rowCss, linkCss, dialogCss]) {
      const bare = withoutComments(css).replace(/@media \(hover: hover\)\s*\{[\s\S]*?\}/g, '');
      expect(bare).not.toContain(':hover');
    }
  });
});

describe('reordering the rows', () => {
  it('makes the grip a 48px target that takes the touch for itself, and every row at least 48px tall', () => {
    const grip = rule(reorderCss, '.grip');
    expect(declaration(grip, 'width')).toBe('var(--hit)');
    expect(declaration(grip, 'height')).toBe('var(--hit)');
    expect(declaration(grip, 'touch-action')).toBe('none');
    expect(declaration(grip, 'display')).toBe('flex');
    expect(declaration(grip, 'align-items')).toBe('center');
    expect(declaration(rule(reorderCss, '.row'), 'min-height')).toBe('var(--hit)');
  });

  it('lets the name take the width and wrap, and keeps the amount at its own width', () => {
    expect(declaration(rule(reorderCss, '.name'), 'flex')).toBe('1 1 0');
    expect(declaration(rule(reorderCss, '.name'), 'min-width')).toBe('0');
    expect(declaration(rule(reorderCss, '.name'), 'overflow-wrap')).toBe('anywhere');
    expect(declaration(rule(reorderCss, '.amount'), 'flex')).toBe('none');
    expect(declaration(rule(reorderCss, '.number'), 'text-align')).toBe('right');
  });

  it('⚠️ builds its right side from the Total row’s geometry, so every number ends on the Total’s right edge', () => {
    expect(declaration(rule(reorderCss, '.amount'), 'width')).toBe(declaration(rule(editorCss, '.totalCell'), 'width'));
    expect(declaration(rule(reorderCss, '.amount'), 'padding-left')).toBe(declaration(rule(editorCss, '.totalCell'), 'padding-left'));
    expect(declaration(rule(reorderCss, '.number'), 'width')).toBe(declaration(rule(editorCss, '.totalNum'), 'width'));
    expect(declaration(rule(reorderCss, '.number'), 'padding')).toBe(declaration(rule(editorCss, '.totalNum'), 'padding'));
    expect(declaration(rule(reorderCss, '.number'), 'text-align')).toBe('right');
    expect(declaration(rule(reorderCss, '.unit'), 'padding-left')).toBe(declaration(rule(editorCss, '.totalUnit'), 'padding-left'));
    expect(declaration(rule(reorderCss, '.spacer'), 'width')).toBe(declaration(rule(editorCss, '.totalSpacer'), 'width'));
    expect(declaration(rule(reorderCss, '.row'), 'gap')).toBe(declaration(rule(editorCss, '.total'), 'gap'));
    // The unit word has a fixed slot and is cut short, never pushing the number.
    expect(declaration(rule(reorderCss, '.unit'), 'min-width')).toBe('0');
    expect(declaration(rule(reorderCss, '.unit'), 'overflow')).toBe('hidden');
    const narrow = (css: string) => withoutComments(css).slice(withoutComments(css).indexOf('@media (max-width: 339px)'));
    expect(declaration(rule(narrow(reorderCss), '.amount'), 'width')).toBe(declaration(rule(narrow(editorCss), '.totalCell'), 'width'));
  });

  it('dims the dragged row and draws the drop place as a 3px accent line', () => {
    expect(declaration(rule(reorderCss, '.row[data-dragging]'), 'opacity')).toBe('0.6');
    expect(declaration(rule(reorderCss, '.indicator[data-drop-target]'), 'border-top')).toBe('3px solid var(--accent)');
  });

  it('puts the hover inside (hover: hover) and invents no colour or custom property', () => {
    const css = withoutComments(reorderCss);
    expect(css.replace(/@media \(hover: hover\)\s*\{[\s\S]*?\}\s*\}/g, '')).not.toContain(':hover');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i);
    expect(css).not.toMatch(/--[a-z0-9-]+\s*:/i);
  });
});
