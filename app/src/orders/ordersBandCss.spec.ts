// The title band and its doors by width (the redesign of 16 Nov 2026; jsdom applies no media query, so the stylesheets are read).
//  - The band sticks only on the split, exactly --band-h tall, and the parts that stick under it read that token (0 on a phone).
//  - On a 296px phone «Liste d'ordine» is its icon and count: the words are base.css's visually-hidden recipe, drawn from 340px.

import { describe, expect, it } from 'vitest';
import pageCss from '../shell/Page.module.css?raw';
import tokensCss from '../styles/tokens.css?raw';
import headCss from './OrdersHead.module.css?raw';
import sectionCss from './OrdersSection.module.css?raw';
import listsCss from './ListsDoor.module.css?raw';
import listsSource from './ListsDoor.tsx?raw';

const bare = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const after = (css: string, query: string) => bare(css).split(query).slice(1).join('');
const before = (css: string, query: string) => bare(css).split(query)[0] ?? '';

describe('the title band', () => {
  it('sticks on the split only, one line exactly --band-h tall', () => {
    expect(before(pageCss, '@media (min-width: 1000px)')).not.toMatch(/\.band\s*\{[^}]*position:\s*sticky/);
    expect(after(pageCss, '@media (min-width: 1000px)')).toMatch(/\.band\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*height:\s*var\(--band-h\)/);
  });

  it('is 72px on the split and nothing on a phone, where it scrolls away', () => {
    expect(bare(tokensCss)).toMatch(/--band-h:\s*0px;/);
    expect(after(tokensCss, '@media (min-width: 1000px)')).toMatch(/--band-h:\s*72px;/);
  });

  it('is what the search box and the open pane stick under', () => {
    expect(bare(headCss)).toMatch(/\.head\s*\{[^}]*top:\s*var\(--band-h\)/);
    expect(after(sectionCss, '@media (min-width: 1000px)')).toMatch(/\.detail\s*\{[^}]*top:\s*var\(--band-h\);[^}]*max-height:\s*calc\(var\(--vh100\) - var\(--topbar-h\) - var\(--band-h\)\)/);
  });
});

describe('«Order lists» on a 296px phone', () => {
  it('keeps its words in the name but draws them only from 340px', () => {
    expect(after(listsCss, '@media (min-width: 340px)')).toMatch(/\.door \.label\s*\{[^}]*position:\s*static;[^}]*clip-path:\s*none;/);
    expect(bare(listsCss)).not.toMatch(/display:\s*none/);
  });

  it('marks the words with base.css\'s visually-hidden recipe', () => {
    expect(listsSource).toContain('className={`visually-hidden ${styles.label}`}');
  });
});
