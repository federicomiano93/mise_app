import { describe, expect, it } from 'vitest';
import {
  CSS_TOKENS, JS_TOKENS, codeWithoutComments, cssWithoutComments, findings, scannerSeesWhatItForbids,
} from '@mise/shared/chrome101-tokens';

// Nothing in app/src newer than Chrome 101 (the lab tablet's ceiling). The token table, with the Chrome version of
// each, is in shared/src/chrome101-tokens.ts; shared's own source is read by shared/src/chrome101.spec.ts.
const css = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true });
const code = import.meta.glob<string>(
  ['../**/*.ts', '../**/*.tsx', '!../**/*.spec.*', '!../**/*.test.*'],
  { query: '?raw', import: 'default', eager: true },
);
// The service worker's source (app/sw/worker.js, outside src/): it runs on the lab tablet's Chrome 101 too.
const worker = import.meta.glob<string>('../../sw/*.js', { query: '?raw', import: 'default', eager: true });

describe('app/src uses nothing newer than Chrome 101', () => {
  it('reads the source it checks, and sees what it forbids', () => {
    expect(Object.keys(css).length + Object.keys(code).length).toBeGreaterThan(50);
    expect(Object.keys(css).length).toBeGreaterThan(20);
    expect(Object.keys(code).some(file => file.includes('.spec.'))).toBe(false);
    expect(scannerSeesWhatItForbids()).toEqual(['a.css:1 :has(', 'b.css:2 translate:', 'a.ts:1 .toSorted(', 'd.css:1 translate:', 'e.css:1 rotate:', 'c.ts:1 .difference(', 'c.ts:1 .with(', 'a.tsx:1 inert attribute', 'f.ts:3 .toSorted(']);
  });

  it('has no CSS newer than Chrome 101', () => {
    expect(findings(css, CSS_TOKENS, cssWithoutComments)).toEqual([]);
  });

  it('has no JS or DOM API newer than Chrome 101', () => {
    expect(findings(code, JS_TOKENS, codeWithoutComments)).toEqual([]);
  });

  it('nor does the service worker', () => {
    expect(Object.keys(worker)).toEqual(['../../sw/worker.js']);
    expect(findings(worker, JS_TOKENS, codeWithoutComments)).toEqual([]);
  });
});
