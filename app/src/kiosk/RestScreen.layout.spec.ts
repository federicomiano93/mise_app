import { describe, expect, it } from 'vitest';
import restCss from './RestScreen.module.css?raw';

// The rest screen's two halves, pinned in the style: the shell's top-bar spec reads its stylesheet the same way.
const css = restCss.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the rest screen halves', () => {
  it('sit side by side, equal, with a 1px divider in a token colour', () => {
    expect(css).toMatch(/\.halves\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*row/);
    expect(css).toMatch(/\.half\s*\{[^}]*flex:\s*1 1 0[^}]*text-align:\s*left/);
    expect(css).toMatch(/\.divider\s*\{[^}]*width:\s*1px[^}]*background:\s*var\(--kiosk-line\)/);
  });

  it('stack under 700px, the divider lying down', () => {
    const phone = /@media \(max-width:\s*700px\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? '';
    expect(phone).toMatch(/\.halves\s*\{[^}]*flex-direction:\s*column/);
    expect(phone).toMatch(/\.divider\s*\{[^}]*height:\s*1px/);
  });

  it('paints the overdue line in the kiosk\'s own token', () => {
    expect(css).toMatch(/\.late\s*\{[^}]*color:\s*var\(--kiosk-late\)/);
  });
});
