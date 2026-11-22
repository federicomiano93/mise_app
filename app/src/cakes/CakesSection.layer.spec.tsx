import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD } from '../testing/renderFoodcost';
import { resetParkedCakes } from './cakeParking';
import cakesCss from './CakesSection.module.css?raw';
import formCss from './CakeForm.module.css?raw';

// The open cake is a layer over the whole column from 700px (CSS), and the top bar under it is out of reach of the keyboard and of a screen
// reader while it is up. jsdom applies no media query, so the stylesheets are read; the reach of the bar is checked on the real shell.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); resetParkedCakes(); });

const SACHER = cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2 });
const source = () => fakeCakesSource({ cakes: [SACHER], reference: storedReference() });
const layout = () => document.querySelector('[data-view]');
const bar = () => document.querySelector('header [role="status"]')?.closest('header') as HTMLElement;

const bare = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the layer', () => {
  it('is on for a saved cake and for a new one, off for the list and for the settings', async () => {
    renderCakes('/cakes/c1', { cakes: source() });
    await screen.findByRole('heading', { level: 2, name: 'Sacher' }, LOAD);
    expect(layout()).toHaveAttribute('data-cover', 'true');
    cleanup();

    renderCakes('/cakes/new', { cakes: source() });
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    expect(layout()).toHaveAttribute('data-cover', 'true');
    cleanup();

    renderCakes('/cakes/reference', { cakes: source() });
    await screen.findByRole('heading', { level: 2, name: 'Settings' }, LOAD);
    expect(layout()).toHaveAttribute('data-view', 'detail');
    expect(layout()).not.toHaveAttribute('data-cover');
    cleanup();

    renderCakes('/cakes', { cakes: source() });
    await screen.findByRole('button', { name: 'New cake' }, LOAD);
    expect(layout()).not.toHaveAttribute('data-cover');
  });

  it('is fixed from the rail to the right edge over the bar from 700px, with a scroll of its own; the phone is not touched', () => {
    const css = bare(cakesCss);
    expect(css).toMatch(/@media \(min-width: 700px\)\s*\{\s*\.layout\[data-cover="true"\] \.detail\s*\{[^}]*position:\s*fixed[^}]*left:\s*calc\(var\(--rail-w\) \+ env\(safe-area-inset-left\)\)[^}]*z-index:\s*50[^}]*height:\s*var\(--vh100\)[^}]*overflow:\s*auto[^}]*background:\s*var\(--bg\)/);
    expect(css).not.toMatch(/dvh/);
    // Nothing of the layer outside the two media queries.
    expect(css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '')).not.toMatch(/position:\s*fixed/);
  });

  it('keeps the window buttons\' corner free and drags by a strip under Window Controls Overlay, only there', () => {
    const css = bare(cakesCss);
    const overlay = /@media \(min-width: 700px\) and \(display-mode: window-controls-overlay\)\s*\{([\s\S]*)$/.exec(css)?.[1] ?? '';
    expect(overlay).toMatch(/\.detail\s*\{[^}]*top:\s*env\(titlebar-area-height, 0px\)[^}]*height:\s*calc\(var\(--vh100\) - env\(titlebar-area-height, 0px\)\)/);
    expect(overlay).toMatch(/\.detail::before\s*\{[^}]*height:\s*env\(titlebar-area-height, 0px\)[^}]*app-region:\s*drag/);
    expect(css.replace(/@media \(min-width: 700px\) and \(display-mode: window-controls-overlay\)[\s\S]*$/, '')).not.toMatch(/app-region|titlebar-area/);
  });

  it('puts the cake\'s form in two columns from 1000px, not 1280px', () => {
    const css = bare(formCss);
    expect(css).toMatch(/@media \(min-width: 1000px\)\s*\{\s*\.grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 420px/);
    expect(css).not.toContain('1280px');
  });
});

describe('the bar under the layer', () => {
  it('is out of reach of a screen reader and the tab order while a cake is open, and back as it was on the list', async () => {
    const { user } = renderCakes('/cakes', { cakes: source() });
    await screen.findByRole('button', { name: /^Sacher/ }, LOAD);
    const header = bar();
    expect(header).not.toHaveAttribute('aria-hidden');
    const controls = [...header.querySelectorAll('a, button')];
    expect(controls.length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /^Sacher/ }));
    await screen.findByRole('heading', { level: 2, name: 'Sacher' }, LOAD);
    // jsdom has no `inert`: the old browsers' way, aria-hidden and every control out of the tab order.
    expect(header).toHaveAttribute('aria-hidden', 'true');
    for (const control of controls) expect(control).toHaveAttribute('tabindex', '-1');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('button', { name: 'New cake' }, LOAD);
    expect(header).not.toHaveAttribute('aria-hidden');
    for (const control of controls) expect(control).not.toHaveAttribute('tabindex', '-1');
  });

  it('is made inert where the browser has it, and given back', async () => {
    Object.defineProperty(HTMLElement.prototype, 'inert', { configurable: true, writable: true, value: false });
    try {
      const { user } = renderCakes('/cakes', { cakes: source() });
      await screen.findByRole('button', { name: /^Sacher/ }, LOAD);
      const header = bar() as HTMLElement & { inert: boolean };
      await user.click(screen.getByRole('button', { name: /^Sacher/ }));
      await screen.findByRole('heading', { level: 2, name: 'Sacher' }, LOAD);
      expect(header.inert).toBe(true);
      expect(header).not.toHaveAttribute('aria-hidden');
      await user.click(screen.getByRole('button', { name: 'Back' }));
      await screen.findByRole('button', { name: 'New cake' }, LOAD);
      expect(header.inert).toBe(false);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'inert');
    }
  });

  it('moves the focus into the card when a cake opens from the list, not onto the covered title', async () => {
    const { user } = renderCakes('/cakes', { cakes: source() });
    await user.click(await screen.findByRole('button', { name: /^Sacher/ }, LOAD));
    const title = await screen.findByRole('heading', { level: 2, name: 'Sacher' }, LOAD);
    expect(title).toHaveFocus();
    expect(bar().contains(document.activeElement)).toBe(false);
  });
});
