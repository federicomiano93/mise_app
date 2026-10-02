// card-source.mjs — the text of js/ingredient-record-form.js, split in the two cards it draws.
//
// The form file holds BOTH the new «Confezione: Singola | Cartone» card and, since 2 Oct 2026, the card of
// before (copied from the branch before the new card, for the old stored price shapes). Every block that
// belongs to the card of before only sits between `// legacy-card:begin` and `// legacy-card:end`. A source-text
// test about the NEW card reads newCardSource(), so «the new card has no Unità d'ordine menu» stays a
// statement about the new card; a test about the card of before reads legacyCardSource().
//
// ⚠️ The sentinels are asserted to be balanced, so a stray one cannot silently hide new-card code.
import { readFileSync } from 'node:fs';

const raw = () => readFileSync(new URL('../../js/ingredient-record-form.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BLOCK = /^[ \t]*\/\/ legacy-card:begin\n[\s\S]*?^[ \t]*\/\/ legacy-card:end\n/gm;

export function wholeCardSource() { return raw(); }

export function newCardSource() {
  const src = raw();
  const begins = (src.match(/\/\/ legacy-card:begin/g) || []).length;
  const ends = (src.match(/\/\/ legacy-card:end/g) || []).length;
  if (begins === 0 || begins !== ends) throw new Error(`legacy-card sentinels are not balanced (${begins} begin, ${ends} end)`);
  return src.replace(BLOCK, '');
}

export function legacyCardSource() {
  return (raw().match(BLOCK) || []).join('\n');
}

// The same, with comments taken out, for tests that match code and must not be fooled by a remark.
export const withoutComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
