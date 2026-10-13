import { describe, expect, it } from 'vitest';
import { JS_TOKENS, codeWithoutComments, findings, scannerSeesWhatItForbids } from './chrome101-tokens';

// Nothing in shared/src newer than Chrome 101 (the lab tablet's ceiling); the table is in chrome101-tokens.ts and
// app/src/styles/chrome101.spec.ts reads the app's own source. shared has no stylesheets.
// The table itself is not scanned: it names every token.
const code = import.meta.glob<string>(
  ['./**/*.ts', '!./**/*.spec.*', '!./**/*.test.*', '!./chrome101-tokens.ts'],
  { query: '?raw', import: 'default', eager: true },
);

describe('shared/src uses nothing newer than Chrome 101', () => {
  it('reads the source it checks, and sees what it forbids', () => {
    expect(Object.keys(code).length).toBeGreaterThan(20);
    expect(scannerSeesWhatItForbids()).toEqual(['a.css:1 :has(', 'b.css:2 translate:', 'a.ts:1 .toSorted(']);
  });

  it('has no JS API newer than Chrome 101', () => {
    expect(findings(code, JS_TOKENS, codeWithoutComments)).toEqual([]);
  });
});
