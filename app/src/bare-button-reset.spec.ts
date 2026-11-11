import { describe, expect, test } from 'vitest';

// ⚠️ A `bare` BUTTON HAS NO LOOK OF ITS OWN (ui/Button.tsx): its class is all of it. A class that forgets
// `border` and `background` leaves the browser's own grey box and border on what was meant to be a quiet
// text link — «Quali?» and «Dettagli» in the Food cost preview drew that way, with every other spec green.
// So every `<Button variant="bare" className={styles.x}>` must find a rule for `.x` in its own module that
// sets both. Read as raw text through Vite (see css-modules.spec.ts), so a new screen is checked on its own.
const components = import.meta.glob<string>('./**/*.tsx', { query: '?raw', import: 'default', eager: true });
const modules = import.meta.glob<string>('./**/*.module.css', { query: '?raw', import: 'default', eager: true });

const BARE = /<Button\b[^>]*?variant="bare"[^>]*>/gs;

function resolve(from: string, relative: string): string {
  const dir = from.slice(0, from.lastIndexOf('/'));
  return `${dir}/${relative.replace(/^\.\//, '')}`;
}

/** Every declaration block of `.name` (alone or in a compound selector), comments stripped. */
function rulesFor(css: string, name: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`\\.${name}(?![\\w-])[^{}]*\\{([^}]*)\\}`, 'g');
  return [...plain.matchAll(re)].map(m => m[1] ?? '').join(';');
}

function unreset(): string[] {
  const out: string[] = [];
  for (const [file, src] of Object.entries(components)) {
    if (file.includes('.spec.')) continue;
    for (const [tag] of src.matchAll(BARE)) {
      const cls = tag.match(/className=\{(\w+)\.(\w+)/);
      if (!cls) continue; // a class handed in by the caller (SettingsRow) is checked where it is written
      const [, binding, name] = cls;
      const imp = src.match(new RegExp(`import\\s+${binding}\\s+from\\s+'(\\.[^']+\\.module\\.css)'`));
      if (!imp?.[1] || !name) continue;
      const rules = rulesFor(modules[resolve(file, imp[1])] ?? '', name);
      const border = /(^|;|\s)border\s*:/.test(rules);
      const background = /(^|;|\s)background(-color)?\s*:/.test(rules);
      if (!border || !background) out.push(`${file} .${name}${border ? '' : ' (no border)'}${background ? '' : ' (no background)'}`);
    }
  }
  return out;
}

describe('bare buttons', () => {
  test('the scan finds the bare buttons and reads a rule', () => {
    expect(Object.values(components).some(src => /variant="bare"/.test(src))).toBe(true);
    expect(rulesFor('.a { border: 0 } /* .a { x } */ .a[data-x] { background: none } .ab { y }', 'a')).toBe(' border: 0 ; background: none ');
  });

  test('every bare button clears the browser border and background', () => {
    expect(unreset()).toEqual([]);
  });
});
