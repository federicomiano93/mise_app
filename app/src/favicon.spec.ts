import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import favicon from '../public/favicon.svg?raw';

// Without a <link rel="icon"> the browser asks for /favicon.ico, which the app does not have,
// and every first load logs a 404 in the console. The href is written from the root (/favicon.svg):
// Vite prefixes it with the build's --base, so `vite build --base=/mise2/` emits
// /mise2/favicon.svg and copies the file into dist (checked by hand when it was added).
describe('the favicon', () => {
  it('is linked from index.html as an SVG', () => {
    expect(indexHtml).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
  });

  it('is a 64×64 rounded square carrying the letter M', () => {
    expect(favicon).toMatch(/^<svg\b[^>]*viewBox="0 0 64 64"/);
    expect(favicon).toMatch(/<rect\b[^>]*width="64"[^>]*height="64"[^>]*rx="14"/);
    expect(favicon).toMatch(/<text\b[^>]*font-weight="700"[^>]*>M<\/text>/);
  });
});
