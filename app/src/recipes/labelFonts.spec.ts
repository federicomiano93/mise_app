import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The image label's three faces: asked for once, on demand; a failure is forgotten so the next opening tries again.
// jsdom has no FontFace, so a fake one stands in and records what it was asked.

interface Made { family: string; source: string; descriptors: { weight?: string; style?: string } }

describe('labelFonts', () => {
  let made: Made[];
  let added: unknown[];
  let failLoads: boolean;

  beforeEach(() => {
    vi.resetModules();
    made = [];
    added = [];
    failLoads = false;
    class FakeFontFace {
      constructor(family: string, source: string, descriptors: Made['descriptors']) {
        made.push({ family, source, descriptors });
      }
      load(): Promise<FakeFontFace> {
        return failLoads ? Promise.reject(new Error('network')) : Promise.resolve(this);
      }
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (f: unknown) => { added.push(f); } } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('names the three faces with their weights', async () => {
    const { LABEL_FONT_CSS } = await import('./labelFonts');
    expect(LABEL_FONT_CSS.regular(73)).toBe('400 73px "Mise Label Sans"');
    expect(LABEL_FONT_CSS.bold(56)).toBe('700 56px "Mise Label Sans"');
    expect(LABEL_FONT_CSS.title(128)).toBe('700 128px "Mise Label Title"');
  });

  it('loads the three files once and adds them to the document', async () => {
    const { loadLabelFonts } = await import('./labelFonts');
    const first = loadLabelFonts();
    await first;
    expect(made.map(m => [m.family, m.descriptors.weight, m.descriptors.style])).toEqual([
      ['Mise Label Sans', '400', 'normal'], ['Mise Label Sans', '700', 'normal'], ['Mise Label Title', '700', 'normal'],
    ]);
    expect(made.map(m => m.source)).toEqual([
      expect.stringMatching(/^url\(.*label-sans\.woff2.*\)$/),
      expect.stringMatching(/^url\(.*label-sans-bold\.woff2.*\)$/),
      expect.stringMatching(/^url\(.*label-title\.woff2.*\)$/),
    ]);
    expect(added).toHaveLength(3);
    expect(loadLabelFonts()).toBe(first);
    await first;
    expect(made).toHaveLength(3);
    expect(added).toHaveLength(3);
  });

  it('rejects when a load fails, and the next call tries again', async () => {
    const { loadLabelFonts } = await import('./labelFonts');
    failLoads = true;
    await expect(loadLabelFonts()).rejects.toThrow('network');
    expect(added).toHaveLength(0);
    failLoads = false;
    await expect(loadLabelFonts()).resolves.toBeUndefined();
    expect(added).toHaveLength(3);
  });

  it('rejects when the browser has no FontFace', async () => {
    vi.stubGlobal('FontFace', undefined);
    const { loadLabelFonts } = await import('./labelFonts');
    await expect(loadLabelFonts()).rejects.toThrow('no-fontface');
  });
});
