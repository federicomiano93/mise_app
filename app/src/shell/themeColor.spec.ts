import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { miseServiceWorker } from '../../sw-plugin';

// The colour of the window strip / status bar, and the PC app's folded title bar (22 Nov 2026).
const ROOT = join(__dirname, '..', '..', '..');

describe('the theme colour', () => {
  test('two metas, in this order: the white bar for the overlay window, then the rail\'s dark', () => {
    const plugin = miseServiceWorker(ROOT);
    (plugin.configResolved as (c: unknown) => void)({ root: ROOT, base: '/mise2/', build: { outDir: 'dist' } });
    const hook = plugin.transformIndexHtml as { handler: () => { tag: string; attrs: Record<string, string> }[] };
    const metas = hook.handler().filter(tag => tag.tag === 'meta' && tag.attrs.name === 'theme-color').map(tag => tag.attrs);
    expect(metas).toEqual([
      { name: 'theme-color', media: '(display-mode: window-controls-overlay)', content: '#fefefc' },
      { name: 'theme-color', content: '#201b16' },
    ]);
  });

  test('the manifest takes the dark and asks for the overlay', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest.theme_color).toBe('#201b16');
    expect(manifest.display_override).toEqual(['window-controls-overlay']);
    // Neither field is one that asks for a re-install (js/install-version.js): no notice appears.
    expect(manifest.display).toBe('standalone');
  });
});
