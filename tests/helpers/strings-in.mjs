// The text inside each string literal on one line of JavaScript.
//
// ⚠️⚠️ IT EXISTS BECAUSE THE OBVIOUS REGEX READS THE CODE, NOT THE STRINGS, and does
// so in complete silence. `/['"`]([^'"`]{25,})['"`]/` looks like it matches a long
// string literal. It does not: it happily pairs the CLOSING quote of one string with
// the OPENING quote of the next and captures everything between them — which is code.
// On js/market.js it returned sixteen "strings", fifteen of them fragments like
//
//     ",\n  },\n});\n\nexport function labelWord(key, lang) {\n  const table = LABEL_WO"
//
// and not one of the real ones. A guard built on it passed on anything at all, and it
// was caught only by mutation-testing the file that owned it (23 Aug 2026).
//
// ⚠️ AND IT STOPS DEAD AT A COMMENT, which a regex over the line cannot do. Explaining
// the app in prose is exactly where an apostrophe or a sentence belongs; the rules
// these scans enforce are about what reaches a screen.
//
// Naive about a quote inside a comment inside a string, deliberately: this app has no
// such line, and a parser that handles it would be one nobody can read.
export function stringsIn(line) {
  // ⚠️⚠️ ONE LINE, AND HANDING IT A WHOLE FILE USED TO ANSWER `[]` IN SILENCE. The
  // first test written against it did exactly that: most source files open with a
  // `//` comment, so the guard below returned nothing, the caller found no offenders
  // and a brand-new check passed while looking at nothing at all (23 Aug 2026).
  // A helper that cannot do a job must SAY so — the same rule this project applies to
  // mutation probes that match nothing.
  if (typeof line !== 'string') throw new TypeError('stringsIn needs a string');
  if (line.includes('\n')) {
    throw new Error('stringsIn takes ONE line — split the file first, or it silently reads nothing');
  }
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) break;
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let j = i + 1;
      let text = '';
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') { text += line[j + 1] || ''; j += 2; continue; }
        text += line[j];
        j += 1;
      }
      out.push(text);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}
