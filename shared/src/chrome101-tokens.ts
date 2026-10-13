// ⚠️ THE LAB TABLET'S CHROME STOPS AT 101 (SM-T550, measured over adb 13 Oct 2026: the newest Google Play serves).
// lightningcss lowers oklch, nesting and media ranges; it lowers none of the tokens below, and a browser that does
// not know a CSS declaration drops it without a word, while a missing JS method throws. The two chrome101 specs (one
// in `app/src/styles`, one here, because only shared's own tests may read shared's files) read every source file —
// never the specs — and fail, with file and token, on anything newer than Chrome 101. A use guarded by a feature
// check is the one reason to add an exception, with the check named. Used only by those specs.
//
// Minimum Chrome version of each token:
//   CSS   :has( 105 · @container / container-type 105 · color-mix( 111 · subgrid 117 · @starting-style 117
//         field-sizing 123 · light-dark( 123 · @scope 118 · :user-invalid / :user-valid 119
//         translate: / scale: / rotate: as properties 104
//   JS    .toSorted( / .toReversed( / .toSpliced( 110 · Object.groupBy / Map.groupBy 117 · Promise.withResolvers 119
//         AbortSignal.timeout 103 · AbortSignal.any 116 · URL.canParse 120 · Array.fromAsync 121
//         Set .union( / .intersection( / .symmetricDifference( / .isSubsetOf( / .isSupersetOf( / .isDisjointFrom( 122
//         .difference( 122 · Array .with( 110 · the inert attribute 102
//         Intl.DurationFormat 129 · roundingMode / trailingZeroDisplay (NumberFormat v3) 106
//         formatRange( 106 (Intl.NumberFormat; DateTimeFormat's is 76) · showPopover / popover= 114
//         startViewTransition 111 · .checkVisibility( 105 · .inert 102 · scrollend 114
export type Tokens = Array<[string, RegExp]>;

export const CSS_TOKENS: Tokens = [
  [':has(', /:has\(/],
  ['@container', /@container\b/],
  ['container-type', /container-type\s*:/],
  ['color-mix(', /color-mix\(/],
  ['subgrid', /\bsubgrid\b/],
  ['@starting-style', /@starting-style\b/],
  ['field-sizing', /field-sizing\s*:/],
  ['light-dark(', /light-dark\(/],
  ['@scope', /@scope\b/],
  [':user-invalid', /:user-invalid\b/],
  [':user-valid', /:user-valid\b/],
  ['translate:', /(?:^|[;{])\s*translate\s*:/],
  ['scale:', /(?:^|[;{])\s*scale\s*:/],
  ['rotate:', /(?:^|[;{])\s*rotate\s*:/],
];

export const JS_TOKENS: Tokens = [
  ['.toSorted(', /\.toSorted\(/],
  ['.toReversed(', /\.toReversed\(/],
  ['.toSpliced(', /\.toSpliced\(/],
  ['Object.groupBy', /Object\.groupBy\b/],
  ['Map.groupBy', /Map\.groupBy\b/],
  ['Promise.withResolvers', /Promise\.withResolvers\b/],
  ['AbortSignal.timeout', /AbortSignal\.timeout\b/],
  ['AbortSignal.any', /AbortSignal\.any\b/],
  ['URL.canParse', /URL\.canParse\b/],
  ['Array.fromAsync', /Array\.fromAsync\b/],
  ['.union(', /\.union\(/],
  ['.intersection(', /\.intersection\(/],
  ['.symmetricDifference(', /\.symmetricDifference\(/],
  ['.isSubsetOf(', /\.isSubsetOf\(/],
  ['.isSupersetOf(', /\.isSupersetOf\(/],
  ['.isDisjointFrom(', /\.isDisjointFrom\(/],
  ['Intl.DurationFormat', /Intl\.DurationFormat\b/],
  ['roundingMode', /\broundingMode\b/],
  ['trailingZeroDisplay', /\btrailingZeroDisplay\b/],
  ['formatRange(', /formatRange\(/],
  ['showPopover', /\bshowPopover\b/],
  ['popover=', /\bpopover\s*=/],
  ['startViewTransition', /\bstartViewTransition\b/],
  ['.checkVisibility(', /\.checkVisibility\(/],
  ['.inert', /\.inert\b/],
  ['inert attribute', /\binert[\s=>{/]/],
  ['.difference(', /\.difference\(/],
  ['.with(', /\.with\(/],
  ['scrollend', /\bscrollend\b/],
];

// A comment is replaced by its own newlines, so a line number in a finding is the line in the real file.
const blankKeepingNewlines = (match: string): string => match.replace(/[^\n]/g, '');
export const cssWithoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, blankKeepingNewlines);

// Comments out of TS/TSX so an explanation naming a token is not a use. A `//` inside a string or URL is cut too —
// at worst this hides the rest of that line.
export const codeWithoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, blankKeepingNewlines).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

export function findings(files: Record<string, string>, tokens: Tokens, strip: (text: string) => string): string[] {
  const found: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    strip(text).split('\n').forEach((line, index) => {
      for (const [token, pattern] of tokens) {
        if (pattern.test(line)) found.push(`${file}:${index + 1} ${token}`);
      }
    });
  }
  return found;
}

// The self-check both specs run, so each proves the scanner can see what it forbids (and ignores what it should).
export function scannerSeesWhatItForbids(): string[] {
  return [
    ...findings({ 'a.css': '.a:has(b) { color: red; }' }, CSS_TOKENS, cssWithoutComments),
    ...findings({ 'b.css': '.a {\n  translate: 1px 2px;\n}' }, CSS_TOKENS, cssWithoutComments),
    ...findings({ 'c.css': '.a { transform: translate(1px, 2px); }' }, CSS_TOKENS, cssWithoutComments),
    ...findings({ 'a.ts': 'const b = a.toSorted();' }, JS_TOKENS, codeWithoutComments),
    ...findings({ 'b.ts': '// a.toSorted() is too new' }, JS_TOKENS, codeWithoutComments),
    ...findings({ 'd.css': '.a { translate: 1px; }' }, CSS_TOKENS, cssWithoutComments),
    ...findings({ 'e.css': '.a {color: red;rotate: 5deg}' }, CSS_TOKENS, cssWithoutComments),
    ...findings({ 'c.ts': 'a.difference(b); a.with(0, 1);' }, JS_TOKENS, codeWithoutComments),
    ...findings({ 'a.tsx': 'return <div inert={open} />;' }, JS_TOKENS, codeWithoutComments),
    ...findings({ 'f.ts': '/* one\n two */\nx.toSorted();' }, JS_TOKENS, codeWithoutComments),
  ];
}
