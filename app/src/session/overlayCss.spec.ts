import { describe, expect, it } from 'vitest';
import gateCss from './GateScreen.module.css?raw';
import loadingCss from './LoadingScreen.module.css?raw';
import labCss from '../foodcost/lab/LabMode.module.css?raw';

// Window Controls Overlay (the installed PC app with its title bar folded into the page): the screens drawn OUTSIDE the shell have no top bar to be
// the drag region, so each gets a strip of its own, only under that media query (jsdom applies no media query: the stylesheets are read).
const bare = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const overlay = (css: string): string => /@media \(display-mode: window-controls-overlay\)\s*\{([\s\S]*)$/.exec(bare(css))?.[1] ?? '';
const outside = (css: string): string => bare(css).replace(/@media \(display-mode: window-controls-overlay\)[\s\S]*$/, '');

describe.each([['the sign-in and gate screens', gateCss], ['the loading screen', loadingCss]])('%s', (_name, css) => {
  it('is a drag region as tall as the title bar area, controls opting out', () => {
    expect(overlay(css)).toMatch(/\.screen::before\s*\{[^}]*height:\s*env\(titlebar-area-height, 0px\)[^}]*app-region:\s*drag/);
    expect(overlay(css)).toMatch(/button,[\s\S]*input,[\s\S]*\{[^}]*app-region:\s*no-drag/);
  });

  it('changes nothing outside the media query', () => {
    expect(outside(css)).not.toMatch(/app-region|titlebar-area/);
  });
});

describe('Lab mode', () => {
  it('is a drag region, keeps its clock clear of the window buttons with the shell bar\'s formula, controls opting out', () => {
    expect(overlay(labCss)).toMatch(/\.overlay::before\s*\{[^}]*height:\s*env\(titlebar-area-height, 0px\)[^}]*app-region:\s*drag/);
    expect(overlay(labCss)).toMatch(/\.overlay \.top\s*\{[^}]*padding-right:\s*calc\(100vw - env\(titlebar-area-x, 0px\) - env\(titlebar-area-width, 100vw\) \+ var\(--s3\)\)/);
    expect(overlay(labCss)).toMatch(/\.overlay button,[\s\S]*\{[^}]*app-region:\s*no-drag/);
    expect(outside(labCss)).not.toMatch(/app-region|titlebar-area/);
  });
});
