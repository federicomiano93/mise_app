---
name: i18n-labels
description: The language rules of Mise — how to add or change any text a person reads, in English AND Italian, and why food words follow the venue's COUNTRY while interface words follow its LANGUAGE. Use whenever a change adds or edits a button, title, message, placeholder, dialog, notification or any on-screen text; touches js/i18n.js, js/i18n-dom.js or js/market.js; shows an allergen, a nutrient, a unit, a price, a date or a number; or touches anything printed on a label.
---

# Language rules — Mise

Two DIFFERENT languages, kept in different files on purpose:

| | Interface language | Output language |
|---|---|---|
| What | the words a person TAPS and READS on screen | the words that name FOOD: allergens, nutrients, label text |
| Decided by | the venue's `language` (before a venue is open: the phone) | the venue's **country** (`js/market.js`) — **the law** (Reg. 1169/2011: the language where the food is SOLD) |
| Code | `t('key', vars)` from `js/i18n.js`; `data-i18n` in HTML | `allergenName` / `allergenGroupName` / `nutrientName` / `labelWord(key, outputLanguage(location))` |
| Example | Federico's UK venues can run the interface in Italian… | …and their labels must still print in English |

**The rule: a word that names a FOOD asks the COUNTRY; a word that tells somebody what to
tap asks `t()`.** This applies to every screen, not only labels — an allergen shown on the
ingredient card is a food word too.

## Adding interface text — checklist

1. **Key**: flat, dotted by where it lives — `orders.supplier.delete`, never `deleteBtn`.
2. **Both dictionaries** in `js/i18n.js`: `en` AND `it` (the `it` block starts around line
   2670). `tests/i18n-keys-exist.test.mjs` fails on a key asked for but missing.
3. **One phrase with holes, never glued halves**: `'Delete {name}?'` + `{ name }` — Italian
   orders words differently. Never `'Delete ' + name`.
4. **Counts**: `.one` / `.other` entries, chosen by `Intl.PluralRules` — never
   `n === 1 ? … : …` at the call site, and counted in BOTH languages.
5. **Case is the translator's**: a word inside a sentence gets its own entry
   (`role.owner.inSentence`); never `.toLowerCase()` a translated word.
6. **Static HTML**: `data-i18n="key"` for the text, plus `data-i18n-attr="aria-label"` (or
   `alt`, `placeholder`…) to translate an attribute instead — applied by `js/i18n-dom.js`.
   An icon-only button still needs a translated `aria-label` (P18).
7. **A JS file that calls `t` must import it** (`tests/i18n-imports.test.mjs`) — a missing
   import once threw inside an un-awaited async function and nobody saw a thing.
8. **No English literals in code** — `tests/no-hardcoded-english.test.mjs` and
   `tests/nothing-stays-english.test.mjs` catch the known shapes, not every shape: open the
   screen in Italian (`ui-check` runs EN and IT).
9. **Italian house style** (copy it from neighbouring entries): informal *tu*; dialog titles
   as questions — «Vuoi eliminare…?», «Scartare le modifiche?»; «tocca» for tap; «Salvato ✓»;
   typographic ’ and “ ”; «Annulla» for Cancel. **English**: plain, sentence case.

## Words that are DATA — never translate

`DATA_WORDS` in `js/i18n.js`: weekday document ids (`pastries/Monday`), section names,
role values (`'owner'`, `'manager'`, `'staff'`), units stored on documents (`kg`, `l`,
`pcs`, `tsp`, `tbsp`, `pinch`, `to taste`), country and language codes. They are stored and
compared by the rules — translating one breaks data, and a test names it. What a person
READS for a unit comes from `unitText()` (`js/catalogue/catalogue-model.js`); the stored
value stays English. A supplier's name on screen always goes through `supplierLabel()`.

## Food words and labels — the part that can hurt somebody

- A file that shows food words is a **LABEL FILE**: declare it in
  `tests/i18n-label-separation.test.mjs`. It may NEVER import `currentLanguage` /
  `setLanguage` / `t` for those words.
- **Read the output language INSIDE the drawing function**, never at module load — at load
  no venue is open, the language is `null` for the life of the page, and every name falls
  back to English in silence.
- **Pin that the call EXISTS**, not only that it is shaped right — a deleted call satisfies
  every «asked in the right language» check.
- Currency follows the country too (`currencyOf(location)`); numbers and dates are formatted
  with `localeTag(lang)` through `Intl`, never by hand.
- The allergen dictionary: a phrase that overrides a stem AND names an allergen needs its
  own tier (`burro di arachidi` must still say peanuts). The specific cereal/nut is named
  (`gluten-wheat`), and `mayContain` is never merged into `allergens`.

## Exceptions, on purpose

- The **sign-in screen** stays in English and says «Mise»: nobody is inside, no venue.
- Screens ABOVE a venue (picker, invitation) follow the phone.
- `order.html` is the CLIENT's page: it names the venue, never «Mise».
- ⚠️ `install-guide.html` names buttons in the phone's OWN menus — never fold it into a
  language fix.
- Text already written INTO stored data (old log entries) stays as written.

## Before calling it done

`npm test` (all i18n suites) → `ui-check` in EN and IT → look at the screen in Italian on an
Italian venue (seed: `miano@club.test`) AND in English on a UK venue.
