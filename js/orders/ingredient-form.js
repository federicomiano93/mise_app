// ingredient-form.js — one supplier product's whole record.
//
// Name, supplier, brand, pack weight, category and order unit; then what it COSTS
// (for whoever may see money); then what is IN it — the fourteen allergens, the
// pack's own ingredient list, and the nutrition panel.
//
// It lived inside management.js, reached through a gear labelled «Settings». It is
// not a setting: it is the record this bakery keeps about something it buys, and it
// is the screen the whole allergen job happens on. It moved out with the rest of the
// records (js/orders/registry.js) and is imported by that screen alone.
//
// ⚠️ NOTHING HERE IS HIDDEN BY ROLE EXCEPT THE PRICE, and that one is not really
// hidden either — see mayPrice below. The allergen block is drawn for everybody,
// deliberately: it is the one part of this app that can send somebody to hospital,
// and the person who gets asked «are there nuts in this?» is whoever is at the
// counter (the v1.62.0 lesson — a gate on a container gates everything put inside).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { canManageHere } from './firebase-orders.js';
import { NO_SUPPLIER_ID } from './no-supplier.js';
import { field, formActions, reportFailure, shortDate } from './mgmt-ui.js';
import {
  PRICE_UNITS, priceUnitLabel,
  pricePatch, priceChanged, priceRecord, pricePerKg,
  formatPricePerUnit, formatRate, costReasonText,
} from '../price-model.js';
// ⚠️ THE CURRENCY FOLLOWS THE VENUE'S COUNTRY, and it is read inside priceBlock()
// rather than up here — the venue is not open when this module is evaluated. See
// js/currency.js and currencyOf() in js/market.js.
import { currentCurrency } from '../currency.js';
// ⚠️ THE APP'S ONE «?», not a second one. This overlay is built long after the page
// has loaded, so it asks the module to fill the hosts it has just created.
// ⚠️ It pulls in js/confirm-dialog.js, which is the identical twin of this folder's
// own copy (both pinned byte-for-byte by tests/copie-allineate.test.mjs). Two copies
// of the same dialog on one page is the price of the rule that forbids a feature
// folder from importing another's — and it is a smaller price than a second «?».
import { mountHelpButtons } from '../help-button.js';
// ⚠️ From js/ ROOT, not from a feature folder — see the header of that file. What
// an ingredient declares is typed HERE, in Orders, and read by the catalogue and
// by the labels screen, so the judgement lives in one place for all three.
import {
  ALLERGENS, ALLERGEN_GROUPS, NUTRIENTS,
  allergenState, checkedAt, isDeclared,
  missingNutrients, buildAllergenFields,
} from '../allergen-model.js';
// ⚠️⚠️ THE FOOD WORDS ON THIS FORM FOLLOW THE VENUE'S COUNTRY, NEVER THE SCREEN, and
// that is Federico's decision of 23 Aug 2026: «gli allergeni ed etichette devono essere
// nella lingua dello stato in cui opera l'app».
//
// The reason is sharper than consistency. This form is where somebody DECIDES what a
// label will say, so the words here have to be the words that will be printed — a
// person cannot check their own work against a label that renames everything. It is
// also the law that decides them (Retained Reg. 1169/2011 Art. 15), and a law does not
// consult a preference. So `allergenName` / `allergenGroupName` / `nutrientName`, asked
// in the OUTPUT language, replace the fixed English `allergenLabel` used until now.
//
// ⚠️ THE CONTROLS AROUND THEM STAY INTERFACE TEXT — «ha», «tracce», «Non ancora
// verificato». They name no food: they tell the person what to tap, and an employee who
// reads no English gains nothing from English instructions. The same line js/market.js
// already drew for INGREDIENT_NAMES_NOTE.
//
// ⚠️ AND THIS FILE IS THEREFORE A LABEL FILE. tests/i18n-label-separation.test.mjs says
// so by walking the app rather than trusting a list: anything asking market.js for a
// label word is named there and may never touch currentLanguage/setLanguage.
import { outputLanguage, allergenName, allergenGroupName, nutrientName } from '../market.js';
import { currentSession } from '../firebase.js';
// Reading the pack's own ingredient list. PURE, and also from js/ ROOT: the
// vocabulary it walks is the same one a label is built from, so a second copy is
// the copy that quietly disagrees about what is in somebody's food.
import { readPackIngredients, reconcileTicks, tickKey } from '../allergen-match.js';
// Which of the two optional panels this venue uses. ⚠️ A VENUE-WIDE DISPLAY SWITCH,
// never a role and never a data switch — see the note on allergenBlock below.
import { ingredientPanels } from './firebase-features.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';

const CAMERA_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

// ── The price block ───────────────────────────────────────────────────────────
// One number and a unit. The rate is typed rather than derived from a pack
// price ÷ pack size: that second box asked again for the pack weight the
// ingredient already carries in its own Weight field a few lines above
// ("2.27kg"), and two boxes holding one fact drift apart.
//
// Returns { node, read() } so the form below can stay readable.
function priceBlock(item, actions) {
  // What the price box is called, per purchase form. Spelled out per unit rather
  // than assembled from the unit code, because "Price per pcs" is not English and
  // the label is the only place the ex-VAT rule can be stated.
  //
  // ⚠️ BUILT WHEN THE FORM IS DRAWN, NEVER AT MODULE LOAD. A module is evaluated
  // once, at first import — before a venue is open — so a t() in a module constant
  // freezes in the app's starting language whatever the venue says. That defect was
  // in fourteen places on 21 Aug (v1.57.0); this is the shape that avoids it.
  const RATE_LABEL = Object.freeze({
    kg: t('orders.pricePerKg', { currency: currentCurrency() }),
    l: t('orders.pricePerLitre', { currency: currentCurrency() }),
    pcs: t('orders.pricePerPiece', { currency: currentCurrency() }),
  });

  // The worked example, which now lives INSIDE the box as its placeholder.
  //
  // Federico, 23 Aug 2026: «togli la scritta… fallo visivamente coerente». It used to
  // be three lines of prose under the field, and with the two price boxes now side by
  // side there is no room for a sentence under either of them.
  //
  // ⚠️⚠️ IT SHRANK; IT DID NOT GO. It exists to pre-empt the ONE mistake this form
  // cannot detect — the invoice total typed where the rate belongs. 180 and 7.20 are
  // both perfectly valid numbers, so nothing can reject the wrong one; it simply makes
  // every recipe using that ingredient cost twenty-five times too much, on a screen
  // whose answer is a percentage nobody can check by eye. So the shortest form that
  // still says it — the unit, in brackets — goes where the number is typed.
  //
  // ⚠️ AND IT CARRIES NO CURRENCY. The old wording spelled out «a 25 kg sack at £180»,
  // which was the last hardcoded pound sign in the dictionary and printed sterling on
  // an Italian bakery. An example needs the UNIT to make its point, never the money.
  const RATE_HINT = Object.freeze({
    kg: t('orders.eg.ratePerKg'),
    l: t('orders.eg.ratePerLitre'),
    pcs: t('orders.eg.ratePerPiece'),
  });

  const unitSelect = el('select', { class: 'mgmt-input' });
  unitSelect.appendChild(el('option', { value: '', text: t('orders.noPrice2') }));
  PRICE_UNITS.forEach(u => {
    const opt = el('option', { value: u, text: priceUnitLabel(u) });
    if (item?.priceUnit === u) opt.selected = true;
    unitSelect.appendChild(opt);
  });

  // step="any" on both of them. A step of 0.01 makes the browser REFUSE 0.0035
  // as invalid — silently, by leaving the box empty on submit — and that is
  // exactly the number a vanilla pod weighs AND the number a gelatine leaf
  // costs, so it is the wrong step for the rate as well as for the weight.
  const money = (value, placeholder) => el('input', {
    type: 'number', class: 'mgmt-input', min: '0', step: 'any',
    inputmode: 'decimal', value: value ?? '', placeholder,
  });
  // ⚠️ THE NUMBER KEEPS ITS DECIMAL POINT IN BOTH LANGUAGES. Only the words around it
  // are translated: the box is <input type="number">, which does not accept a comma,
  // so an example written «7,20» would be an instruction to type something the field
  // then refuses.
  //
  // ⚠️ The placeholder is EMPTY here and filled by refresh() below, because it now
  // depends on the purchase unit — «(un chilo)» is wrong the moment somebody picks
  // pieces, and a stale example is worse than none on the one field that cannot be
  // checked for what it is a price OF.
  const rate = money(item?.pricePerUnit, '');
  const pieceWeight = money(item?.unitWeightKg, t('orders.eg.pieceWeight'));

  const rateLabel = el('span', { class: 'mgmt-field-label' });
  // Two lines, not one. A per-piece price can be perfectly complete as a PRICE
  // and still be unusable in a recipe written in grams, and a summary that only
  // showed "£2.10 / each" would look finished while the ingredient silently
  // stayed out of every cost. The numbers go on top, what is still missing
  // underneath.
  const summaryMain = el('span', { class: 'mgmt-price-main' });
  const summaryNote = el('span', { class: 'mgmt-price-note' });
  const summary = el('p', { class: 'mgmt-price-summary' }, [summaryMain, summaryNote]);

  const pieceField = el('label', { class: 'mgmt-field' }, [
    el('span', { class: 'mgmt-field-label', text: t('orders.weightOfOnePiece') }),
    pieceWeight,
    el('p', { class: 'notif-note', text: t('orders.neededOnlyToUse') }),
  ]);

  function read() {
    return {
      priceUnit: unitSelect.value || null,
      pricePerUnit: rate.value,
      unitWeightKg: pieceWeight.value,
    };
  }

  // The live line under the boxes. It answers the only question that matters —
  // what does a kilo of this cost — while the boxes are still being typed into,
  // so a misplaced decimal point is visible before Save rather than after.
  function refresh() {
    const unit = unitSelect.value;
    pieceField.hidden = unit !== 'pcs';
    rateLabel.textContent = RATE_LABEL[unit] || t('orders.priceGeneric', { currency: currentCurrency() });
    // ⚠️ The example follows the UNIT, and an unknown unit gets none. «(un chilo)»
    // left showing while somebody is pricing by the piece is worse than no example.
    rate.placeholder = RATE_HINT[unit] || '';

    const draft = pricePatch(read(), null);
    if (draft.pricePerUnit === null) {
      summaryMain.textContent = costReasonText(draft);
      summaryNote.textContent = '';
      summary.className = 'mgmt-price-summary muted';
      return;
    }
    const perKg = pricePerKg(draft);
    // For a per-piece price the price per KILO is the derived number, and it is
    // the one every recipe cost is built from — so it is spelled out rather than
    // left to be worked out from a piece weight.
    const parts = [formatPricePerUnit(draft)];
    if (unit === 'pcs' && perKg !== null) parts.push(`${formatRate(perKg)} / kg`);
    summaryMain.textContent = parts.filter(Boolean).join('  ·  ');
    // Empty whenever the ingredient IS costable, so the note only ever appears
    // when there is something left to do.
    summaryNote.textContent = costReasonText(draft);
    summary.className = 'mgmt-price-summary';
  }

  [unitSelect, rate, pieceWeight].forEach(input => {
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
  });
  refresh();

  // ⚠️ THE TWO PRICE BOXES SHARE A ROW. Federico, 23 Aug 2026: «come si acquista e
  // Prezzo al kg si potrebbero mettere uno accanto all'altro in modo tale che occupa
  // meno spazio». They belong together — the unit is what the rate is a rate OF — and
  // as two stacked full-width fields they were half the height of the price section.
  //
  // ⚠️ THE GRID IS NOT A NEW VALUE. `repeat(2, minmax(0, 1fr))` with an 8px gap is
  // .alg-nutrition, three sections further down THIS SAME FORM. The v1.62.0 rule:
  // finish the copy rather than design a second answer.
  const pricePair = el('div', { class: 'mgmt-pair' }, [
    field(t('orders.howItIsBought'), unitSelect),
    el('label', { class: 'mgmt-field' }, [rateLabel, rate]),
  ]);

  const node = el('div', {}, [
    // ⚠️ «Peso di un pezzo» STAYS FULL WIDTH. It appears only when the unit is
    // `pcs`, and a column that comes and goes would make the row above it jump.
    pricePair,
    // Said ONCE, under the pair, instead of four times inside four labels that no
    // longer have room for it. ⚠️ It may not be dropped: entering the gross figure
    // inflates every recipe cost by the VAT rate and nothing on any screen looks wrong.
    el('p', { class: 'notif-note', text: t('orders.exVatNote') }),
    pieceField,
    summary,
    item ? priceHistoryBlock(item, actions) : null,
  ]);

  return { node, read };
}

// The append-only record of what this ingredient has cost. Loaded only when
// asked for: it is a separate read per ingredient, and nobody opening the form to
// fix a spelling needs it (P14).
function priceHistoryBlock(item, actions) {
  const list = el('div', { class: 'mgmt-price-history' });
  const button = el('button', { type: 'button', class: 'mgmt-link', onClick: async () => {
    button.disabled = true;
    button.textContent = t('orders.loading');
    try {
      const entries = await actions.priceHistory(item.id);
      list.replaceChildren();
      button.remove();
      if (!entries.length) {
        list.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noPriceRecordedYet') }));
        return;
      }
      entries.forEach(entry => {
        list.appendChild(el('div', { class: 'mgmt-price-row' }, [
          el('span', { class: 'mgmt-price-rate', text: formatPricePerUnit(entry) }),
          el('span', { class: 'mgmt-price-when', text: shortDate(entry.recordedAt) }),
        ]));
      });
    } catch (err) {
      button.disabled = false;
      button.textContent = t('orders.showThem');
      await reportFailure('load', item.name, err);
    }
  } }, t('orders.showThem'));

  // ⚠️ IT IS A FIELD NOW, NOT A BARE LINK. Federico, 23 Aug 2026: «metti storico prezzi
  // con lo stesso font di come si acquista e Prezzo al kg, fallo visivamente coerente».
  // It was the only thing in the price section with no label of its own, so it read as
  // a stray link rather than as part of the record. `.mgmt-field-label` is the same
  // 12px the two labels above it use — the class, not a copy of its values.
  //
  // ⚠️ IT STILL LOADS ONLY WHEN TAPPED. Naming it does not fetch it: this is a separate
  // database read per ingredient, and somebody opening the form to fix a spelling must
  // not pay for it (P14).
  // ⚠️ `.mgmt-history` EXISTS TO PULL THE BUTTON LEFT, and it is defined in orders.css.
  // A <button> stretched by the column centres its own text, so «Mostrali» sat in the
  // middle under a left-aligned label — the one thing in the section not lining up with
  // everything else, in the very release asked to make it «visivamente coerente».
  return el('div', { class: 'mgmt-field mgmt-history' }, [
    el('span', { class: 'mgmt-field-label', text: t('orders.priceHistory') }),
    button,
    list,
  ]);
}

// ── Allergens and nutrition ───────────────────────────────────────────────────
//
// ⚠️ THE TICK THAT SAYS "I HAVE CHECKED THIS" IS A DELIBERATE ACT, NOT A SIDE
// EFFECT OF SAVING. If opening this form and pressing Save were enough to stamp
// an ingredient as verified, then correcting a spelling would declare it
// allergen-free — and that declaration is the one thing here that can put
// somebody in hospital. It has to be somebody saying so, on purpose.
//
// ⚠️⚠️ EVERYTHING IS BUILT EVEN WHEN IT IS NOT SHOWN, AND THAT IS THE PROPERTY THAT
// MAKES THE SWITCHES SAFE. `panels` decides what goes into the DOM; the tick boxes,
// the nutrition inputs and the pack text are created from the stored ingredient
// either way, so read() hands back exactly what was there and an ordinary rename
// saves it untouched. Skipping the build would make a display switch into a data
// switch: opening a product on a venue that has allergens turned off and correcting
// its brand would silently erase every allergen it declares.
// ⚠️ `actions` IS A PARAMETER, NOT A CLOSURE. This function is declared at module
// level, outside buildIngredientForm, so it sees nothing the form destructured — the
// camera button below referred to `actions` and threw ReferenceError the instant a
// product was opened, with 1843 tests green. Only opening the screen showed it.
function allergenBlock(item, panels, actions = {}) {
  const boxes = new Map();   // code -> { contains, may }

  // ⚠️ READ WHEN THE FORM IS DRAWN, NEVER AT MODULE LOAD. A module is evaluated once,
  // at first import — before a venue is open — so a country read up there would be
  // `null` for ever and every name would fall back to English. That defect was in
  // fourteen places on 21 Aug (v1.57.0), and here it would silently un-translate the
  // one screen that must not be guessed at.
  //
  // ⚠️ null IS A REAL ANSWER AND IT IS THE SAFE ONE. An unknown country gives no
  // language, and allergenName() then returns the canonical English — never a blank.
  // An empty name in a list of allergens is the most dangerous thing this form could
  // draw, because the row still LOOKS complete.
  const lang = outputLanguage(currentSession().location);

  function tickRow(code) {
    const contains = el('input', { type: 'checkbox' });
    const may = el('input', { type: 'checkbox' });
    contains.checked = (item?.allergens || []).includes(code);
    may.checked = (item?.mayContain || []).includes(code);
    boxes.set(code, { contains, may });
    // ⚠️ THE NAME IS THE LABEL'S WORD; THE TWO COLUMNS AND THEIR TOOLTIPS ARE NOT.
    // «has» and «traces» were hardcoded English until now, on a screen that has spoken
    // Italian since v1.57.0 — so this is an i18n fix as well as a country one.
    return el('div', { class: 'alg-row' }, [
      el('span', { class: 'alg-name', text: allergenName(code, lang) }),
      el('label', {
        class: 'day-check alg-tick',
        title: t('orders.allergen.containsTip', { name: allergenName(code, lang) }),
      }, [contains, el('span', { text: t('orders.allergen.has') })]),
      el('label', {
        class: 'day-check alg-tick alg-tick--may',
        title: t('orders.allergen.tracesTip', { name: allergenName(code, lang) }),
      }, [may, el('span', { text: t('orders.allergen.traces') })]),
    ]);
  }

  // The two groups the law makes us name individually get their own heading, so
  // 26 boxes read as a structured list rather than a wall of ticks.
  //
  // ⚠️ THE HEADINGS ARE FOOD WORDS TOO, AND THEY WERE THE VISIBLE MISMATCH. «Cereals
  // containing gluten» came from the interface dictionary and «Nuts» was written in
  // English by hand, so an Italian screen showed «CEREALI CONTENENTI GLUTINE» over rows
  // reading «Wheat», «Rye». Both now come from the country, together.
  const sections = [];
  for (const group of ALLERGEN_GROUPS) {
    const codes = ALLERGENS.filter(a => a.group === group).map(a => a.code);
    if (codes.length > 1) {
      sections.push(el('p', { class: 'alg-group', text: allergenGroupName(group, lang) || group }));
      codes.forEach(code => sections.push(tickRow(code)));
    }
  }
  const singles = ALLERGENS.filter(a => ALLERGENS.filter(x => x.group === a.group).length === 1);
  sections.push(el('p', { class: 'alg-group', text: t('orders.theRest') }));
  singles.forEach(a => sections.push(tickRow(a.code)));

  const checked = el('input', { type: 'checkbox' });
  checked.checked = isDeclared(item);
  const status = el('p', { class: 'alg-status' });

  const nutrients = new Map();
  const nutritionGrid = el('div', { class: 'alg-nutrition' });
  for (const n of NUTRIENTS) {
    const input = el('input', {
      type: 'number', inputmode: 'decimal', step: 'any', min: '0', class: 'mgmt-input alg-num',
      value: item?.nutrition && item.nutrition[n.key] != null ? String(item.nutrition[n.key]) : '',
    });
    nutrients.set(n.key, input);
    // ⚠️ THE NUTRIENT NAMES ARE LABEL WORDS AS MUCH AS THE ALLERGENS ARE: «Energia»,
    // «di cui acidi grassi saturi» are printed on the declaration, so they follow the
    // country. The UNIT does not — kJ, g and kcal are the same symbols in both.
    nutritionGrid.appendChild(el('label', { class: 'alg-nut-field' }, [
      el('span', { class: 'alg-nut-label', text: `${nutrientName(n, lang)} (${n.unit})` }),
      input,
    ]));
  }

  // ── The pack's own ingredient list, and what the app makes of it ────────────
  //
  // ⚠️⚠️ IT PROPOSES, IT NEVER DECLARES. Reading the pack pre-ticks the boxes and
  // nothing else: `allergensCheckedAt` is untouched, so until somebody presses the
  // verification tick the ingredient still reads 'unknown' and still blocks every
  // label. A wrong suggestion costs a correction, never a false declaration — that is
  // what makes offering one safe at all, and it is unchanged by everything below.
  //
  // ⚠️⚠️ IT RUNS BY ITSELF NOW. Federico, 23 Aug 2026: «quando compilo l'elenco degli
  // ingredienti in automatico gli allergeni se li contiene». The button is gone.
  //
  // ⚠️⚠️ AND THAT IS WHY THE TICKS HAVE OWNERS. «Only ever tick, never untick» was the
  // right rule for a button you pressed at the END. Re-reading on every keystroke, it
  // becomes a way to invent a declaration: «latte» ticks MILK, and correcting it to
  // «latte di mandorla» would leave the milk behind for ever. So the app may take back
  // ONLY what the app put there, and a box a person has moved is untouchable in both
  // directions. The judgement lives in reconcileTicks() — pure, and tested, because
  // nothing on this screen can show that it holds.
  const packBox = el('textarea', {
    class: 'mgmt-input alg-pack-text', rows: '4',
    placeholder: t('orders.pack.placeholder'),
    'aria-label': t('orders.pack.label'),
  });
  packBox.value = item?.packIngredients || '';
  const packResult = el('div', { class: 'alg-pack-result' });

  // Which ticks the app put there and may take back. ⚠️ IT STARTS EMPTY EVEN WHEN THE
  // INGREDIENT ARRIVES FULLY DECLARED — everything already stored belongs to whoever
  // stored it, so opening a saved product and typing can never lose a declaration.
  let appOwned = new Set();
  // Which ticks a person has moved, either way. Never proposed or withdrawn again.
  const humanTouched = new Set();
  // How many the app is currently proposing, so the folded header can say so.
  let proposedCount = 0;
  // ⚠️⚠️ SET THE MOMENT THE APP MOVES A BOX ON A RECORD SOMEBODY HAD ALREADY VERIFIED,
  // and it is the whole reason an automatic proposal cannot declare anything.
  //
  // The stamp is what makes ticks a DECLARATION. Without this, an ingredient verified
  // on 20 August whose pack text the app then reads keeps that date — so a box the app
  // ticked by itself is saved as «verified on 20 August», by a person who never saw it.
  // Proved against the emulator database before it was written: the saved document came
  // back `[gluten-wheat, milk]` with the seed's own stamp still on it.
  //
  // ⚠️ The screen ALREADY said «verificalo di nuovo». The code did not make it true, and
  // a warning the code does not enforce is the most dangerous kind on this screen.
  let stampVoided = false;

  // Move the boxes to whatever the pure model says they should be, and report how
  // many changed. Nothing here decides anything: reconcileTicks owns the rules.
  function applyTicks(proposal) {
    const current = { contains: [], may: [] };
    for (const [code, pair] of boxes) {
      if (pair.contains.checked) current.contains.push(code);
      if (pair.may.checked) current.may.push(code);
    }
    const next = reconcileTicks({ proposal, current, appOwned, humanTouched });
    appOwned = next.appOwned;
    const wantContains = new Set(next.contains);
    const wantMay = new Set(next.may);
    for (const [code, pair] of boxes) {
      pair.contains.checked = wantContains.has(code);
      pair.may.checked = wantMay.has(code);
    }
    // ⚠️⚠️ THE APP CHANGED THE DECLARATION, SO THE VERIFICATION IS NO LONGER ABOUT IT.
    // Both directions count: a tick the app ADDED was never checked by anybody, and a
    // tick it TOOK BACK means the stamp now covers a list that no longer exists. The
    // person confirms again — and when they do, read() stamps TODAY, not the old date.
    if ((next.added || next.removed) && checked.checked) {
      checked.checked = false;
      stampVoided = true;
    }
    proposedCount = appOwned.size;
    refresh();
    return next.added;
  }

  // ⚠️⚠️ `touchBoxes: false` IS FOR THE FIRST DRAW, AND IT IS A SAFETY RULE, NOT A
  // nicety. A saved ingredient can perfectly well hold pack text that says «latte» and
  // a milk box somebody deliberately UNTICKED — a supplier's correction, a reformulated
  // product. Re-running the matcher on open would silently put that tick back every
  // single time the record was looked at, and nothing on screen would say why. So
  // opening a product only ever SHOWS what the text says; the boxes move when the text
  // does, which is exactly what Federico asked for: «quando compilo l'elenco».
  function suggest({ touchBoxes = true } = {}) {
    packResult.replaceChildren();
    const text = packBox.value;
    const out = readPackIngredients(text);

    if (!out.hasText) {
      // ⚠️ AND THE APP'S OWN TICKS GO WITH THE TEXT. Clearing the box must clear what
      // the box put there, or emptying it would leave a declaration nobody can trace
      // to anything. A person's ticks stay, as always.
      if (touchBoxes) applyTicks({ allergens: [], mayContain: [] });
      return;   // an empty box needs no commentary: the header already says «da compilare»
    }

    if (touchBoxes) applyTicks(out);

    // ⚠️ RECOGNISING NOTHING IS AN ANSWER AND MUST LOOK LIKE ONE, so this one line
    // stays on the screen. Silence here would be read as «this pack contains nothing»,
    // which is the single worst thing this feature could say — and it is a statement
    // about THIS pack, not an explanation of the feature, so a «?» is the wrong place
    // for it. What DID go into the sheet is the running commentary that used to sit
    // beside it: «ticked 1 box», «already ticked», and the re-drawn copy of the text
    // with the recognised words marked. How many boxes moved is said once, outside
    // the fold, by `proposedNote` — where it is read even with this section shut.
    if (!out.recognisedAnything) {
      packResult.appendChild(el('p', {
        class: 'alg-pack-note', text: t('orders.pack.recognisedNothing'),
      }));
    }

    // ⚠️ WHAT IT CANNOT ANSWER IS ASKED, NEVER GUESSED. An Italian pack very often
    // prints only «emulsionante: lecitine» — soya, sunflower or egg, and the pack
    // does not say which. Choosing the commonest is declaring something nobody
    // was told.
    for (const q of out.questions) {
      const word = text.slice(q.from, q.to);
      const names = q.could.map(code => allergenName(code, lang)).filter(Boolean).join(' / ');
      // ⚠️ A CATEGORY IS ITS OWN QUESTION, and it is the one the pack itself
      // raises: «può contenere tracce di FRUTTA A GUSCIO» is a real warning that
      // this app has no box for, because the law wants the specific nut. Left in
      // the vague bucket it would read as «might hide something», which
      // understates a warning the supplier actually printed.
      let line;
      if (q.kind === 'category') line = t('orders.pack.questionCategory', { word });
      else if (names) line = t('orders.pack.questionWhich', { word, options: names });
      else line = t('orders.pack.questionVague', { word });
      packResult.appendChild(el('p', { class: 'alg-pack-question', text: line }));
    }
    // ⚠️ «Questo spunta solo le caselle, niente è dichiarato finché…» USED TO CLOSE
    // THIS BLOCK and is now the last line of the «?» sheet. It is true of every
    // product on every day, which is the test for what may be hidden; the questions
    // above it are true of this pack alone, which is why they may not be.
  }

  // ⚠️ THE BUTTON IS GONE. «Leggilo e spunta le caselle» was the whole interaction;
  // now typing IS the interaction, and `orders.pack.suggest` is retired with a test
  // forbidding its return — a button that still existed would leave people believing
  // nothing happens until they press it.
  //
  // ⚠️ RUN ON A PAUSE, NOT ON A KEYSTROKE. The matcher walks the whole vocabulary and
  // the evidence panel redraws the pasted text; doing that per character would make
  // the box stutter under somebody's thumb. 450ms is long enough to be a pause in
  // typing and short enough to feel immediate after a paste.
  //
  // ⚠️ AND IMMEDIATELY ON `change`, which is what a paste and leaving the box both
  // raise — a person who types and taps straight to the ticks must not race the timer.
  let pending = null;
  const scheduleSuggest = () => {
    clearTimeout(pending);
    pending = setTimeout(suggest, 450);
  };
  packBox.addEventListener('input', scheduleSuggest);
  packBox.addEventListener('change', () => { clearTimeout(pending); suggest(); });

  // ── Photograph the packet instead of typing it ──────────────────────────────
  //
  // Federico, 24 Aug 2026: «voglio la possibilità di fotografare gli ingredienti del
  // prodotto e l'app me li trascrive in automatico». 67 products, and the list on the
  // back of a packet is the longest thing anybody has to type in this app.
  //
  // ⚠️ DRAWN ONLY WHEN THE SWITCH IS ON, and `packPhotoOn` is a FUNCTION, not a value:
  // the flag can be thrown on another phone, or on the settings screen behind this one,
  // and a value read at build time would be stale for the life of the form.
  //
  // ⚠️⚠️ IT FILLS THE BOX AND NOTHING ELSE. Whatever comes back goes through the same
  // suggest() a typed character does, so the ticks it moves are the ticks typing would
  // have moved, `reconcileTicks` still refuses to touch a box a person has set, and
  // NOTHING here writes `allergensCheckedAt`. A misread costs a correction.
  const photoBtn = el('button', {
    type: 'button', class: 'btn-secondary alg-pack-photo', icon: CAMERA_ICON,
  }, [el('span', { text: t('orders.pack.photo.fill') })]);
  photoBtn.hidden = typeof actions.packPhotoOn !== 'function' || !actions.packPhotoOn();
  photoBtn.addEventListener('click', async () => {
    if (photoBtn.disabled) return;
    photoBtn.disabled = true;
    try {
      const answer = await actions.capturePackPhoto();
      // Backed out. Nothing was read and nothing is said — the box is as it was.
      if (!answer || !answer.text) return;

      if (packBox.value.trim()) {
        // ⚠️ REPLACE OR KEEP, AND DELIBERATELY NO «ADD TO THE END». Two ingredient
        // lists run together are ONE product's list as far as the matcher is
        // concerned, and it would then propose the allergens of both — on a record
        // that names one product. Both answers offered here are safe: nothing is
        // saved either way, and both are visible before anybody presses Save.
        const ok = await confirmDialog({
          title: t('orders.pack.photo.replaceTitle'),
          message: t('orders.pack.photo.replaceBody'),
          okLabel: t('orders.pack.photo.replaceOk'),
          cancelLabel: t('orders.pack.photo.keepMine'),
        });
        if (!ok) return;
      }

      packBox.value = answer.text;
      // ⚠️ suggest() DIRECTLY, and the pending timer cleared first: a synthetic input
      // event would only start the 450ms debounce again, and the boxes would move a
      // moment after the person had already started reading them.
      clearTimeout(pending);
      suggest();

      // ⚠️ SAID NOW, NOT AT SAVE TIME. buildAllergenFields truncates at 4000 in
      // silence, which is the wrong moment to discover that the end of a long list
      // is missing.
      if (answer.notes && answer.notes.truncated) {
        await alertDialog(t('orders.pack.photo.truncated'));
      }
    } finally {
      photoBtn.disabled = false;
    }
  });

  function read() {
    const contains = [];
    const may = [];
    for (const [code, pair] of boxes) {
      if (pair.contains.checked) contains.push(code);
      if (pair.may.checked) may.push(code);
    }
    const nutrition = {};
    for (const [key, input] of nutrients) nutrition[key] = input.value === '' ? null : input.value;
    // ⚠️ The stamp is KEPT when it exists, so re-saving does not silently move
    // the verification date and make a two-year-old check look like today's.
    //
    // ⚠️⚠️ UNLESS THE APP MOVED A BOX SINCE (`stampVoided`). Then the old date belongs
    // to a different list of allergens, and re-using it would date a brand-new
    // declaration to before it existed. A fresh confirmation is stamped TODAY.
    const previous = stampVoided ? null : checkedAt(item);
    const stamp = checked.checked ? (previous || new Date().toISOString()) : '';
    return buildAllergenFields({
      allergens: contains, mayContain: may, checkedAt: stamp, nutrition,
      packIngredients: packBox.value,
    });
  }

  // The word on each folded header. Set by refresh() below; empty until then.
  const algHeadState = el('span', { class: 'alg-head-state' });
  const nutHeadState = el('span', { class: 'alg-head-state' });
  const packHeadState = el('span', { class: 'alg-head-state' });
  // ⚠️ THE LINE THAT TELLS SOMEBODY THE APP HAS TOUCHED THEIR TICK BOXES. It sits
  // OUTSIDE the allergen fold, because the fold is shut when the proposal lands and a
  // change nobody is told about is the worst thing an automatic feature can do here.
  const proposedNote = el('p', { class: 'alg-proposed', hidden: 'hidden' });

  // The live line at the top: which of the three states this ingredient is in.
  // ⚠️ It says "not checked" in the app's warning colour on purpose — an
  // ingredient nobody has declared blocks every label it appears in, and that
  // has to look like a job rather than a blank.
  //
  // ⚠️⚠️ THE STATUS LINE STAYS OUTSIDE THE FOLD, THE TICK BOXES GO INSIDE IT. That
  // split is the whole design of the fold, and it is the same rule the recipe's own
  // allergen card follows (v1.60.0): the ANSWER is never behind a tap, only the JOB
  // is. Somebody asked «are there nuts in this?» reads it without touching anything.
  function refresh() {
    const draft = read();
    const state = allergenState(draft);
    const missing = missingNutrients({ nutrition: draft.nutrition });
    // ⚠️ IT MOVED OUT OF THE ALLERGEN SENTENCE AND ONTO ITS OWN HEADER. Nutrition is
    // its own section now, so leaving its note inside «Verificato il … —» would be
    // one section reporting another's state — and the two can disagree the moment
    // nutrition is switched off.
    nutHeadState.textContent = missing.length === NUTRIENTS.length
      ? t('orders.noNutritionYet')
      : (missing.length
        ? t('orders.nutritionStillEmpty', { n: missing.length, total: NUTRIENTS.length })
        : t('orders.nutritionComplete'));
    nutHeadState.className = 'alg-head-state' + (missing.length ? '' : ' alg-head-state--ok');

    algHeadState.textContent = state === 'unknown'
      ? t('orders.notDeclaredShort')
      : t('orders.declaredShort');
    algHeadState.className = 'alg-head-state'
      + (state === 'unknown' ? ' alg-head-state--warn' : ' alg-head-state--ok');

    // ⚠️ NEUTRAL WHEN FILLED, NEVER GREEN. Green on this screen means «checked»; an
    // ingredient list somebody has typed is raw material for that decision, not the
    // decision. Saying «da compilare» in the warning colour is right, though: an empty
    // list is the job that is not done.
    const hasPack = packBox.value.trim().length > 0;
    packHeadState.textContent = hasPack ? t('orders.pack.filledIn') : t('orders.pack.toFillIn');
    packHeadState.className = 'alg-head-state' + (hasPack ? '' : ' alg-head-state--warn');

    // ⚠️⚠️ IT SHOWS WHENEVER THE APP OWNS A TICK, AND THE FIRST VERSION OF THIS LINE
    // HID IT ON A VERIFIED INGREDIENT. That was wrong, and driving the form is what
    // found it: the reasoning was «the tick is on, so a person has accepted the
    // proposal» — but the tick was on BEFORE the app proposed anything. On an
    // ingredient somebody had already signed off, the app could quietly add or withdraw
    // an allergen and the screen would say «Verificato il …» as if nothing had moved.
    //
    // ⚠️ AND A VERIFIED ONE GETS THE STRONGER SENTENCE, because that is the worse case:
    // the declaration on record no longer matches what a person checked.
    //
    // ⚠️⚠️ AND IT KEEPS SPEAKING AFTER THE APP WITHDRAWS ITS OWN TICKS. A lapsed
    // verification does not come back when the text changes again, so a note tied only
    // to `proposedCount` would vanish and leave «Non ancora verificato» standing on the
    // screen with nothing to explain it.
    proposedNote.hidden = proposedCount === 0 && !stampVoided;
    if (proposedCount) {
      proposedNote.textContent = t(
        stampVoided ? 'orders.pack.proposedAfterCheck' : 'orders.pack.proposedTicks',
        { n: proposedCount });
    } else if (stampVoided) {
      proposedNote.textContent = t('orders.pack.checkVoided');
    } else {
      proposedNote.textContent = '';
    }

    // ⚠️ `note: ''` AND THEN TRIMMED. The three sentences end in «{note}», which used
    // to carry the nutrition line; the placeholder is kept rather than removed
    // because the same three phrases are pinned by the i18n suites, and an empty one
    // simply leaves a trailing space.
    if (state === 'unknown') {
      status.textContent = t('orders.allergen.notCheckedYet', { note: '' }).trim();
      status.className = 'alg-status alg-status--unknown';
      return;
    }
    const when = (checkedAt(draft) || '').slice(0, 10);
    const what = state === 'none'
      ? t('orders.allergen.containsNone')
      : draft.allergens.map(code => allergenName(code, lang)).join(', ');
    // ⚠️ TWO WHOLE SENTENCES, not one with a hole in it. The date is optional, and
    // «Checked 2026-08-21 — …» / «Verificato il 2026-08-21 — …» differ by more than
    // the gap: Italian needs «il» before the date and English needs nothing.
    status.textContent = (when
      ? t('orders.allergen.checkedOn', { date: when, what, note: '' })
      : t('orders.allergen.checkedNoDate', { what, note: '' })).trim();
    status.className = 'alg-status alg-status--ok';
  }

  // ⚠️⚠️ A TICK A PERSON MOVES BECOMES THEIRS, AND THE APP NEVER TOUCHES IT AGAIN.
  // Both directions matter. Ticking something the pack does not print is knowledge the
  // app does not have; UNticking a suggestion is a correction, and without recording
  // it the very next keystroke would put the suggestion straight back and the person
  // could not win. Dropping it from `appOwned` at the same time is what stops the app
  // later "taking back" a box that is no longer its to take.
  for (const [code, pair] of boxes) {
    for (const column of ['contains', 'may']) {
      pair[column].addEventListener('change', () => {
        const key = tickKey(code, column);
        humanTouched.add(key);
        appOwned.delete(key);
        refresh();
      });
    }
  }
  nutrients.forEach(input => input.addEventListener('input', refresh));
  checked.addEventListener('change', refresh);
  refresh();
  // ⚠️ SHOWS, NEVER TOUCHES. The first draw only marks up whatever text is stored —
  // see the note on suggest() for why re-ticking on open would erase a correction.
  suggest({ touchBoxes: false });

  const root = el('div', { class: 'mgmt-field alg-block' });

  // ⚠️ FEDERICO'S INSTRUCTION READ LITERALLY: «i dati e prezzo restano visibili sempre,
  // invece il resto rendilo una casella che quando clicchi si apre». His four
  // screenshots are the argument — the record was four screens of scrolling, and the
  // two longest parts of it are the two nobody looks at while correcting a brand.
  //
  // ⚠️ CLOSED ON EVERY OPEN, deliberately not remembered. Same as the recipe's card:
  // remembering it open would quietly undo the change on the screen it was made for.
  if (panels.allergens) {
    // ⚠️⚠️ THE PACK'S OWN LIST IS ITS OWN SECTION NOW, AND IT COMES FIRST. Federico,
    // 23 Aug 2026: «l'elenco degli ingredienti mettilo separato dagli allergeni,
    // mettilo sopra gli allergeni». It used to live inside the allergen fold, which
    // put the fast way to do the job behind the job itself.
    //
    // ⚠️ IT IS THE SAME SWITCH. The list exists to declare allergens and nothing else,
    // so a venue that has turned allergens off must not be left with an orphan box
    // feeding a feature that is not there — the v1.67.0 decision, unchanged.
    //
    // ⚠️ AND ITS STATE WORD IS DELIBERATELY NOT GREEN. On this screen green means
    // «somebody has verified this»; having typed the list is not a declaration, so a
    // filled box is stated plainly and left neutral.
    // ⚠️⚠️ THE INSTRUCTIONS ARE NOT HERE ANY MORE, THEY ARE BEHIND THE «?». Federico,
    // 23 Aug 2026, looking at this section on his phone: «le trovo troppo
    // confusionarie, c'è scritto troppo, l'elenco ingredienti deve avere solo il
    // riquadro dove scrivo gli ingredienti… tutte le spiegazioni le toglierei e le
    // metterei dentro ? cliccabile accanto». Three sentences, a re-drawn copy of what
    // he had just typed and two more paragraphs stood between him and a text box.
    //
    // ⚠️ WHAT STAYED IS THE DIVIDING LINE, AND IT IS THE SAFETY ONE: a sentence that
    // is the same on every product is an explanation and belongs in the sheet; a
    // sentence about THIS product — «the pack says frutta a guscio and nothing could
    // be ticked» — is a finding, and a finding behind a «?» is a finding nobody reads.
    root.appendChild(fold({
      title: t('orders.section.packList'),
      state: packHeadState,
      help: 'pack-list',
      above: [],
      // ⚠️ THE CAMERA IS INSIDE THE FOLD, NOT IN `above:`. What goes outside a fold on
      // this card is the ANSWER — the state word and the status line — and this is the
      // JOB. The job folds; that rule is what makes the record one screen long.
      body: [
        el('div', { class: 'alg-pack' }, [
          photoBtn,
          packBox,
          packResult,
        ]),
      ],
    }));

    root.appendChild(fold({
      title: t('orders.section.allergens'),
      state: algHeadState,
      help: 'allergens',
      // The answer, and the caveat that qualifies it. Outside the fold.
      // ⚠️ `proposed` JOINS THEM, and it has to be out here: the app now ticks boxes
      // by itself while this fold is SHUT, so without a word on the outside nobody
      // would ever learn that anything had happened.
      above: [status, proposedNote],
      body: [
        el('div', { class: 'alg-list' }, sections),
        el('label', { class: 'day-check alg-checked' }, [checked, el('span', { text: t('orders.iHaveCheckedThe') })]),
      ],
    }));
  }

  if (panels.nutrition) {
    root.appendChild(fold({
      title: t('orders.section.nutrition'),
      state: nutHeadState,
      help: 'nutrition',
      above: [],
      body: [
        el('p', { class: 'mgmt-field-label alg-nut-title', text: t('orders.per100G') }),
        nutritionGrid,
      ],
    }));
  }

  // ⚠️ THE «?» BUTTONS ARE FILLED LAST, once every host this form builds exists. The
  // module's own pass runs at page load, long before this overlay is created.
  mountHelpButtons(root);

  return { root, read };
}

// One collapsible section: a head that is the whole tap target, whatever must stay
// readable without opening it, then the half that folds.
//
// ⚠️ THE SAME SHAPE js/catalogue/catalogue-detail.js USES, on purpose — one fold
// pattern in one app. It is written out again rather than imported because the
// Catalogue's copy lives in another feature's folder and this app does not let one
// feature import another's (see the project's hygiene rules); the STYLES are the
// borrowed half, copied name for name into orders.css.
// The same card, with nothing to fold. Federico, 23 Aug 2026: «i dati prodotto siano
// separati dal Prezzo, la separazione deve essere evidente».
//
// ⚠️⚠️ WHY IT WAS INVISIBLE, AND WHY THIS IS THE FIX RATHER THAN A NEW DESIGN. The two
// halves that are always open were a bare `<h3>` over a flat list of fields, while the
// two that fold are bordered cards. So the parts of the record you always see were the
// only parts with no edge at all, and «Prezzo» read as the continuation of «Dati
// prodotto» rather than as its own thing. Giving them the SAME card the folds already
// have is what makes the boundary obvious — and it invents no border, no radius, no
// colour and no spacing. The v1.62.0 lesson: finish the copy.
//
// ⚠️ AN <h3>, NOT A BUTTON. There is nothing behind it to open, and a tap target that
// does nothing is worse than no tap target: it teaches somebody the card is closed.
function section({ title, body }) {
  return el('div', { class: 'mgmt-fold' }, [
    el('h3', { class: 'mgmt-fold-head mgmt-fold-head--static' }, [
      el('span', { class: 'mgmt-fold-label', text: title }),
    ]),
    el('div', { class: 'mgmt-fold-body' }, body),
  ]);
}

function fold({ title, state, above, body, help }) {
  const inner = el('div', { class: 'mgmt-fold-body', hidden: 'hidden' }, body);
  const btn = el('button', {
    type: 'button', class: 'mgmt-fold-head', 'aria-expanded': 'false',
    onClick: () => {
      const open = inner.hidden;
      inner.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('mgmt-fold-head--open', open);
    },
  }, [
    el('span', { class: 'mgmt-fold-label', text: title }),
    state,
    el('span', { class: 'mgmt-fold-chev', 'aria-hidden': 'true', text: '›' }),
  ]);
  // ⚠️⚠️ THE «?» CANNOT GO INSIDE THE HEAD, AND THAT IS NOT A STYLE PREFERENCE: the
  // head IS a <button>, and a button may not contain another button. So the head and
  // the «?» become a ROW, and the row carries the frame — the identical shape this app
  // already uses for a card with a delete icon on it (PR #31). Getting this wrong
  // renders as a button inside a button: the inner one is unreachable, and tapping
  // near it folds the section instead of explaining it.
  //
  // ⚠️ THE HOST IS EMPTY HERE. js/help-button.js fills any `[data-help]` it is pointed
  // at, and mountHelpButtons() is exported for exactly this — content built after the
  // page has loaded. The page says WHERE the button goes; that module says what it is.
  if (!help) return el('div', { class: 'mgmt-fold' }, [btn, ...above, inner]);
  // ⚠️ NO `help-host` CLASS HERE. The header hosts on the four pages carry it, but it
  // is defined in no stylesheet at all — mountHelpButtons() looks for `[data-help]`,
  // never for that class. Copying it would have added a fourth undefined class to a
  // project that has already shipped three. Caught by the guard that reads every class
  // this screen writes against the stylesheets it loads.
  const row = el('div', { class: 'mgmt-fold-head-row' }, [
    btn,
    el('span', { class: 'mgmt-fold-help', 'data-help': help }),
  ]);
  return el('div', { class: 'mgmt-fold' }, [row, ...above, inner]);
}

// ── The form ──────────────────────────────────────────────────────────────────
//
// item      — the ingredient being edited, or null for a new one
// suppliers — every supplier, for the picker
// preset    — a supplier id to start on when adding from inside a supplier's screen
// actions   — { saveIngredient(id, payload, record, writePrice), priceHistory(id) }
// onDone / onCancel — where the screen goes afterwards
export function buildIngredientForm({ item, suppliers, preset, actions, onDone, onCancel }) {
  const name = el('input', { type: 'text', class: 'mgmt-input', value: item?.name || '' });
  const brand = el('input', { type: 'text', class: 'mgmt-input', value: item?.brand || '', placeholder: t('orders.eGGalbani') });
  const weight = el('input', { type: 'text', class: 'mgmt-input', value: item?.weight || '', placeholder: t('orders.eg.packWeight') });
  const category = el('input', { type: 'text', class: 'mgmt-input', value: item?.category || '' });
  // "unit" is now the ORDER unit (how you count the order: casse, box), shown
  // next to the quantity — not a unit of measure. Same field, new meaning.
  const unit = el('input', { type: 'text', class: 'mgmt-input', value: item?.unit || '', placeholder: t('orders.eGCasseBox') });

  // "No supplier" is a real answer, not a missing one: the supermarket, the cash
  // & carry, the shop down the road. It is FIRST and it is the default for a new
  // ingredient — a forgotten pick then lands in a visible bucket of its own
  // instead of silently joining whichever supplier happens to sort first.
  //
  // It also catches an ingredient whose supplier was deleted: its stored id
  // matches nothing, so no <option> is selected and the browser falls back to the
  // first one, which is precisely where that ingredient now belongs.
  //
  // ⚠️ `preset` IS ONLY FOR A NEW ONE. Adding from inside Salvo's screen should
  // start on Salvo — but applying it to an EXISTING ingredient would silently
  // re-file somebody else's product the moment its form was opened from the wrong
  // place.
  const startOn = item ? item.supplierId : (preset || NO_SUPPLIER_ID);
  const supplierSelect = el('select', { class: 'mgmt-input' });
  supplierSelect.appendChild(el('option', { value: NO_SUPPLIER_ID, text: t('orders.noSupplier2') }));
  suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
    const opt = el('option', { value: s.id, text: s.name });
    if (startOn === s.id) opt.selected = true;
    supplierSelect.appendChild(opt);
  });

  // ⚠️ THE PRICE IS ONLY DRAWN FOR SOMEBODY WHO MAY SEE MONEY. An employee's
  // form has no price at all — not a disabled one — because a disabled field
  // still SHOWS the rate, and showing it is precisely what moving the price out
  // of the ingredient document was for.
  const mayPrice = canManageHere();
  const price = mayPrice ? priceBlock(item, actions) : null;
  // ⚠️ NOT A ROLE, A VENUE. Everybody in the building gets the same answer here: it
  // says whether this business tracks allergens and nutrition at all, and the two
  // switches behind it live one screen away (js/orders/registry-settings.js).
  const allergens = allergenBlock(item, ingredientPanels(), actions);

  const save = el('button', { type: 'button', class: 'btn-primary', onClick: async () => {
    // The supplier is no longer required — only the name is.
    if (!name.value.trim()) { name.focus(); return; }
    save.disabled = true;

    // Every price field is in the patch, as a number or as null, because this is
    // a MERGE write: a field left out keeps whatever it had, so emptying the
    // boxes could never actually remove a price.
    // An employee sends no price fields at all, so splitPriceFields writes an
    // empty price document — and saveIngredientWithPrice is told not to write
    // one, because a batch is all-or-nothing and a refused price write would
    // fail the whole save of an ordinary rename.
    const patch = mayPrice ? pricePatch(price.read(), new Date().toISOString()) : {};
    const payload = {
      name: name.value.trim(),
      supplierId: supplierSelect.value,
      brand: brand.value.trim(),
      weight: weight.value.trim(),
      category: category.value.trim() || 'Other',
      unit: unit.value.trim(),
      active: item ? item.active !== false : true,
      ...patch,
      ...allergens.read(),
    };

    // Record the price only when it is COMPLETE and actually different. Saving
    // the form to correct a spelling must not plant an identical entry — a
    // history of non-events cannot answer "when did this go up?" — and removing
    // a price is not a price, so it records nothing.
    const record = mayPrice && patch.pricePerUnit !== null && priceChanged(item, patch)
      ? priceRecord({ ...item, supplierId: payload.supplierId }, patch, patch.priceUpdatedAt)
      : null;

    try {
      await actions.saveIngredient(item?.id || null, payload, record, mayPrice);
      onDone?.();
    }
    catch (err) {
      save.disabled = false;                       // let them try again
      await reportFailure('save', payload.name, err);
    }
  } }, t('ui.save'));

  return el('div', { class: 'mgmt-form' }, [
    // ⚠️ NO TITLE OF ITS OWN ANY MORE. It had one because the panel's header said
    // «Impostazioni» and something had to name the form. The form now has a header
    // of its own that says «Modifica ingrediente», so the h2 said it a second time,
    // 40px below the first. Seen in a screenshot, not in a measurement.
    //
    // ⚠️ THE HEADING IS NOT A SECOND NAME FOR THE FORM — it is the first of four
    // sections, and the price block below already carries the matching one. Without
    // it the six fields would be the only unnamed part of a screen where everything
    // else is named, which is what makes «Prezzo» look like the start of the record
    // rather than its second half.
    section({
      title: t('orders.section.productData'),
      body: [
        field(t('orders.field.name'), name),
        field(t('orders.field.supplier'), supplierSelect),
        field(t('orders.field.brand'), brand),
        field(t('orders.field.weight'), weight),
        field(t('orders.field.category'), category),
        field(t('orders.orderUnit'), unit),
      ],
    }),
    // ⚠️ STILL DRAWN ONLY FOR SOMEBODY WHO MAY SEE MONEY — the card wraps the price,
    // it does not grant it. An employee's form has no price section at all, not an
    // empty one, because an empty card labelled «Prezzo» advertises what it withholds.
    ...(price ? [section({ title: t('orders.section.price'), body: [price.node] })] : []),
    allergens.root,
    formActions(save, onCancel),
  ]);
}
