// allergen-model.ts — what an ingredient declares: which of the 14 regulated
// allergens it contains, what it may contain, and its nutrition per 100 g.
// PURE: no DOM, no Firestore, so every rule below is asserted in a unit test
// rather than read back out of rendered markup (P15).
//
// TypeScript port of js/allergen-model.js for Mise 2. Behaviour is identical, input for input:
// shared/src/allergen-model.spec.ts runs every test against BOTH files and parity.spec.ts
// compares their exports. The comments below are the ones the original paid for in bugs.
// The labels here are the English names of the codes, exactly as in the original; the words a
// label PRINTS in each country are chosen elsewhere (the output language, never this file).
//
// ⚠️⚠️ THIS IS THE ONLY PART OF THIS APP THAT CAN HURT SOMEBODY.
// Everything else gets money, doses or times wrong. A missing allergen sends
// somebody to hospital. In the UK it is also the law (Natasha's Law, retained
// Reg. 1169/2011) and wrong information is an offence, not an inconvenience.
// So the whole file is built around one decision: it would rather say "I do not
// know" than produce something that LOOKS complete and is not.
//
// ⚠️ IT LIVES IN shared/, NOT IN A FEATURE, for the same reason as price-model: Orders
// owns ingredients and is where this data is typed, the Recipe catalogue owns the recipes
// it has to be rolled up through, and the labels screen reads the result. A feature may
// never import from another feature, and a second COPY of this would be far worse than a
// copied dialog — two files that quietly disagree about whether something contains nuts is
// exactly the failure this must not have.

// ── The three states, and why there are three ────────────────────────────────
//
// ⚠️ ALLERGEN INFORMATION HAS THREE STATES, NOT TWO:
//
//   1. nobody has said anything yet          → 'unknown'
//   2. checked: it contains none of the 14   → 'none'
//   3. checked: it contains these            → 'listed'
//
// If 1 and 2 look the same — both being "no ticks" — then an ingredient nobody
// has filled in silently reads as allergen-free, and that is the one ambiguity
// that can kill. It is the same reasoning that makes a VAT rate of 0 a real
// answer in foodcost-model.js rather than a missing one, and that stops the push
// sender firing when it cannot re-read whether an alarm is still wanted.
//
// The state is carried by `allergensCheckedAt` — a timestamp rather than a
// boolean, because it also answers the question that matters in a year: how long
// since anybody re-read this supplier's spec? Suppliers change recipes without
// telling anyone.
export const ALLERGEN_STATES = Object.freeze(['unknown', 'none', 'listed'] as const);
export type AllergenState = (typeof ALLERGEN_STATES)[number];

// ── The 14, named the way the law requires ───────────────────────────────────
//
// ⚠️ THE SPECIFIC CEREAL AND THE SPECIFIC NUT MUST BE NAMED, not the category.
// The regulation asks for "wheat", not "cereals containing gluten"; "hazelnut",
// not "nuts". So the codes below expand those two categories rather than
// flattening them — a label reading "contains nuts" is not compliant, and worse,
// is useless to somebody who can eat almonds but not hazelnuts.
export const ALLERGENS = Object.freeze([
  // 1 — cereals containing gluten, named individually
  { code: 'gluten-wheat', group: 'gluten', label: 'Wheat' },
  { code: 'gluten-rye', group: 'gluten', label: 'Rye' },
  { code: 'gluten-barley', group: 'gluten', label: 'Barley' },
  { code: 'gluten-oats', group: 'gluten', label: 'Oats' },
  { code: 'gluten-spelt', group: 'gluten', label: 'Spelt' },
  { code: 'gluten-kamut', group: 'gluten', label: 'Kamut' },
  // 8 — tree nuts, named individually
  { code: 'nuts-almond', group: 'nuts', label: 'Almond' },
  { code: 'nuts-hazelnut', group: 'nuts', label: 'Hazelnut' },
  { code: 'nuts-walnut', group: 'nuts', label: 'Walnut' },
  { code: 'nuts-cashew', group: 'nuts', label: 'Cashew' },
  { code: 'nuts-pecan', group: 'nuts', label: 'Pecan' },
  { code: 'nuts-brazil', group: 'nuts', label: 'Brazil nut' },
  { code: 'nuts-pistachio', group: 'nuts', label: 'Pistachio' },
  { code: 'nuts-macadamia', group: 'nuts', label: 'Macadamia' },
  // the remaining 12 categories, which the law does not subdivide
  { code: 'celery', group: 'celery', label: 'Celery' },
  { code: 'crustaceans', group: 'crustaceans', label: 'Crustaceans' },
  { code: 'eggs', group: 'eggs', label: 'Eggs' },
  { code: 'fish', group: 'fish', label: 'Fish' },
  { code: 'lupin', group: 'lupin', label: 'Lupin' },
  { code: 'milk', group: 'milk', label: 'Milk' },
  { code: 'molluscs', group: 'molluscs', label: 'Molluscs' },
  { code: 'mustard', group: 'mustard', label: 'Mustard' },
  { code: 'peanuts', group: 'peanuts', label: 'Peanuts' },
  { code: 'sesame', group: 'sesame', label: 'Sesame' },
  { code: 'soybeans', group: 'soybeans', label: 'Soya' },
  { code: 'sulphites', group: 'sulphites', label: 'Sulphites' },
] as const);

export type Allergen = (typeof ALLERGENS)[number];
export type AllergenCode = Allergen['code'];
export type AllergenGroup = Allergen['group'];

export const ALLERGEN_CODES: readonly AllergenCode[] = Object.freeze(ALLERGENS.map(a => a.code));

// Looked up with any key at all (a code read from a document may be anything), hence the
// `unknown` key type: a key that is not a code simply finds nothing.
const BY_CODE: ReadonlyMap<unknown, Allergen> = new Map(ALLERGENS.map((a): [AllergenCode, Allergen] => [a.code, a]));

// The heading a group of codes sits under on a form. Order follows ALLERGENS, so
// the screen and this file can never disagree about it.
export const ALLERGEN_GROUPS: readonly AllergenGroup[] = Object.freeze([...new Set(ALLERGENS.map(a => a.group))]);

export function allergenLabel(code: unknown): string {
  const found = BY_CODE.get(code);
  return found ? found.label : '';
}

export function isAllergenCode(code: unknown): code is AllergenCode {
  return BY_CODE.has(code);
}

// ⚠️ A CODE THIS FILE DOES NOT KNOW IS DROPPED, NOT PASSED THROUGH. Anything that
// reaches a label has to be printable; an unknown code would appear as a blank or
// as raw text on a legal declaration. Dropping it is safe in the only direction
// that matters here — it cannot invent an allergen — and the rules cap the list
// size so a corrupt document cannot flood the screen either.
//
// ⚠️ AND ONE LINE DECIDES ALL OF IT, deliberately. Walking the canonical list and
// keeping what was asked for drops unknown codes, fixes the order, and makes
// duplicates impossible, all at once. An earlier version ALSO tested each incoming
// code with isAllergenCode() on the way in; that read as extra safety and was
// DEAD — a mutation deleted it and all 927 tests stayed green, because this filter
// had already covered it. Two places deciding one thing is how they drift apart.
//
// The canonical order matters beyond tidiness: two ingredients containing the same
// things must produce the same list whatever order the boxes were ticked in, which
// is what lets a label be compared with the one printed last month.
export function normalizeAllergens(raw: unknown): AllergenCode[] {
  if (!Array.isArray(raw)) return [];
  const items: unknown[] = raw;
  const wanted = new Set(items.map(value => String(value == null ? '' : value).trim()));
  return ALLERGEN_CODES.filter(code => wanted.has(code));
}

// ── What state is this ingredient's allergen information in? ─────────────────

// The fields of an ingredient document (`ingredients/{id}`) this file reads, each as
// untrusted as the document it came from.
interface IngredientAllergenFields {
  allergens?: unknown;
  allergensCheckedAt?: unknown;
  nutrition?: unknown;
}

// ⚠️ READ THE STAMP, NOT THE LIST. An empty list means "contains none of them"
// only when somebody has SAID so; on its own it means nothing at all.
export function allergenState(ingredient: unknown): AllergenState {
  if (!ingredient || typeof ingredient !== 'object') return 'unknown';
  if (!checkedAt(ingredient)) return 'unknown';
  return normalizeAllergens((ingredient as IngredientAllergenFields).allergens).length ? 'listed' : 'none';
}

// The verification stamp as a trimmed ISO-ish string, or '' when there is none.
// Kept as text rather than a Date so it survives localStorage and Firestore
// unchanged, exactly like the other timestamps in this app.
export function checkedAt(ingredient: unknown): string {
  const raw = ingredient && (ingredient as IngredientAllergenFields).allergensCheckedAt;
  const text = String(raw == null ? '' : raw).trim();
  return text ? text.slice(0, 40) : '';
}

// Is this ingredient safe to build a LABEL from? Nothing else in this file is
// allowed to answer that question, so there is one place to look and one place to
// break on purpose in a mutation test.
export function isDeclared(ingredient: unknown): boolean {
  return allergenState(ingredient) !== 'unknown';
}

// ── "May contain" is a different fact ────────────────────────────────────────
//
// ⚠️ NEVER MERGED INTO `allergens`. "Contains milk" and "may contain traces of
// milk" are different statements with different consequences: somebody with a
// severe allergy avoids both, somebody with an intolerance may not. Merging them
// would also make every product carrying one nut-adjacent ingredient declare nuts
// outright, which is how a label stops being read at all.
//
// ⚠️ AND THIS IS ONLY THE SUPPLIER'S DECLARATION. Cross-contamination in YOUR
// kitchen — the same bench, the same mixer, flour in the air — is not in this
// data and cannot be. That judgement is the owner's, and the screens say so.
export function normalizeMayContain(raw: unknown): AllergenCode[] {
  return normalizeAllergens(raw);
}

// ── Nutrition, per 100 g ─────────────────────────────────────────────────────
//
// The seven values a declaration must carry, in the order they must be printed.
// ⚠️ SALT, NOT SODIUM: the regulation asks for salt, and the two differ by a
// factor of 2.5 — printing sodium in the salt row understates it badly.
// ⚠️ ENERGY IS BOTH kJ AND kcal, and both are mandatory. They are stored rather
// than derived from each other so what is printed is what the supplier declared.
export const NUTRIENTS = Object.freeze([
  { key: 'kj', label: 'Energy', unit: 'kJ' },
  { key: 'kcal', label: 'Energy', unit: 'kcal' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'saturates', label: 'of which saturates', unit: 'g' },
  { key: 'carbs', label: 'Carbohydrate', unit: 'g' },
  { key: 'sugars', label: 'of which sugars', unit: 'g' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'salt', label: 'Salt', unit: 'g' },
] as const);

export type Nutrient = (typeof NUTRIENTS)[number];
export type NutrientKey = Nutrient['key'];

export const NUTRIENT_KEYS: readonly NutrientKey[] = Object.freeze(NUTRIENTS.map(n => n.key));

// Per 100 g, `null` = not filled in. Every key is always present in what normalizeNutrition
// returns.
export type Nutrition = Record<NutrientKey, number | null>;

// Nothing here is capped at a "sensible" maximum on purpose beyond the absurd:
// pure fat is 900 kcal and 100 g per 100 g, and a flavouring can be almost pure
// salt. A limit tight enough to be useful would refuse real ingredients.
const MAX_PER_100G: Readonly<Partial<Record<NutrientKey, number>>> = Object.freeze({ kj: 4000, kcal: 1000 });

// ⚠️ null MEANS "NOT FILLED IN", AND 0 MEANS ZERO. Water really does have 0 kcal;
// treating that as missing would make water block every label it appears in, and
// treating missing as 0 would silently under-declare everything. Same distinction
// as the three states above, for the same reason.
function nutrientValue(raw: unknown, key: NutrientKey): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const max = MAX_PER_100G[key] ?? 100;
  return Math.min(n, max);
}

export function normalizeNutrition(raw: unknown): Nutrition {
  // Filled key by key below, so every key of Nutrition exists by the time it is returned.
  const out = {} as Nutrition;
  for (const key of NUTRIENT_KEYS) {
    out[key] = raw && typeof raw === 'object' ? nutrientValue((raw as Record<string, unknown>)[key], key) : null;
  }
  return out;
}

// Every one of the seven present. A partial nutrition table cannot be printed —
// the declaration is defined as a whole — so there is no "mostly filled in".
export function hasFullNutrition(ingredient: unknown): boolean {
  const n = normalizeNutrition(ingredient && (ingredient as IngredientAllergenFields).nutrition);
  return NUTRIENT_KEYS.every(key => n[key] !== null);
}

// Which of the seven are still missing, so a screen can name them instead of
// saying "incomplete" and leaving somebody to hunt.
export function missingNutrients(ingredient: unknown): NutrientKey[] {
  const n = normalizeNutrition(ingredient && (ingredient as IngredientAllergenFields).nutrition);
  return NUTRIENT_KEYS.filter(key => n[key] === null);
}

// ── What the ingredient document carries ─────────────────────────────────────

// The allergen part of `ingredients/{id}`, exactly as buildAllergenFields writes it.
export interface AllergenFields {
  allergens: AllergenCode[];
  mayContain: AllergenCode[];
  allergensCheckedAt: string;
  nutrition: Nutrition;
  packIngredients: string;
}

// What a form hands buildAllergenFields. Every field is optional and untrusted: whatever
// is missing becomes a blank (an empty list, '', null nutrients), never undefined.
export interface AllergenFieldsInput {
  allergens?: unknown;
  mayContain?: unknown;
  checkedAt?: unknown;
  nutrition?: unknown;
  packIngredients?: unknown;
}

// ⚠️ THE FIELDS ARE BUILT HERE AND NOWHERE ELSE. `ingredients` is validated by a
// CLOSED key list in firestore.rules, so a field this function invents that the
// rules do not know about makes every save of that ingredient fail — and a field
// the rules allow that this function forgets is dropped in silence on the next
// save. One place, so there is one thing to keep in step.
export function buildAllergenFields(
  { allergens, mayContain, checkedAt: stamp, nutrition, packIngredients }: AllergenFieldsInput,
): AllergenFields {
  const clean = normalizeAllergens(allergens);
  const may = normalizeMayContain(mayContain);
  return {
    allergens: clean,
    // "May contain" for something the ingredient already CONTAINS is noise on a
    // label: it is already declared, more strongly, one line above.
    mayContain: may.filter(code => !clean.includes(code)),
    allergensCheckedAt: String(stamp == null ? '' : stamp).trim().slice(0, 40),
    nutrition: normalizeNutrition(nutrition),
    // The ingredient list as printed on the supplier's pack. The app reads it to
    // PROPOSE allergens; it is stored because it is the audit trail — why
    // something was declared — and because a better dictionary can then re-check
    // every ingredient later without anybody re-typing a pack.
    //
    // ⚠️ CAPPED AT THE SAME 4000 THE RULES CAP IT AT. A longer string is refused by
    // the rules, and the rules refuse the WHOLE document — so a paste from a PDF
    // would make the ingredient unsaveable with nothing on screen explaining why.
    packIngredients: String(packIngredients == null ? '' : packIngredients).slice(0, 4000),
  };
}
