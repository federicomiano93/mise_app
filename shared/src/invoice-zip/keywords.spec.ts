// The keyword lists of the invoice reader against their source of truth (decision T6), and the one NEW test
// of this slice (it has no original in tests/). The seven patterns that decide whether an invoice line is
// noise, a cost, a discount, food, ready-made, packaging or a drink live twice: in invoice-import/classify.py
// (the script the reader was ported from, still the reference) and in keywords.ts. A word added to one and
// not to the other would make the two disagree on a real invoice without any behaviour test noticing, so this
// spec reads the Python file as text, turns each pattern into the JavaScript spelling and demands the same
// source as keywords.ts — and the flags `iu`.
//
// The conversion is the one py-compat.ts describes: `\b` in front of a word is B_START and after a word is
// B_END (every `\b` in these patterns sits next to a word character on one side), `\w` is WORD, and `^\W*` is
// `^[^\p{L}\p{N}_]*`.

import { describe, expect, test } from 'vitest';
import pythonSource from '../../../invoice-import/classify.py?raw';
import * as keywords from './keywords';
import { B_END, B_START, WORD } from './py-compat';

const NAMES = ['NOISE_RE', 'COSTS_RE', 'DISCOUNT_RE', 'FOOD_RE', 'READY_RE', 'PACKAGING_RE', 'BEVERAGE_RE'] as const;

// The pattern of `NAME = re.compile(` in the Python file: the raw string pieces r"…" in order, comment lines
// skipped, up to the flag.
function pythonPattern(name: string): string {
  const start = pythonSource.indexOf(`\n${name} = re.compile(`);
  if (start < 0) throw new Error(`${name} is not in invoice-import/classify.py any more`);
  const rest = pythonSource.slice(start + 1);
  const end = rest.indexOf('re.I');
  if (end < 0) throw new Error(`${name} in invoice-import/classify.py has no re.I flag`);
  const body = rest.slice(rest.indexOf('(') + 1, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const pieces = [...body.matchAll(/r"([^"]*)"/g)].map((m) => m[1] as string);
  if (pieces.length === 0) throw new Error(`${name} in invoice-import/classify.py has no r"…" piece`);
  return pieces.join('');
}

// Python's `\b`, `\w`, `\W` in the JavaScript spelling of py-compat.ts.
function toJavaScript(python: string): string {
  let out = '';
  for (let i = 0; i < python.length; i += 1) {
    const two = python.slice(i, i + 2);
    if (two === '\\b') {
      const before = python[i - 1];
      out += before === undefined || before === '|' || before === '(' ? B_START : B_END;
      i += 1;
    } else if (two === '\\w') {
      out += WORD;
      i += 1;
    } else if (python.slice(i, i + 4) === '^\\W*') {
      out += '^[^\\p{L}\\p{N}_]*';
      i += 3;
    } else if (two === '\\W' || two === '\\d' || two === '\\D') {
      throw new Error(`classify.py now uses ${two}, which this conversion does not know`);
    } else if (python[i] === '\\') {
      out += two; // any other escape (\. \* \S \s …) means the same in both
      i += 1;
    } else {
      out += python[i];
    }
  }
  return out;
}

describe('the keyword patterns of keywords.ts are those of invoice-import/classify.py', () => {
  test('keywords.ts holds exactly the seven patterns', () => {
    expect(Object.keys(keywords).sort()).toStrictEqual([...NAMES].sort());
  });

  test.each(NAMES)('%s has the same words in the same order, and the flags iu', (name) => {
    const port = keywords[name];
    expect(port.flags, `${name}: flags`).toBe('iu');
    expect(
      toJavaScript(pythonPattern(name)),
      `${name} differs between invoice-import/classify.py and shared/src/invoice-zip/keywords.ts — a word was `
      + 'changed in one list and not in the other (the current app\'s js/orders/invoice-zip/classify.js too): change both',
    ).toBe(port.source);
  });

  test('the conversion itself reads the Python spelling the way py-compat.ts says', () => {
    expect(toJavaScript('^\\W*(a)\\b')).toBe(`^[^\\p{L}\\p{N}_]*(a)${B_END}`);
    expect(toJavaScript('\\b(a|b\\w*)\\b')).toBe(`${B_START}(a|b${WORD}*)${B_END}`);
    expect(toJavaScript('x|\\byog\\.|y')).toBe(`x|${B_START}yog\\.|y`);
    expect(toJavaScript('\\bcaps\\b|caff\\S*\\s*c')).toBe(`${B_START}caps${B_END}|caff\\S*\\s*c`);
  });

  test('the extraction reads every piece of a multi-line pattern, skipping comments', () => {
    // BEVERAGE_RE is two pieces, READY_RE has a comment line between its pieces.
    expect(pythonPattern('BEVERAGE_RE')).toContain('coca cola|\\bacqua\\b');
    expect(pythonPattern('BEVERAGE_RE')).toContain('|prosecco|\\bvino\\b');
    expect(pythonPattern('READY_RE')).not.toContain('Bar and shelf');
    expect(pythonPattern('READY_RE')).toContain('cipolle fette|\\byog\\.');
  });
});
