// catalogue-detail.js — a single recipe: shows the base (unscaled) recipe
// immediately, with amounts column-aligned; a bottom "Total dough weight" input
// (starts empty) scales everything pro-rata AFTER a confirm; a Clear button
// (only once scaled) returns to the base; an Import button copies it into the
// Calculator.

import { t } from '../i18n.js';
import { canManageHere } from './firebase-catalogue.js';
import { el } from './dom.js';
import { currentSession } from '../firebase.js';
import { isSectionAllowed } from '../sections.js';
import {
  scaleCatalogue, baseAmounts, weighableTotalGrams, unitOf, batchWarning, formatWeight,
} from './catalogue-model.js';
import {
  getScaledTarget, setScaledTarget, clearScaledTarget, getIngredients, getRecipesById,
} from './catalogue-store.js';
import { costRecipe, partialCostText } from './recipe-cost-model.js';
import { recipeAllergens, canLabel, incompleteText, ALLERGEN_REASON_TEXT } from './recipe-allergen-model.js';
// The declaration this screen now shows. ⚠️ NO NEW ARITHMETIC: buildLabel already
// flattens sub-recipes, sums duplicates, sorts DESCENDING BY WEIGHT (which is the law,
// not a presentation choice) and marks the allergen-bearing rows.
import {
  buildLabel, containsLine, mayContainLine, declarationText,
} from './recipe-label-model.js';
// ⚠️⚠️ WHAT A RECIPE CONTAINS IS NAMED IN THE VENUE'S COUNTRY'S LANGUAGE, NOT THE
// SCREEN'S (Federico, 23 Aug 2026). This card is read by whoever is asked «are there
// nuts in this?» and it must agree, word for word, with the label the same recipe
// prints — one of the two saying «Hazelnut» and the other «Nocciole» is how somebody
// stops trusting either. The words AROUND the list («may contain», «not declared»)
// stay interface text: they address the reader, not the consumer.
import { outputLanguage, allergenName } from '../market.js';
// Whether this venue tracks allergens at all. From js/ root: Orders sets the switch
// and the Catalogue obeys it, so the judgement lives in one file for both.
import { allergensOn } from '../venue-features.js';
// ⚠️ formatMoney AND NOT formatRate, and it is one identifier with a reason.
// Federico, 24 Aug 2026: «nella casella costo voglio solo il costo al kg con due numeri
// decimali dopo il punto». formatRate prints two to FOUR decimals so that a gelatine
// leaf at 3.5p does not read as £0.00 — right for a rate per PIECE, and a kilo of a
// recipe costing under a penny is not a real case. formatRate itself is untouched: it
// has eleven call sites across Orders, Food Cost and this feature's own ingredient
// rates, and widening it for one screen would move all eleven.
import { formatMoney } from '../price-model.js';
// ⚠️ From js/ ROOT since 24 Aug 2026. It used to live in js/staff/, and a feature may
// not import from another feature's folder — making a fifth copy of the raced clipboard
// write to satisfy a rule whose whole purpose is to stop copies would be the wrong
// reading of it.
import { copyToClipboard } from '../share.js';
import { chooseHowToSend } from '../send-sheet.js';
import { SEND_PATHS, svgElement } from '../send-icon.js';
import { hasProcedure, normalizeSteps, unassignedRows, progressText, formatDuration } from './guided-model.js';

const IMPORT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
// Close (exit full screen) button icon. Static SVG only.
const CLOSE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

// Whole grams only: values are already rounded in the model, and maximumFractionDigits:0
// is a belt-and-suspenders guard so nothing ever shows a decimal. useGrouping:false
// drops the thousands separator (e.g. 1000 g, not 1,000 g) — Federico's preference.
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });
// Split each amount into number + unit so they line up in two straight columns
// (numbers right-aligned, units left-aligned) no matter how long the name is. A
// 'to taste' row (value null) has no number and shows the phrase in the unit slot.
const amountParts = (value, unit) => value === null ? { num: '', unit: 'to taste' } : { num: nf.format(value), unit };
const amountEl = ({ num, unit }) => el('span', { class: 'cat-ing-amt' }, [
  el('span', { class: 'cat-ing-num', text: num }),
  el('span', { class: 'cat-ing-unit', text: unit }),
]);

// What a kilo of this recipe costs, from the prices entered in Orders.
//
// ⚠️ THE NUMBER AND ITS CAVEAT ARE ONE ELEMENT, NEVER TWO. If some rows are not
// linked, the figure is the cost per kilo OF THE LINKED ROWS — a real, useful,
// PARTIAL answer — and showing it without the note beside it is the one way this
// screen can mislead: a food cost that reads complete and is too low.
//
// The whole panel is hidden when nothing at all is linked, rather than showing
// "£0.00" or an empty box on the hundreds of recipes nobody has linked yet.
function costPanel(recipe) {
  const result = costRecipe(recipe, {
    ingredients: getIngredients(),
    recipes: getRecipesById(),
  });

  const panel = el('div', { class: 'cat-cost-panel' });
  if (result.pricePerKg === null) {
    // Nothing linked at all: say what to do, once, quietly — and only when the
    // recipe has rows worth linking, so a brand-new empty recipe stays silent.
    if (!result.unpriced.length) { panel.hidden = true; return panel; }
    // ⚠️ THE HEADING IS DRAWN HERE TOO, and it was not until 24 Aug 2026. Every other
    // block on this screen now carries one, so a single unheaded box saying «no cost
    // yet» read as something half-built rather than as the cost card with nothing in
    // it. Seen in a screenshot; no measurement asks about a missing heading.
    panel.appendChild(el('div', { class: 'cat-cost-head' }, [
      el('span', { class: 'cat-cost-label', text: t('cat.cost') }),
    ]));
    panel.appendChild(el('p', { class: 'cat-cost-none', text:
      t('cat.noCostYetLink') }));
    return panel;
  }

  panel.appendChild(el('div', { class: 'cat-cost-head' }, [
    el('span', { class: 'cat-cost-label', text: t('cat.cost') }),
    el('span', { class: 'cat-cost-value', text: `${formatMoney(result.pricePerKg)} / kg` }),
  ]));

  // The weight it was worked out over, said plainly, because it is NOT the recipe
  // total whenever a row is unlinked — and a reader comparing the two numbers
  // deserves to know why they differ rather than doubting both.
  const over = result.lossPct > 0
    ? t('cat.costOverLoss', { yield: formatWeight(result.yieldGrams), pct: result.lossPct,
      from: formatWeight(result.costedGrams) })
    : t('cat.costOver', { yield: formatWeight(result.yieldGrams) });
  panel.appendChild(el('p', { class: 'cat-cost-basis', text: over }));

  const note = partialCostText(result);
  if (note) panel.appendChild(el('p', { class: 'cat-cost-partial', text: note }));

  return panel;
}

// ── The ingredient declaration, on the recipe screen ─────────────────────────
//
// Federico, 24 Aug 2026: «aggiungi l'elenco ingredienti che si compila in automatico
// ordinando gli ingredienti in ordine decrescente, evidenziando in grassetto gli
// allergeni; la devo poter inviare tramite diverse opzioni di invio (WhatsApp, email,
// ecc.) oppure copiare».
//
// ⚠️ NOTHING HERE IS NEW ARITHMETIC. flattenIngredients() has sorted descending by
// weight, flattened sub-recipes and summed duplicates since v1.38.0, and buildLabel()
// has marked the allergen-bearing rows since then too. What was missing is that it sat
// behind «Crea etichetta», inside a folded card. This puts it on the screen.
//
// ⚠️⚠️ A SECTION, NEVER A FOLD. A declaration behind a tap is a declaration nobody
// reads — the same argument the allergen card's answer already wins.
function declarationPanel(recipe, app) {
  const location = currentSession().location;
  const panel = el('div', { class: 'cat-decl' });

  // ⚠️ ASKED FIRST, BEFORE ANYTHING IS COMPUTED. A venue that has switched allergens
  // off must not be offered a declaration about data it can no longer reach — the same
  // refusal, in the same order, as label-view.js.
  if (!allergensOn(location)) { panel.hidden = true; return panel; }

  const lang = outputLanguage(location);
  const label = buildLabel(recipe, { ingredients: getIngredients(), recipes: getRecipesById() });

  panel.appendChild(el('div', { class: 'cat-sec-head' }, [
    el('span', { class: 'cat-sec-label', text: t('cat.decl.title') }),
  ]));

  if (!label.ok) {
    // ⚠️ ONE LINE, POINTING AT THE CARD THAT ALREADY EXPLAINS IT, and NO send buttons
    // at all. A half declaration must never be sendable: a list that silently omits the
    // rows nobody has declared is worse than no list, because it looks complete.
    panel.appendChild(el('p', { class: 'cat-decl-blocked', text: t('cat.decl.blocked') }));
    return panel;
  }

  // ⚠️ THE ALLERGEN IS EMPHASISED INSIDE THE LIST, which is what the regulation asks
  // for — not only summarised underneath. Same bold-and-underline as .lab-ing--allergen
  // on the label screen: the same fact must not look like two different things.
  const list = el('p', { class: 'cat-decl-list' });
  label.ingredients.forEach((item, i) => {
    if (i) list.appendChild(document.createTextNode(', '));
    list.appendChild(el('span', {
      class: item.emphasise ? 'cat-decl-ing cat-decl-ing--allergen' : 'cat-decl-ing',
      text: item.name,
    }));
  });
  list.appendChild(document.createTextNode('.'));
  // ⚠️ NO «Ingredienti:» LINE ON SCREEN, and it is not an omission. The card's own
  // heading already says what this is, and the two stacked read as one heading repeated
  // — the same duplication the batch-weight card had, seen in the same screenshot. The
  // SENT text still carries it, because there the law asks for it: declarationText()
  // writes «Ingredienti: …» at the top. The label screen shows the list unprefixed too.
  panel.appendChild(list);

  const contains = containsLine(label, lang);
  if (contains) panel.appendChild(el('p', { class: 'cat-decl-contains', text: contains }));
  const traces = mayContainLine(label, lang);
  if (traces) panel.appendChild(el('p', { class: 'cat-decl-traces', text: traces }));

  // ⚠️ THE CAVEAT TRAVELS WITH THE TEXT, and it is interface language: it addresses the
  // person holding the phone, not the consumer reading a packet.
  panel.appendChild(el('p', { class: 'cat-decl-caveat', text: t('cat.decl.caveat') }));

  // ⚠️⚠️ WHAT IS SENT IS THE LABEL'S OWN TEXT, in the COUNTRY's language, built by the
  // one builder the label screen uses. Nutrition is left out of a message: some mail
  // clients silently drop a body past ~2000 characters and the table is most of it.
  const text = () => declarationText(label, lang, { withNutrition: false });
  const status = el('span', { class: 'cat-decl-status' });

  const copyBtn = el('button', {
    class: 'cat-decl-btn', type: 'button',
    onclick: async () => {
      status.textContent = await copyToClipboard(text())
        ? t('label.copied') : t('label.copyFailed');
    },
  }, [t('cat.decl.copy')]);

  // ⚠️⚠️ ONE ARROW WHERE THERE WERE TWO NAMED BUTTONS. Federico, 24 Aug 2026, looking
  // at this card on his phone: «togli la casella whatsapp e email e metti una freccia
  // per inviare che poi mi fa scegliere come inviarlo». The choice did not disappear —
  // it moved behind the arrow, into the sheet every other screen in the app now opens.
  //
  // ⚠️ COPY STAYS A BUTTON OF ITS OWN, deliberately: he asked for WhatsApp and Email to
  // go, not for copying to go, and copying is not sending.
  const sendBtn = el('button', {
    class: 'cat-decl-btn cat-decl-send-btn', type: 'button',
    'aria-label': t('ui.send'),
    onclick: () => chooseHowToSend({ subject: recipe.name, text: text() }),
  }, [svgElement(SEND_PATHS, 18), el('span', {}, t('ui.send'))]);

  panel.appendChild(el('div', { class: 'cat-decl-send' }, [copyBtn, sendBtn]));
  // ⚠️ mailto OPENS THE MAIL APP, IT DOES NOT SEND. The sheet says so under the Email
  // road itself, which is where it is read at the moment it matters — believing a
  // declaration has gone out when it is sitting in a draft is the one way this can
  // mislead, and a note down here was read before the choice rather than with it.
  panel.appendChild(status);
  return panel;
}

// What this recipe contains, for somebody at the counter being asked.
//
// ⚠️ IT IS THE COST PANEL'S TWIN AND ITS OPPOSITE. The panel above shows a
// PARTIAL number with "3 ingredients are not priced yet" beside it, because a
// slightly-too-low price is still a useful answer. Here a partial list is the
// dangerous one — the unlinked row could be the one with the hazelnuts — so when
// anything is missing this refuses to present a list at all and shows the JOB
// instead.
function allergenPanel(recipe, app) {
  // ⚠️⚠️ THE WHOLE CARD GOES WHEN THE VENUE HAS ALLERGENS SWITCHED OFF, AND WITH IT
  // THE ONLY WAY TO A LABEL — `app.openLabel` is called from inside this panel and
  // nowhere else, so the label cannot be reached by accident. That is deliberate
  // rather than convenient: a printed food label with no allergen line is worse than
  // no label at all, and a venue that has told the app it does not track allergens
  // cannot be allowed to produce one.
  //
  // ⚠️ AND IT IS READ HERE, ON EVERY BUILD, not captured once. refreshCost() rebuilds
  // this panel on every snapshot, so a switch thrown on another phone arrives with
  // the next one.
  if (!allergensOn(currentSession().location)) {
    const off = el('div', { class: 'cat-alg-panel' });
    off.hidden = true;
    return off;
  }

  const result = recipeAllergens(recipe, {
    ingredients: getIngredients(),
    recipes: getRecipesById(),
  });

  // ⚠️ READ HERE, WHEN THE CARD IS BUILT — never at module load, where no venue is open
  // yet and every name would freeze as English (the v1.57.0 defect). An unknown country
  // gives null, and allergenName() then returns the canonical English rather than a
  // blank: a missing name in a list of allergens still LOOKS like a complete answer.
  const lang = outputLanguage(currentSession().location);

  const panel = el('div', { class: 'cat-alg-panel' });

  // ⚠️⚠️ THE CARD FOLDS SHUT, AND WHAT STAYS OUTSIDE THE FOLD IS THE WHOLE DESIGN.
  // Federico, 23 Aug 2026: on an incomplete recipe this was nine lines — a head, a
  // warning and up to eight named rows — and it pushed the batch-weight box, the
  // thing the screen is opened for, two cards down the page.
  //
  // ⚠️ THE ANSWER IS NEVER BEHIND A TAP. This is the only screen in the app that can
  // send somebody to hospital. Closed, it still says «not declared», or on a complete
  // recipe still names what it contains — so somebody at the counter asked "are there
  // hazelnuts in this?" answers without touching anything. Only the JOB folds away:
  // which rows to go and fix, the traces, the caveat, the way to the label.
  //
  // ⚠️ AND IT OPENS CLOSED EVERY TIME. Remembering it open would quietly undo the
  // change on the screens he opens most.
  const body = el('div', { class: 'cat-alg-body', hidden: 'hidden' });
  const head = (statusEl) => {
    const btn = el('button', {
      class: 'cat-alg-head cat-alg-toggle', type: 'button', 'aria-expanded': 'false',
      onclick: () => {
        const open = body.hidden;
        body.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.classList.toggle('cat-alg-toggle--open', open);
      },
    }, [
      el('span', { class: 'cat-alg-label', text: t('cat.alg.title') }),
      statusEl,
      el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' }),
    ]);
    return btn;
  };

  if (!canLabel(result)) {
    // A brand-new empty recipe stays silent, like the cost panel does: there is
    // nothing to declare and nothing to go and fix.
    if (!result.gaps.length) { panel.hidden = true; return panel; }

    panel.appendChild(head(el('span', { class: 'cat-alg-blocked', text: t('cat.alg.notDeclared') })));
    panel.appendChild(body);
    body.appendChild(el('p', { class: 'cat-alg-warn', text: incompleteText(result) }));
    // ⚠️ NAME THE ROWS. "Incomplete" leaves somebody hunting through twenty
    // ingredients; this list IS the work, and it is why the panel appears long
    // before the data is in.
    const list = el('ul', { class: 'cat-alg-gaps' });
    for (const gap of result.gaps.slice(0, 8)) {
      list.appendChild(el('li', { text: `${gap.label} — ${reasonLabel(gap.reason)}` }));
    }
    if (result.gaps.length > 8) {
      list.appendChild(el('li', { class: 'cat-alg-more', text: t('cat.alg.andMore', { n: result.gaps.length - 8 }) }));
    }
    body.appendChild(list);
    // What IS known so far, marked as explicitly NOT an answer.
    if (result.allergens.length) {
      body.appendChild(el('p', { class: 'cat-alg-sofar',
        text: t('cat.alg.soFar', { list: result.allergens.map(c => allergenName(c, lang)).join(', ') }) }));
    }
    return panel;
  }

  panel.appendChild(head(el('span', { class: 'cat-alg-ok', text: t('cat.alg.declared') })));
  // ⚠️ OUTSIDE THE FOLD, DELIBERATELY. What a recipe contains is the answer somebody
  // at the counter needs in the moment they are asked; putting it behind a tap means
  // a rushed answer given without opening it.
  panel.appendChild(el('p', { class: 'cat-alg-list', text: result.allergens.length
    ? result.allergens.map(c => allergenName(c, lang)).join(', ')
    // ⚠️ «None of the 14» STAYS INTERFACE TEXT, deliberately. It names no food — it is a
    // sentence about this recipe, addressed to the person reading the screen. The label
    // has its own wording for the same fact, chosen by the country, in market.js.
    : t('cat.noneOfThe14') }));
  panel.appendChild(body);
  if (result.mayContain.length) {
    body.appendChild(el('p', { class: 'cat-alg-traces',
      text: t('cat.alg.mayContain', { list: result.mayContain.map(c => allergenName(c, lang)).join(', ') }) }));
  }
  // ⚠️ THE SENTENCE THAT MUST NOT BE DROPPED. The app gathers what it was told;
  // it cannot know what happened on the bench this morning, and a screen that
  // implies otherwise is worse than one that says nothing.
  //
  // ⚠️ It is INSIDE the fold, and that is a judgement worth stating: it qualifies an
  // answer that is already outside the fold, and somebody reading the list without
  // opening the card is reading what the SUPPLIER said either way. Anyone acting on
  // it — printing a label — opens the card to reach the button below.
  body.appendChild(el('p', { class: 'cat-alg-caveat', text:
    t('cat.fromTheSuppliersSpecifications2') }));

  // ⚠️ THE WAY TO THE LABEL EXISTS ONLY WHEN THERE IS A LABEL TO MAKE. Offering
  // it on a recipe with gaps would mean tapping through to a refusal — and the
  // refusal is already here, three lines above, naming exactly what is missing.
  body.appendChild(el('button', {
    class: 'cat-alg-label-btn', type: 'button',
    onclick: () => app.openLabel(recipe),
  }, [t('cat.makeALabel'), el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' })]));

  return panel;
}

// The seven reasons a row cannot be declared.
//
// ⚠️ RESOLVED HERE, NOT IN THE FROZEN CONSTANT. ALLERGEN_REASON_TEXT in
// recipe-allergen-model.js now holds KEYS: a module constant that called t() would be
// evaluated once, at first import — before a venue is open, so before the interface
// language is even known — and would render English for ever with a correct Italian
// translation sitting in the dictionary. Fourteen constants in this app did exactly
// that. The defect is WHEN, not WHAT.
function reasonLabel(reason) {
  const key = ALLERGEN_REASON_TEXT[reason];
  return key ? t(key) : reason;
}

// ── Guided mixing ─────────────────────────────────────────────────────────────
//
// The procedure, offered where the batch weight has just been chosen: the amounts
// the run reads are the ones this screen is showing, so the two sit together.
//
// ⚠️ THE RESUME OFFER IS PART OF THIS PANEL, not only the dialog on opening the
// catalogue. Somebody who dismissed that dialog, or who reopened the app hours
// later, still has a dough on the go — and the only other way back in would be to
// start again from step one.
function guidedPanel(recipe, app, getTarget) {
  const panel = el('div', { class: 'cat-guided-panel' });
  const steps = normalizeSteps(recipe.steps);
  const session = app.guidedSessionFor(recipe.id);

  if (!steps.length) {
    // Quiet, and honest about what it is for: hundreds of recipes will never have
    // one, and this must not read as something missing from each of them.
    panel.appendChild(el('button', {
      class: 'cat-guided-write', type: 'button',
      onclick: () => app.openGuidedEditor(recipe),
    }, [t('cat.writeTheMixingSteps')]));
    panel.appendChild(el('p', { class: 'cat-guided-hint', text:
      t('cat.aStepAtA') }));
    return panel;
  }

  if (session) {
    panel.appendChild(el('button', {
      class: 'cat-guided-go cat-guided-go--resume', type: 'button',
      onclick: () => app.resumeGuided(recipe),
    }, [t('cat.resumeGuidedMix', {
      progress: progressText(session.stepIndex,
        normalizeSteps(session.snapshot.steps).length, { inline: true }),
    })]));
  }

  panel.appendChild(el('button', {
    class: 'cat-guided-go', type: 'button',
    onclick: () => app.startGuided(recipe, getTarget()),
  }, [session ? t('cat.startAgainFromThe') : t('cat.guidedMixing')]));

  const timed = steps.reduce((sum, s) => sum + s.seconds, 0);
  panel.appendChild(el('p', { class: 'cat-guided-hint', text:
    t('cat.nSteps', { n: steps.length })
      + (timed ? ' · ' + t('cat.ofTimers', { time: formatDuration(timed) }) : '') }));

  // ⚠️ THE WARNING TRAVELS WITH THE PROCEDURE. It is shown while writing the steps
  // and again at the end of a run, but somebody about to start deserves it too:
  // this is the moment they decide to trust it.
  const missed = unassignedRows(recipe);
  if (missed.length) {
    panel.appendChild(el('p', { class: 'cat-guided-warn', text:
      t('cat.notInAnyStep', { list: missed.map(r => r.label).join(', ') }) }));
  }

  panel.appendChild(el('button', {
    class: 'cat-guided-edit', type: 'button', text: t('cat.editTheSteps'),
    onclick: () => app.openGuidedEditor(recipe),
  }));
  return panel;
}

export function renderDetail({ recipe, app }) {
  // Restore a recently calculated batch (kept per device until Clear or 12h), so
  // leaving and reopening the recipe shows the same scaled amounts. 0 = base.
  let displayTarget = getScaledTarget(recipe.id) || 0;

  // The rows live in an inner container so re-rendering (renderRows) never wipes
  // the zoom button that sits alongside them inside .cat-ing-list.
  const ingRows = el('div', { class: 'cat-ing-rows' });

  // Tap-to-zoom: a tap on the recipe expands it into a full-screen overlay (bigger
  // figures, readable across the room); tapping again — the × button, or Escape —
  // returns to normal. A CSS fixed overlay is used, NOT the Fullscreen API, because
  // iOS Safari blocks that API for non-video elements.
  let zoomed = false;

  // Close (×) lives inside the overlay and only shows while zoomed.
  const closeBtn = el('button', {
    class: 'cat-zoom-close', type: 'button', 'aria-label': t('cat.exitFullScreen'),
    onclick: (e) => { e.stopPropagation(); setZoom(false); },
    icon: CLOSE_SVG,
  });

  const ingList = el('div', {
    class: 'cat-ing-list', role: 'button', tabindex: '0', 'aria-pressed': 'false',
    'aria-label': t('cat.viewRecipeFullScreen'),
    onclick: () => setZoom(!zoomed),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoom(!zoomed); }
      else if (e.key === 'Escape' && zoomed) { e.preventDefault(); setZoom(false); }
    },
  }, [ingRows, closeBtn]);

  function setZoom(on) {
    zoomed = on;
    ingList.classList.toggle('cat-ing-list--zoom', on);
    ingList.setAttribute('aria-pressed', on ? 'true' : 'false');
    ingList.setAttribute('aria-label', on ? t('cat.exitFullScreen') : t('cat.viewRecipeFullScreen'));
    // Lock the page behind the overlay so it can't scroll under it.
    document.body.classList.toggle('cat-zoom-lock', on);
    if (on) { try { ingList.focus({ preventScroll: true }); } catch (e) { /* best-effort */ } }
  }

  // GRAMS, like the recipe rows and the Total right above it — type 17500 and you get
  // 17500 g. The field used to take kilograms while everything around it read in grams,
  // so "17500" was taken as 17500 kg and quietly produced a 17.5-tonne batch.
  const gramsInput = el('input', {
    id: 'catGrams', type: 'number', min: '0', step: '1',
    value: displayTarget > 0 ? String(Math.round(displayTarget)) : '', placeholder: '0',
    inputmode: 'numeric', 'aria-label': t('cat.totalDoughWeightIn'),
  });

  const clearBtn = el('button', {
    class: 'cat-clear-btn', type: 'button', hidden: 'hidden',
    text: t('cat.clearBackToBase'),
    onclick: () => { displayTarget = 0; gramsInput.value = ''; clearScaledTarget(recipe.id); renderRows(); },
  });

  const calcBtn = el('button', {
    class: 'cat-calc-btn', type: 'button', text: t('cat.calculate'), onclick: onCalculate,
  });

  function renderRows() {
    ingRows.replaceChildren();
    const scaled = displayTarget > 0;
    const amounts = scaled ? scaleCatalogue(recipe, displayTarget) : baseAmounts(recipe);
    recipe.ingredients.forEach((ing, i) => {
      ingRows.appendChild(el('div', { class: 'cat-ing-row' }, [
        el('span', { class: 'cat-ing-name', text: ing.label }),
        amountEl(amountParts(amounts[i], unitOf(ing))),
      ]));
    });
    // Total = the WEIGHABLE mass in grams (weight + volume rows): when scaled it is
    // the target, at base the recipe's own weighable total. Non-weight rows (pieces /
    // to-taste) are shown above but never enter this total.
    const total = scaled ? displayTarget : weighableTotalGrams(recipe);
    ingRows.appendChild(el('div', { class: 'cat-ing-row cat-ing-total' }, [
      el('span', { class: 'cat-ing-name', text: t('cat.total') }),
      amountEl({ num: nf.format(total), unit: 'g' }),
    ]));
    clearBtn.hidden = !scaled;
  }

  async function onCalculate() {
    const grams = parseFloat(gramsInput.value);
    if (!isFinite(grams) || grams <= 0) { // empty / 0 → base recipe
      displayTarget = 0;
      clearScaledTarget(recipe.id);
      renderRows();
      return;
    }
    // The confirm always spells the amount out BOTH ways (17500 g / 17.5 kg), so a
    // wrong order of magnitude is caught by eye before anything is scaled. A batch
    // outside any plausible size gets a louder title and an explicit warning line.
    const warning = batchWarning(grams, weighableTotalGrams(recipe));
    const readable = `${nf.format(grams)} g (${formatWeight(grams)})`;
    const ok = await app.confirm({
      title: warning ? t('cat.thatIsAVery') : t('cat.calculateRecipe'),
      message: warning
        ? `${warning}\n\n${t('cat.calculateFor', { recipe: recipe.name, amount: readable })}`
        : t('cat.calculateFor', { recipe: recipe.name, amount: readable }),
      okLabel: t('ui.calculate'),
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;
    displayTarget = grams;
    setScaledTarget(recipe.id, displayTarget); // keep this batch until Clear / 12h
    renderRows();
  }

  // ⚠️ NO VISIBLE LABEL INSIDE THE CARD ANY MORE, and the card's own heading is why.
  // Seen in a screenshot after the cards landed: «PESO IMPASTO» and «PESO TOTALE
  // IMPASTO» sat one above the other, two headings saying the same thing. The input
  // keeps its accessible name through aria-label, so nothing is lost to a screen
  // reader — what goes is the repetition, not the label.
  const weightPanel = el('div', { class: 'cat-weight-panel' }, [
    el('div', { class: 'cat-weight-input' }, [
      el('div', { class: 'cat-field' }, [gramsInput, el('span', { class: 'unit', text: 'g' })]),
      calcBtn,
    ]),
    clearBtn,
  ]);
  // No weighable ingredients (all pieces / to-taste) → nothing to scale by weight,
  // so hide the whole panel. getScaledTarget stays 0 in that case too.
  if (weighableTotalGrams(recipe) <= 0) weightPanel.hidden = true;

  // "Import into Calculator" WRITES the Calculator's configuration. A location
  // that does not use the Calculator is refused that write by the rules, so the
  // button would only ever produce a permission error: hide it instead.
  // ⚠️ `hidden` IS SET AFTERWARDS, NOT PASSED TO el(), AND THAT IS THE WHOLE FIX.
  // el() ends in `node.setAttribute(key, value)`, and setAttribute('hidden', false)
  // writes the STRING "false" — the attribute is PRESENT, and `[hidden]` matches on
  // presence. So `hidden: !allowed` hid this button for EVERYBODY, including every
  // venue that does use the Calculator: the only way to copy a recipe into it was
  // gone. Assigning the property takes a real boolean and removes the attribute when
  // false. This was the only computed boolean handed to el() anywhere in the app.
  const importBtn = el('button', {
    class: 'cat-import-btn', type: 'button',
    onclick: () => app.importRecipe(recipe),
  }, [
    el('span', { icon: IMPORT_SVG, 'aria-hidden': 'true' }),
    t('cat.importIntoCalculator'),
  ]);
  importBtn.hidden = !isSectionAllowed(currentSession().location, 'calculator');

  // Low-key delete (P20 — de-emphasised destructive action): routed through the
  // shared guard, which warns if the recipe was imported into the Calculator and
  // navigates back to the list once deleted.
  //
  // ⚠️ OWNER ONLY, and it is absent rather than disabled. A recipe carries its
  // guided procedure, its ingredient links and whatever Food Cost products point
  // at it, none of which the button mentions. Staff keep every other action on
  // this screen — a disabled control just invites the tap that explains nothing.
  const deleteBtn = !canManageHere() ? null : el('button', {
    class: 'cat-detail-del', type: 'button',
    onclick: () => app.confirmAndDelete(recipe),
  }, [
    el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }),
    t('cat.deleteRecipe'),
  ]);

  renderRows();

  // The recipe name already lives in the green header (setHeader), so no title
  // here. The recipe + weight panel are wrapped in .cat-detail-top, which is made
  // at least a screenful tall (CSS min-height), so Import/Delete always land BELOW
  // the fold and are reached only by scrolling — never competing with the recipe.
  // The cost panel is REPLACED in place when new data arrives, never the whole
  // view: rebuilding the view would throw away a scaled batch the user is reading.
  // ⚠️⚠️ ONE FUNCTION FEEDS BOTH THE FIRST BUILD AND EVERY REFRESH, AND THAT IS THE
  // WHOLE POINT OF IT EXISTING. This host holds TWO cards, and refreshCost() below
  // replaces its children on every price snapshot. On 11 August it was given ONE —
  // `replaceChildren(costPanel(...))` — and the allergen card was silently deleted from
  // an open screen, on the only screen in this app that can send somebody to hospital.
  // It stayed that way for eleven days (v1.60.1). Two call sites that each list the
  // children can diverge; one function cannot.
  // ⚠️ THE DECLARATION JOINS THE HOST RATHER THAN STANDING OUTSIDE IT, and that is the
  // whole reason costHostChildren exists: it is rebuilt whenever a price or an
  // ingredient snapshot arrives, exactly like the two cards beside it. Left outside, a
  // recipe whose last ingredient was declared on another phone would keep saying it
  // cannot be labelled until this screen was closed and reopened.
  const costHostChildren = (r) => [costPanel(r), allergenPanel(r, app), declarationPanel(r, app)];
  const costHost = el('div', { class: 'cat-cost-host' }, costHostChildren(recipe));

  // The batch weight is read at the moment Start is tapped, not captured here:
  // choosing a weight and then starting the mix is one gesture, and a panel built
  // before the weight was typed would carry the old one into the dough.
  const guidedHost = el('div', { class: 'cat-guided-host' },
    [guidedPanel(recipe, app, () => displayTarget)]);

  // ⚠️ ONE CARD SHAPE FOR EVERY BLOCK ON THIS SCREEN. Federico, 24 Aug 2026: «dividi
  // tutte le funzioni in riquadri come hai fatto nella scheda del prodotto fornitore
  // così che ogni funzione si distingua bene». Until now two of the five blocks had an
  // edge and three floated on the page, so the screen read as one long thing.
  //
  // ⚠️ A STATIC HEAD, NOT A FOLD. The ingredient-card's folds hide a JOB; every block
  // here is an ANSWER — what is in it, what it weighs, what it costs, how it is made —
  // and an answer behind a tap is an answer nobody reads. That is the same rule the
  // allergen card follows by keeping its state word outside its fold.
  //
  // ⚠️ AND THE HEAD IS AN <h3>, NEVER A BUTTON: there is nothing behind it to open, and
  // a tap target that does nothing teaches somebody the card is closed. Copied from
  // section() in js/orders/ingredient-form.js, which is itself a copy of this file's
  // own .cat-alg-* card — one fold pattern in one app.
  const catSection = (title, children) => el('div', { class: 'cat-sec' }, [
    el('h3', { class: 'cat-sec-head' }, [el('span', { class: 'cat-sec-label', text: title })]),
    el('div', { class: 'cat-sec-body' }, children),
  ]);

  const batchCard = catSection(t('cat.section.batch'), [weightPanel]);
  batchCard.hidden = weightPanel.hidden;
  const guidedCard = catSection(t('cat.section.procedure'), [guidedHost]);

  // ⚠️ THE COST AND ALLERGEN CARDS ARE **NOT** WRAPPED. Both already carry a head and a
  // frame of their own, and the allergen one carries a STATE WORD in that head; putting
  // either inside another card gives it two heads. It is also the one card on this
  // screen that has already cost a live defect, and this release does not touch it.
  const root = el('div', { class: 'cat-view' }, [
    // ⚠️ THE WEIGHT BOX SITS DIRECTLY UNDER THE RECIPE, and it did not until now.
    // Federico, 23 Aug 2026, from a photograph of Brioche on his own phone: scaling
    // the batch is the thing this screen is opened FOR, and it was below the cost
    // card and a nine-line allergen card — two cards and a scroll away from the
    // ingredients it rewrites. Nothing depends on the order: the cost panel is
    // replaced in place, and the guided panel reads the weight through a closure
    // rather than off the DOM.
    el('div', { class: 'cat-detail-top' }, [
      catSection(t('cat.ingredients'), [ingList]),
      // ⚠️ THE WHOLE CARD GOES WHEN THE PANEL DOES. A recipe of pieces and «to taste»
      // has nothing to scale by weight, and a headed card standing empty reads as
      // something broken rather than as something that does not apply.
      batchCard,
      costHost,
      guidedCard,
    ]),
    el('div', { class: 'cat-detail-bottom' }, [
      importBtn,
      el('p', {
        class: 'cat-import-hint',
        text: t('cat.makesACopyYou'),
      }),
      deleteBtn,
    ]),
  ]);

  // ⚠️ WITHOUT THIS THE COST IS COMPUTED ONCE AND NEVER AGAIN. The ingredient
  // listener is still in flight while this screen is being opened — on a cold start,
  // offline, or simply a slow network — so the first paint can legitimately find no
  // prices at all. Computed once, the panel would say "no cost yet" for as long as
  // the screen stayed open, and the only way to see the real number would be to
  // leave and come back. It also keeps a price corrected in Orders, or the recipe
  // edited on another phone, from being a stale figure on an open screen.
  return {
    root,
    // ⚠️⚠️ THIS REBUILDS BOTH CARDS, AND THE ALLERGEN ONE IS WHY. It used to be
    // `costHost.replaceChildren(costPanel(...))` — one child, where the host holds
    // TWO — so the first data update to arrive while a recipe was open DELETED the
    // allergen card outright, with nothing on screen saying so. On the only screen in
    // this app that can send somebody to hospital, the line reading «not declared» —
    // or naming what the recipe contains — silently disappeared, and with it the way
    // to a label. Live from 11 Aug 2026 (v1.37.0) to 22 Aug 2026.
    //
    // ⚠️ IT WAS INVISIBLE TO EVERY CHECK BECAUSE OF *WHEN*: the card is present on the
    // first paint and destroyed by the NEXT snapshot, so anything that opens a recipe
    // and measures straight away — which is what every driven check did — sees it
    // there. Found by four independent reviewers reading the code, then reproduced by
    // editing the recipe from another connection with the screen open.
    //
    // ⚠️ AND REBUILDING IS RIGHT, NOT MERELY SAFE: an ingredient declared on another
    // phone must reach this screen. Leaving the card alone would fix the disappearance
    // and freeze the answer at whatever was known when the screen opened, which on
    // this screen is its own kind of wrong.
    refreshCost(latest) {
      const fresh = latest || recipe;
      // ⚠️ Carry the disclosure's state across the rebuild. Somebody reading the list
      // of rows still to declare must not have it shut under them because a price
      // arrived. Re-opened through the button's OWN handler so aria-expanded, the
      // class and the body's hidden attribute cannot drift apart.
      const openBefore = costHost.querySelector('.cat-alg-toggle')
        ?.getAttribute('aria-expanded') === 'true';
      // ⚠️ THE SAME FUNCTION THAT BUILT THEM. Listing the children here as well is how
      // the v1.60.1 defect happened: this call said one card and the host held two.
      const children = costHostChildren(fresh);
      costHost.replaceChildren(...children);
      if (openBefore) costHost.querySelector('.cat-alg-toggle')?.click();
    },
  };
}
