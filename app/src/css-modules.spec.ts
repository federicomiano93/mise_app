import { describe, expect, test } from 'vitest';

// ⚠️ A MISTYPED CLASS NAME IS SILENT. Vite types a CSS module as "any string key", so
// `styles.swatchTokn` compiles, React drops the `undefined` class, and the style simply
// vanishes from the screen with the type-check and every other spec green — the same family
// of silent failure as the current app's dead-CSS deletions. So: every `styles.x` a component
// reads must be a class its own module defines, and every var(--x) a module reads must be a
// token tokens.css defines.
//
// Read as raw text through Vite itself, so the spec needs no Node types and finds every new
// component on its own.
const components = import.meta.glob<string>('./**/*.tsx', { query: '?raw', import: 'default', eager: true });
const modules = import.meta.glob<string>('./**/*.module.css', { query: '?raw', import: 'default', eager: true });
const tokens = import.meta.glob<string>('./styles/tokens.css', { query: '?raw', import: 'default', eager: true });

const IMPORT = /import\s+(\w+)\s+from\s+'(\.[^']+\.module\.css)'/g;

function classesIn(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...withoutComments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1] ?? ''));
}

function resolve(from: string, relative: string): string {
  const dir = from.slice(0, from.lastIndexOf('/'));
  return `${dir}/${relative.replace(/^\.\//, '')}`;
}

describe('CSS modules', () => {
  test('the scan finds the components and their modules', () => {
    expect(Object.keys(components)).toContain('./shell/AppShell.tsx');
    expect(Object.keys(modules)).toContain('./shell/AppShell.module.css');
    expect(classesIn('.a { } /* .ghost */ .b-c:hover { }')).toEqual(new Set(['a', 'b-c']));
  });

  // ⚠️ Without CSS processing for `?raw` (vite.config.ts) every file reads as an empty string.
  // The var(--x) check below would then pass with nothing to look at, so say it outright.
  test('every stylesheet is read as real text, not as an empty string', () => {
    const empty = [...Object.entries(modules), ...Object.entries(tokens)]
      .filter(([, css]) => css.trim() === '')
      .map(([file]) => file);
    expect(Object.keys(modules).length).toBeGreaterThan(0);
    expect(Object.keys(tokens)).toEqual(['./styles/tokens.css']);
    expect(empty).toEqual([]);
  });

  test('every styles.x a component reads is a class its module defines', () => {
    const missing: string[] = [];
    for (const [file, source] of Object.entries(components)) {
      if (file.endsWith('.spec.tsx')) continue;
      for (const [, name, relative] of source.matchAll(IMPORT)) {
        if (!name || !relative) continue;
        const path = resolve(file, relative);
        const css = modules[path];
        if (css === undefined) { missing.push(`${file}: ${relative} not found`); continue; }
        const defined = classesIn(css);
        for (const [, used] of source.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, 'g'))) {
          if (used && !defined.has(used)) missing.push(`${file}: ${name}.${used} is not in ${relative}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('every var(--x) a module reads is a token tokens.css defines', () => {
    const tokenCss = tokens['./styles/tokens.css'] ?? '';
    const defined = new Set([...tokenCss.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    expect(defined.size).toBeGreaterThan(40);
    const missing: string[] = [];
    for (const [file, css] of Object.entries(modules)) {
      for (const [, token] of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (token && !defined.has(token)) missing.push(`${file}: ${token}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
