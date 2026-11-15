// allergen-match.ts — read a pack's own ingredient list and PROPOSE allergens.
//
// TypeScript port of js/allergen-match.js for Mise 2. Behaviour is identical, input for input:
// allergen-match.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports
// and odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the
// original paid for in bugs.
//
// ⚠️⚠️ IT PROPOSES. IT NEVER DECLARES. Nothing here writes `allergensCheckedAt`,
// and that is not a convention — js/allergen-model.js:123 makes ticks without a
// stamp read 'unknown' whatever they say, so a proposal is inert by construction
// and still blocks every label. A wrong suggestion costs a correction; it cannot
// become a declaration without a person pressing the verification tick.
//
// ⚠️ AND IT SHOWS ITS WORKING. Every match carries the span of the pack text it
// came from, so the screen can mark what was recognised and leave the rest grey.
// That turns the unanswerable question — «did it find everything?» — into one a
// person can actually answer: «is there anything in the grey worth checking?». An
// extractor that cannot point at its evidence cannot be checked by the person who
// is legally responsible for the answer.
//
// ⚠️ WHICH WAY IT ERRS. A MISS is worse than a false positive, so a doubtful word
// is raised as a QUESTION rather than resolved — but only just: a matcher that
// cries wolf teaches people to tap through, and then the real one goes through
// with them. Hence NEGATIVE_PHRASES, which close the traps that would otherwise
// declare milk in a dairy-free chocolate.

import { TERMS, NEGATIVE_PHRASES, REMAPS, AMBIGUOUS, TRACES_MARKERS } from './allergen-terms';
import { normalizeAllergens } from './allergen-model';

// ── Who put each tick there ──────────────────────────────────────────────────
//
// ⚠️⚠️ THIS EXISTS BECAUSE THE SUGGESTION BECAME AUTOMATIC, AND THAT CHANGES WHAT
// SAFE MEANS. While it was a button you pressed at the end, "only ever tick, never
// untick" was right: you had finished typing, and a box the app added could only be
// something you then checked. Re-running on every keystroke breaks that. Type «latte»
// and MILK is ticked; correct it to «latte di mandorla» and the milk is gone from the
// text — but the tick would stay. **The automation would have created a false
// declaration that nobody typed and nobody can see.**
//
// So each box now has an owner, and the rule is one sentence:
//
//     THE APP MAY TAKE BACK ONLY WHAT THE APP PUT THERE.
//
// Four consequences, and every one of them is a test:
//
//   · a box a PERSON moved — ticked or unticked, either column — is never touched
//     again. That covers both "I know something the pack does not say" and "no, that
//     is wrong"; without the second the app would re-tick what somebody just cleared
//     and argue with them for ever.
//   · a box the APP ticked, which the text no longer supports, is taken back.
//   · every tick loaded from the stored ingredient counts as the PERSON's, so opening
//     a saved product and typing can never lose a declaration somebody made.
//   · `may` never duplicates `contains`.
//
// ⚠️ AND NOTHING HERE WRITES A STAMP, exactly as before. js/allergen-model.js makes
// ticks without `allergensCheckedAt` read 'unknown' whatever they say, so everything
// this function does is still inert until a person confirms it.

export const tickKey = (code: string, column: string): string => `${column}:${code}`;

/**
 * Work out the tick boxes after a change to the pack text.
 *
 * proposal      { allergens, mayContain } — what readPackIngredients() just read
 * current       { contains, may } — the codes ticked right now
 * appOwned      Set of tickKey() the app itself ticked and may take back
 * humanTouched  Set of tickKey() a person has moved; untouchable
 */
export interface ReconcileInput {
  proposal?: { allergens?: Iterable<string>; mayContain?: Iterable<string> } | null;
  current?: { contains?: Iterable<string>; may?: Iterable<string> } | null;
  appOwned?: Iterable<string> | null;
  humanTouched?: Iterable<string> | null;
}

export interface ReconcileResult {
  contains: string[];
  may: string[];
  appOwned: Set<string>;
  added: number;
  removed: number;
}

export function reconcileTicks(
  { proposal, current, appOwned, humanTouched }: ReconcileInput = {},
): ReconcileResult {
  const owned = new Set<string>(appOwned || []);
  const touched = new Set<string>(humanTouched || []);
  const want = {
    contains: new Set<string>((proposal && proposal.allergens) || []),
    may: new Set<string>((proposal && proposal.mayContain) || []),
  };
  const out = {
    contains: new Set<string>((current && current.contains) || []),
    may: new Set<string>((current && current.may) || []),
  };
  let added = 0;
  let removed = 0;

  for (const column of ['contains', 'may'] as const) {
    // Take back what the app put there and the text no longer says.
    // ⚠️ `owned.has` is the whole guard: a tick that is not the app's is skipped here
    // before anything else is considered.
    for (const code of [...out[column]]) {
      const key = tickKey(code, column);
      if (!owned.has(key)) continue;
      if (want[column].has(code)) continue;
      out[column].delete(code);
      owned.delete(key);
      removed += 1;
    }
    // Propose what the text says and nobody has ruled on.
    for (const code of want[column]) {
      const key = tickKey(code, column);
      if (touched.has(key)) continue;
      if (out[column].has(code)) continue;
      out[column].add(code);
      owned.add(key);
      added += 1;
    }
  }

  // ⚠️ A CODE IN `contains` IS NOT ALSO A TRACE. buildAllergenFields strips it on save
  // anyway; doing it here stops the screen ticking a box the save would then drop.
  for (const code of [...out.may]) {
    if (!out.contains.has(code)) continue;
    out.may.delete(code);
    owned.delete(tickKey(code, 'may'));
  }

  return { contains: [...out.contains], may: [...out.may], appOwned: owned, added, removed };
}

// ⚠️⚠️ A TAP THAT LANDS AS THE APP TICKS THE SAME BOX MEANT «TICK IT», NOT «UNTICK IT». Somebody types «latte» and
// reaches for Milk «has»; the pause ends just before the finger lands, the app ticks Milk, and the tap flips it OFF —
// and a box a person moved is theirs for good, so Milk would stay missing. So a person's UNtick of a box the app ticked
// less than RECENT_APP_TICK_MS ago leaves it TICKED (and the caller makes it the person's, so the app never takes it
// back and a second tap unticks it). Only that one case; the safe direction only. The current app's port of Mise 2's
// rule (PR #388); app/src/records/allergenCardModel.ts tickByHand asks this function.
//
// `tickedAt`: when the app added each tick, on a steady clock (performance.now(): setting the phone's clock back
// cannot make an old tick look recent). A clock that went backwards proves nothing.
export const RECENT_APP_TICK_MS = 800;

export interface KeepsAppTickInput {
  key?: string;
  on?: boolean;
  appOwned?: ReadonlySet<string> | null;
  tickedAt?: ReadonlyMap<string, number> | null;
  now?: number;
}

export function keepsAppTick({ key, on, appOwned, tickedAt, now }: KeepsAppTickInput = {}): boolean {
  if (on) return false;
  if (!appOwned || !appOwned.has(key as string)) return false;
  const at = tickedAt && tickedAt.get(key as string);
  return typeof at === 'number' && (now as number) - at >= 0 && (now as number) - at < RECENT_APP_TICK_MS;
}

// ── Normalising, WITHOUT losing where each character came from ───────────────
//
// The map is the whole point: a match found at normalised index n has to be
// reported as a span of the text the person actually typed, accents, capitals,
// punctuation and all.
export interface NormalisedText {
  norm: string;
  map: number[];
  source: string;
}

export function normaliseWithMap(text: unknown): NormalisedText {
  const src = String(text == null ? '' : text);
  let norm = '';
  const map: number[] = [];
  let lastWasSpace = true;      // suppresses a leading space
  for (let i = 0; i < src.length; i += 1) {
    // ⚠️ WRITTEN AS ESCAPES, NOT AS LITERAL COMBINING MARKS. A literal U+0300–U+036F
    // range in the source is invisible in every diff and every review, and one
    // mangled byte silently stops accents being stripped — so «però» would no
    // longer match «pero» and nobody would ever see why.
    const folded = (src[i] as string).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const ch of folded) {
      if (ch >= 'a' && ch <= 'z') { norm += ch; map.push(i); lastWasSpace = false; }
      else if (ch >= '0' && ch <= '9') { norm += ch; map.push(i); lastWasSpace = false; }
      else if (!lastWasSpace) { norm += ' '; map.push(i); lastWasSpace = true; }
    }
  }
  return { norm, map, source: src };
}

// Every occurrence of `phrase` in `norm`, as whole words.
interface Span {
  start: number;
  end: number;
}

function findAll(norm: string, phrase: string): Span[] {
  const out: Span[] = [];
  if (!phrase) return out;
  const padded = ` ${norm} `;
  const needle = ` ${phrase} `;
  let at = padded.indexOf(needle);
  while (at !== -1) {
    // -1 for the pad we added at the front; the phrase starts one char in.
    out.push({ start: at, end: at + phrase.length });
    at = padded.indexOf(needle, at + 1);
  }
  return out;
}

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

// ── The one pass ─────────────────────────────────────────────────────────────
//
// Longest phrase first, always. «burro di cacao» has to be able to consume
// «burro», and «noccioline americane» has to beat «noccioline» which itself has to
// beat the hazelnut stem.
interface Hit extends Span {
  code: string;
  phrase: string;
}

export interface Question extends Span {
  phrase: string;
  kind: string;
  could: string[];
}

interface Placed {
  from: number;
  to: number;
}

function scan(norm: string, map: number[]): { hits: (Hit & Placed)[]; questions: (Question & Placed)[] } {
  const taken: Span[] = [];      // spans already claimed, so nothing shorter can re-read them
  const hits: Hit[] = [];       // { code, phrase, start, end }
  const questions: Question[] = [];  // { phrase, could, start, end }

  const claim = (span: Span): boolean => {
    if (taken.some(t => overlaps(t, span))) return false;
    taken.push(span);
    return true;
  };

  // 1. The traps, first and unconditionally. A negative phrase claims its span and
  //    says nothing, so whatever sits inside it can never be read again.
  for (const phrase of [...NEGATIVE_PHRASES].sort((a, b) => b.length - a.length)) {
    for (const span of findAll(norm, phrase)) claim(span);
  }

  // 2. Phrases whose obvious stem names the WRONG allergen.
  for (const remap of [...REMAPS].sort((a, b) => b.phrase.length - a.phrase.length)) {
    for (const span of findAll(norm, remap.phrase)) {
      if (!claim(span)) continue;
      if (remap.code) hits.push({ code: remap.code, phrase: remap.phrase, ...span });
    }
  }

  // 3. The vocabulary proper, longest phrase first across every code at once —
  //    «latte di mandorla» must be settled before «latte».
  const all: { code: string; phrase: string }[] = [];
  for (const [code, langs] of Object.entries(TERMS)) {
    for (const lang of ['en', 'it']) {
      for (const phrase of langs[lang as 'en' | 'it'] || []) all.push({ code, phrase });
    }
  }
  all.sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { code, phrase } of all) {
    for (const span of findAll(norm, phrase)) {
      if (!claim(span)) continue;
      hits.push({ code, phrase, ...span });
    }
  }

  // 4. What it cannot answer. Raised, never resolved.
  for (const item of [...AMBIGUOUS].sort((a, b) => b.phrase.length - a.phrase.length)) {
    for (const span of findAll(norm, item.phrase)) {
      if (!claim(span)) continue;
      questions.push({
        phrase: item.phrase, kind: item.kind || 'vague', could: [...item.could], ...span,
      });
    }
  }

  // Spans reported in the ORIGINAL text's coordinates.
  const place = <T extends Span>(h: T): T & Placed => ({
    ...h,
    from: map.length ? (map[h.start] as number) : 0,
    to: map.length ? ((map[Math.min(h.end, map.length) - 1] as number) + 1) : 0,
  });
  return { hits: hits.map(place), questions: questions.map(place) };
}

// ── Cutting composition from traces ──────────────────────────────────────────
//
// ⚠️ BEFORE ANYTHING IS MATCHED, because the two lists mean different things and
// merging them is how "may contain nuts" turns into "contains nuts" on a label.
export function splitTraces(text: unknown): { composition: string; traces: string } {
  const { norm, map, source } = normaliseWithMap(text);
  let cut = -1;
  for (const marker of TRACES_MARKERS) {
    for (const span of findAll(norm, marker)) {
      if (cut === -1 || span.start < cut) cut = span.start;
    }
  }
  if (cut === -1) return { composition: source, traces: '' };
  const at = map.length ? map[Math.min(cut, map.length - 1)] : source.length;
  return { composition: source.slice(0, at), traces: source.slice(at) };
}

export interface PackMatch {
  code: string;
  phrase: string;
  from: number;
  to: number;
  traces: boolean;
}

export interface PackReading {
  allergens: string[];
  mayContain: string[];
  questions: (Question & Placed)[];
  matches: PackMatch[];
  recognisedAnything: boolean;
  hasText: boolean;
}

/**
 * Read a pack's ingredient list.
 *
 * Returns the two lists a person then CONFIRMS, the questions it could not answer,
 * and every span it recognised so the screen can show its working.
 */
export function readPackIngredients(text: unknown): PackReading {
  const { composition, traces } = splitTraces(text);

  const compNorm = normaliseWithMap(composition);
  const comp = scan(compNorm.norm, compNorm.map);

  const traceNorm = normaliseWithMap(traces);
  const trace = scan(traceNorm.norm, traceNorm.map);
  const traceOffset = composition.length;

  const allergens = normalizeAllergens(comp.hits.map(h => h.code));
  // ⚠️ A CODE ALREADY IN `allergens` IS NOT ALSO A TRACE. buildAllergenFields strips
  // it anyway; doing it here keeps the two proposals consistent with what will be
  // saved, so the screen never ticks a box that the save then drops.
  const mayContain = normalizeAllergens(trace.hits.map(h => h.code))
    .filter(code => !allergens.includes(code));

  return {
    allergens,
    mayContain,
    questions: [
      ...comp.questions,
      ...trace.questions.map(q => ({ ...q, from: q.from + traceOffset, to: q.to + traceOffset })),
    ],
    matches: [
      ...comp.hits.map(h => ({ code: h.code, phrase: h.phrase, from: h.from, to: h.to, traces: false })),
      ...trace.hits.map(h => ({
        code: h.code, phrase: h.phrase,
        from: h.from + traceOffset, to: h.to + traceOffset, traces: true,
      })),
    ].sort((a, b) => a.from - b.from),
    // ⚠️ EMPTY IS AN HONEST ANSWER AND MUST LOOK LIKE ONE. A pack whose words this
    // file does not know produces no ticks, and the screen has to say "I recognised
    // nothing here" rather than leaving a person to read that as "contains nothing".
    recognisedAnything: comp.hits.length + trace.hits.length + comp.questions.length
      + trace.questions.length > 0,
    hasText: String(text == null ? '' : text).trim().length > 0,
  };
}
