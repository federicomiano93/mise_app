import { describe, expect, it } from 'vitest';
import css from './PhotoScreen.module.css?raw';

// What jsdom cannot see: at 296px the two short words must fit half a row each, so the columns may shrink below their content.
describe('the photo screen’s phone buttons', () => {
  it('uses two columns that can shrink, with the words on one line', () => {
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toMatch(/\.take \{[^}]*white-space: nowrap;/);
  });
});
