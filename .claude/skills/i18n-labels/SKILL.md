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
| Code | `t('key', vars)` from `js/i18n.js`; `data-i18n` in HTML | `const lang = outputLanguage(location)` inside the function, then `allergenName` / `allergenGroupName` / `nutrientName` / `labelWord(…, lang)` |
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
4. **Counts**: the entry is an object — `'join.expires.days': { one: '{n} day left', other:
   '{n} days left' }` — picked by `Intl.PluralRules`, in BOTH languages. ⚠️ The number
   MUST be passed as `n`: `t(key, { n })`. `{ count }` silently picks the plural AND leaves a
   literal `{n}` on screen.
   Never `n === 1 ? … : …` at the call site.
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
READS for a unit comes from a function, never the stored word: recipe-row units from
`unitText()` (inside `js/catalogue/` only — no other feature may import it), price units
from `priceUnitLabel()` (`js/price-model.js`, shared). A supplier's name on screen always
goes through `supplierLabel()`.

## Food words and labels — the part that can hurt somebody

- A file that shows food words is a **LABEL FILE**: declare it in
  `tests/i18n-label-separation.test.mjs`. It may never touch `currentLanguage`,
  `setLanguage`, `languageFromTag` or `interfaceLanguage` — anywhere in the file.
- **Read the output language INSIDE the drawing function**, in the shape the test pins: an
  indented `const lang = outputLanguage(…)` line inside the function (e.g.
  `outputLanguage(currentSession().location)`), then `allergenName(code, lang)` /
  `labelWord(key, lang)` with `lang` as the last argument. At module load no venue is open, the language is `null` for the life of the
  page, and every name falls back to English in silence.
- **Pin that the call EXISTS**, not only that it is shaped right — a deleted call satisfies
  every «asked in the right language» check.
- **Money on screen**: always `formatMoney` / `formatRate` (`js/price-model.js`) — they
  read the symbol AND the layout («£1234.56» / «1.234,56 €», `js/currency.js` moneyText)
  inside the drawing function, both from the venue's country. `currentCurrency()` alone is
  only for a field caption («Prezzo al kg (€)»): beside a number it would skip the layout. **Numbers and dates on screen**: `Intl` with `localeTag()` — which follows the
  INTERFACE language, so it is for screens, not for label text. Never format by hand.
  ⚠️ **The one exception: a number on the SAME LINE as a price** (a quantity «2,5 × 6,50 €»,
  the stocktake kilos beside a price) takes the money's layout with `localNumber()`
  (`js/currency.js`), so one line never mixes «2.5» and «6,50 €». **Price boxes** are text
  fields (`inputmode="decimal"`): shown with `localNumber(v, false)`, read with
  `typedDecimal()` («12,5» = «12.5»), and refused on Save when the text is not a number above
  zero (`unreadablePrice`, never saved as «no price»). The weight box is NOT localised: the
  weight is stored as TEXT, so showing «2,5» would rewrite every stored weight on save.
- The allergen dictionary: a phrase that overrides a stem AND names an allergen needs its
  own tier (`burro di arachidi` must still say peanuts). The specific cereal/nut is named
  (`gluten-wheat`), and `mayContain` is never merged into `allergens`.

## Exceptions, on purpose

- The **sign-in screen** says «Mise», not a venue's name, and its language follows the PHONE
  (`languageFromTag(navigator.language)` in `js/auth-gate.js`) — nobody is inside yet. Its
  text still goes through `t()`. (The comment at the top of `js/i18n.js` saying it stays in
  English is out of date.)
- Screens ABOVE a venue (picker, invitation) follow the phone too.
- `order.html` is the CLIENT's page: it names the venue, never «Mise».
- ⚠️ `install-guide.html` names buttons in the phone's OWN menus — never fold it into a
  language fix.
- Text already written INTO stored data (old log entries) stays as written.

## Before calling it done

`npm test` (all i18n suites) → `ui-check` in EN and IT → look at the screen in Italian on an
Italian venue (seed: `miano@club.test`) AND in English on a UK venue.
