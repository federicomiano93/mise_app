import { describe, expect, it } from 'vitest';
import sectionCss from './CakesSection.module.css?raw';
import referenceCss from './ReferenceScreen.module.css?raw';
import { CAKES_SPLIT_QUERY } from './cakesSplit';

// A media query cannot read a constant, so this reads the stylesheets and fails when they stop saying the same number as the code.
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the split of Cakes', () => {
  it('is 1280px: the editor has two columns of its own, so the lab tablet at 1024 gets one level at a time', () => {
    expect(CAKES_SPLIT_QUERY).toBe('(min-width: 1280px)');
  });

  it('is the one breakpoint the section stylesheets use, with the phone rule one hair below it', () => {
    const css = withoutComments(sectionCss);
    expect(css).toContain(`@media ${CAKES_SPLIT_QUERY}`);
    expect(css).toContain('@media (max-width: 1279.98px)');
    for (const sheet of [sectionCss, referenceCss]) {
      const widths = [...withoutComments(sheet).matchAll(/@media\s*\(\s*min-width:\s*([^)]+)\)/g)].map(m => m[1]);
      for (const width of widths) expect(width).toBe('1280px');
    }
  });

  it('hides, below the split only, the prompt behind the list and the list behind a screen', () => {
    const css = withoutComments(sectionCss);
    const at = css.indexOf(`@media ${CAKES_SPLIT_QUERY}`);
    expect(css.slice(0, at)).toContain('.layout[data-view="list"] .detail');
    expect(css.slice(0, at)).toContain('.layout[data-view="detail"] .list');
    expect(css.slice(at)).not.toContain('display: none');
  });

  it('keeps the right-hand side on screen while the list scrolls, scrolling on its own, and lets nothing else clip', () => {
    const css = withoutComments(sectionCss);
    const at = css.indexOf(`@media ${CAKES_SPLIT_QUERY}`);
    const split = css.slice(at);
    expect(split).toContain('position: sticky');
    expect(split).toContain('overflow-y: auto');
    expect(split).toContain('grid-template-columns: var(--list-w) minmax(0, 1fr)');
    expect(split).not.toContain('overscroll-behavior');
    expect(css.slice(0, at)).not.toMatch(/overflow/);
  });
});
