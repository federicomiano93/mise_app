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
import pythonText from '../../../invoice-import/classify.py?raw';
import legacyClassifySource from '../../../js/orders/invoice-zip/classify.js?raw';
import keywordsSource from './keywords.ts?raw';
import * as keywords from './keywords';
import { B_END, B_START, WORD } from './py-compat';

// The Python file's text, in a holder so that one test can feed the reader an edited copy.
const pythonSource: string = pythonText;
const pythonSourceRef = { current: pythonText };

const NAMES =['NOISE_RE', 'COSTS_RE', 'DISCOUNT_RE', 'FOOD_RE', 'READY_RE', 'PACKAGING_RE', 'BEVERAGE_RE'] as const;

// The pattern of `NAME = re.compile(` in the Python file: the raw string pieces r"…" in order, comment lines
// skipped, up to the flag.
function pythonPattern(name: string): string {
  const source = pythonSourceRef.current;
  const start = source.indexOf(`\n${name} = re.compile(`);
  if (start < 0) throw new Error(`${name} is not in invoice-import/classify.py any more`);
  const rest = source.slice(start + 1);
  const end = rest.indexOf('re.I');
  if (end < 0) throw new Error(`${name} in invoice-import/classify.py has no re.I flag`);
  // ⚠️ THE FLAGS ARE EXACTLY re.I (review of 24 Oct 2026): a flag added later (re.A, re.X…) changes what the pattern
  // matches, and the port would not follow.
  const flags = rest.slice(end, rest.indexOf(')', end)).replace(/[\s,]+$/, '').trim();
  if (flags !== 're.I') throw new Error(`${name} in invoice-import/classify.py has the flags «${flags}», not re.I alone`);
  const lines = rest.slice(rest.indexOf('(') + 1, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'));
  // ⚠️ EVERY OTHER LINE MUST BE NOTHING BUT r"…" PIECES (review of 24 Oct 2026): a piece written "…" or r'…' is valid
  // Python and would otherwise be skipped silently — a word added that way would never be compared.
  for (const line of lines) {
    if (!/^\s*(r"[^"]*"\s*)*,?\s*$/.test(line)) {
      throw new Error(`${name} in invoice-import/classify.py has a line this check cannot read (only r"…" pieces): ${line.trim()}`);
    }
  }
  const pieces = [...lines.join('\n').matchAll(/r"([^"]*)"/g)].map((m) => m[1] as string);
  if (pieces.length === 0) throw new Error(`${name} in invoice-import/classify.py has no r"…" piece`);
  return pieces.join('');
}

// The block of the seven patterns as SOURCE TEXT, comments and `export` dropped and spaces collapsed: keywords.ts writes
// them exactly as the current app's classify.js does (the same template pieces), so the two texts must be equal.
function patternBlock(source: string, file: string): string {
  const from = source.indexOf('const NOISE_RE');
  const beverage = source.indexOf('const BEVERAGE_RE');
  const to = source.indexOf("'iu');", beverage);
  if (from < 0 || beverage < 0 || to < 0) throw new Error(`the seven patterns are not where the check looks for them in ${file}`);
  return source.slice(from, to + "'iu');".length)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join(' ')
    .replace(/\bexport\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  test('keywords.ts writes the seven patterns exactly as the current app\'s js/orders/invoice-zip/classify.js (a word added there alone is caught)', () => {
    expect(
      patternBlock(keywordsSource, 'shared/src/invoice-zip/keywords.ts'),
      'the keyword patterns of js/orders/invoice-zip/classify.js and shared/src/invoice-zip/keywords.ts differ: change both (and classify.py)',
    ).toBe(patternBlock(legacyClassifySource, 'js/orders/invoice-zip/classify.js'));
  });

  test('the extraction refuses a piece it cannot read and a flag other than re.I', () => {
    const swap = (from: string, to: string) => {
      const original = pythonSource;
      expect(original.includes(from), from).toBe(true);
      return original.replace(from, to);
    };
    // Checked on edited copies of the real file, through the same reader.
    const readFrom = (source: string, name: string) => {
      const saved = pythonSourceRef.current;
      pythonSourceRef.current = source;
      try { return pythonPattern(name); } finally { pythonSourceRef.current = saved; }
    };
    expect(() => readFrom(swap('r"|prosecco|\\bvino\\b"', 'r"|prosecco|\\bvino\\b" "|kiwi"'), 'BEVERAGE_RE')).toThrow(/cannot read/);
    // A regular expression, not a text: on Windows the checkout has CRLF line ends, on CI LF.
    const withFlag = pythonSource.replace(/(r"\|prosecco\|\\bvino\\b",\s*)re\.I,/, '$1re.I | re.A,');
    expect(withFlag).not.toBe(pythonSource);
    expect(() => readFrom(withFlag, 'BEVERAGE_RE')).toThrow(/flags/);
    expect(readFrom(pythonSource, 'BEVERAGE_RE')).toContain('|prosecco|\\bvino\\b');
  });

  test('the extraction reads every piece of a multi-line pattern, skipping comments', () => {
    // BEVERAGE_RE is two pieces, READY_RE has a comment line between its pieces.
    expect(pythonPattern('BEVERAGE_RE')).toContain('coca cola|\\bacqua\\b');
    expect(pythonPattern('BEVERAGE_RE')).toContain('|prosecco|\\bvino\\b');
    expect(pythonPattern('READY_RE')).not.toContain('Bar and shelf');
    expect(pythonPattern('READY_RE')).toContain('cipolle fette|\\byog\\.');
  });
});
