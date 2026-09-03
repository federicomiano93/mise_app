// label-view.js — the label itself, on screen.
//
// ⚠️ IT IS A DRAFT FOR A HUMAN TO CHECK, AND THE SCREEN SAYS SO ONCE, PLAINLY, AND
// NEVER SCROLLS IT AWAY. The app knows what it was told about its ingredients. It
// does not know what else was on the bench this morning, what was substituted
// when the van did not come, or that a supplier quietly changed a recipe. A
// screen that looks like a finished label without saying that is the one way this
// feature can do harm.
//
// The switch decides what is WORKED OUT, not merely what is displayed — see
// buildLabel(). Asking for allergens only does not compute a nutrition table that
// is then hidden, so an ingredient with no nutrition cannot block an allergen
// label.

import { t } from '../i18n.js';
import { copyToClipboard } from '../share.js';
import { chooseHowToSend } from '../send-sheet.js';
import { SEND_PATHS, svgElement } from '../send-icon.js';
import { el } from './dom.js';
import {
  buildLabel, ingredientLine, containsLine, declarationText, LABEL_SHOWS,
} from './recipe-label-model.js';
import {
  resolveLabel, sizeIdFor, DEFAULT_PROFILE, useByDate, dateText,
} from './label-template-model.js';
import { normalizeShelfLifeDays } from './catalogue-model.js';
import { fitSheet, fitPreviewWidth } from './label-print.js';
import { roadsFor, whyNoRoad } from './print-transports.js';
import { NUTRIENTS } from '../allergen-model.js';
import {
  canPrintLabel, countryOf, outputLanguage, labelWord, allergenName, nutrientName,
} from '../market.js';
import { allergensOn } from '../venue-features.js';

// ⚠️ KEYS, NOT WORDS, AND THE DIFFERENCE IS WHEN. This constant is evaluated when
// the module is first imported — before any venue is open — so a t() here would
// answer in the default language and keep that answer for the life of the page.
// That is the v1.57.0 defect, and it is what these three buttons had: «Allergens ·
// Nutrition · Both», in English, on a venue set to Italian. The lookup lives in
// paintSwitch(), which runs on every paint.
const SHOW_KEYS = Object.freeze({
  allergens: 'label.shows.allergens',
  nutrition: 'label.shows.nutrition',
  both: 'label.shows.both',
});

// A printer. Inline SVG like every other icon in this app — never an emoji, which
// is a font and draws a different picture on every operating system.
const PRINT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';

// `location` is the venue's own document — its country decides what language the
// label is PRINTED in. It is not a preference and no screen may override it; see
// js/market.js for the law behind that.
//
// ⚠️⚠️ THIS FILE IMPORTS t(), AND THE RULE THAT LETS IT IS SHARPER THAN THE ONE
// IT REPLACES. Until 13 Aug 2026 no label file could import the dictionary at
// all — a coarse ban, and a correct one while this file held nothing but the
// label. But the screen AROUND the label is ordinary interface: a Copy button, a
// caveat, the sentence explaining why a label cannot be made. Leaving those in
// English gave an Italian bakery one screen in the wrong language.
//
// So the ban was replaced, HERE ONLY, by the invariant it was standing in for:
//
//   the label's WORDS come from outputLanguage(location) — the country, the law
//   the screen's words come from t()                     — the interface
//
// `lang` below is assigned once, from outputLanguage(), and every labelWord /
// allergenName / nutrientName call is passed it. tests/i18n-label-separation.test.mjs
// pins exactly that, and pins that no label file may import currentLanguage or
// setLanguage — the two ways the interface could get into the label by accident.
// js/market.js and js/catalogue/recipe-label-model.js keep the total ban: they
// have no chrome, so it costs them nothing.

export function renderLabel({
  recipe, ingredients, recipesById, location, initialShows = 'both', onShowsChange,
  // ⚠️ A GETTER, read at paint time, for the same reason photoOn is one in
  // catalogue-main.js: the paper size is a venue setting somebody may change on
  // another device while this page is loaded.
  getProfile = () => DEFAULT_PROFILE,
  // ⚠️ GETTERS, both. Whether a shop computer is answering is a statement about
  // right now, and the paper is a setting somebody may change on another device.
  // Neither may be frozen when this screen was built.
  isPrinterReady = () => false,
  onQueue = null,
}) {
  const tables = { ingredients, recipes: recipesById };
  let shows = LABEL_SHOWS.includes(initialShows) ? initialShows : 'both';
  const lang = outputLanguage(location);

  const body = el('div', { class: 'lab-body' });
  const root = el('div', { class: 'cat-view lab-view' });
  // Set by paint(), re-run by mounted(). See the note where it is assigned.
  let measure = null;

  // ── The switch ──────────────────────────────────────────────────────────────
  const switcher = el('div', { class: 'lab-switch', role: 'group', 'aria-label': t('label.whatItShows') });
  const buttons = new Map();
  for (const key of LABEL_SHOWS) {
    const btn = el('button', {
      class: 'lab-switch-btn', type: 'button',
      onclick: () => { shows = key; paint(); if (onShowsChange) onShowsChange(key); },
    });
    buttons.set(key, btn);
    switcher.appendChild(btn);
  }
  root.appendChild(switcher);
  root.appendChild(body);

  function paintSwitch() {
    for (const [key, btn] of buttons) {
      const on = key === shows;
      btn.textContent = t(SHOW_KEYS[key]);
      btn.classList.toggle('lab-switch-btn--on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function paint() {
    paintSwitch();

    // ⚠️⚠️ NO ALLERGENS, NO LABEL. A venue can switch allergen tracking off
    // («Fornitori e ingredienti» → Impostazioni), and when it has, the way here is
    // already gone: the button lives inside the recipe's allergen card and that card
    // is not drawn. This is the belt to that brace, and it is on this file rather
    // than only on the door because of what this screen produces — a printed label
    // with no allergen line is worse than no label at all, and the next door
    // somebody adds will not remember to check.
    if (!allergensOn(location)) {
      body.replaceChildren(el('div', { class: 'lab-blocked' }, [
        el('p', { class: 'lab-blocked-title', text: t('label.blocked') }),
        el('p', { class: 'lab-blocked-text', text: t('label.blocked.allergensOff') }),
      ]));
      return;
    }

    // ⚠️⚠️ NO COUNTRY, NO LABEL — AND DELIBERATELY NOT A FALLBACK TO ENGLISH.
    // Every venue in production today is in the UK, so English would be right for
    // all of them and silently WRONG for the first Italian customer: an English
    // allergen label in Italy is not "a bit off", it is non-compliant. This is
    // the same shape as canLabel() refusing an undeclared recipe — the app would
    // rather say "I do not know" than print something that looks finished.
    if (!canPrintLabel(location)) {
      body.replaceChildren(el('div', { class: 'lab-blocked' }, [
        el('p', { class: 'lab-blocked-title', text: t('label.blocked') }),
        el('p', { class: 'lab-blocked-text', text: t('label.blocked.noCountry') }),
      ]));
      return;
    }

    const label = buildLabel(recipe, tables, { shows });

    if (!label.ok) {
      // ⚠️ This screen should not normally be reachable when the recipe is not
      // declared — the recipe panel says so and hides the way in. It is handled
      // anyway: a recipe can lose an ingredient's declaration on another phone
      // between opening the screen and reading it, and the honest answer then is
      // the refusal rather than a stale label.
      body.replaceChildren(el('div', { class: 'lab-blocked' }, [
        el('p', { class: 'lab-blocked-title', text: t('label.blocked') }),
        // ⚠️ A REAL PLURAL, not `n === 1 ?`. That ternary is English's rule
        // written into the code, and it cannot be translated by moving either half.
        el('p', { class: 'lab-blocked-text', text: label.reason === 'no-ingredients'
          ? t('label.blocked.noWeights')
          : t('label.blocked.notDeclared', { n: label.gaps.length }) }),
      ]));
      return;
    }

    const card = el('div', { class: 'lab-card' });
    card.appendChild(el('p', { class: 'lab-name', text: label.name || t('label.untitled') }));

    if (shows !== 'nutrition') {
      // ⚠️ THE ALLERGENS ARE EMPHASISED INSIDE THE LIST, not only summarised
      // underneath — that is what the regulation asks for, and it is also what a
      // person scanning a label actually reads.
      const list = el('p', { class: 'lab-ingredients' }, [`${labelWord('ingredients', lang)}: `]);
      label.ingredients.forEach((item, i) => {
        list.appendChild(el('span', {
          class: item.emphasise ? 'lab-ing lab-ing--allergen' : 'lab-ing',
          text: item.name,
        }));
        if (i < label.ingredients.length - 1) list.appendChild(document.createTextNode(', '));
      });
      list.appendChild(document.createTextNode('.'));
      card.appendChild(list);

      const contains = containsLine(label, lang);
      if (contains) card.appendChild(el('p', { class: 'lab-contains', text: contains }));
      if (label.mayContain.length) {
        card.appendChild(el('p', { class: 'lab-traces', text:
          `${labelWord('mayContain', lang)}: ${label.mayContain.map(c => allergenName(c, lang)).join(', ')}` }));
      }
    }

    if (shows !== 'allergens') {
      if (label.nutrition) {
        const table = el('table', { class: 'lab-nutrition' });
        const head = el('tr', {}, [
          el('th', { text: labelWord('typicalValues', lang) }),
          el('th', { class: 'lab-num', text: labelWord('per100g', lang) }),
        ]);
        table.appendChild(el('thead', {}, [head]));
        const tbody = el('tbody');
        for (const n of NUTRIENTS) {
          tbody.appendChild(el('tr', {}, [
            el('td', { text: nutrientName(n, lang) }),
            el('td', { class: 'lab-num', text: `${label.nutrition[n.key]} ${n.unit}` }),
          ]));
        }
        table.appendChild(tbody);
        card.appendChild(table);
        if (label.nutrition.lossPct > 0) {
          card.appendChild(el('p', { class: 'lab-yield', text:
            t('label.onFinishedWeight', { pct: label.nutrition.lossPct }) }));
        }
      } else {
        // ⚠️ SAID OUT LOUD. A label asked for nutrition that cannot be worked out
        // must not print the allergen half and look finished.
        card.appendChild(el('p', { class: 'lab-missing', text:
          t('label.noNutrition') }));
      }
    }

    // ── The paper, at its real size ─────────────────────────────────────────
    //
    // ⚠️ ABOVE THE READABLE CARD, NOT INSTEAD OF IT. They answer two questions and
    // both get asked: the preview says «this is what will come out of the printer»,
    // the card below says «this is the same thing, big enough to read and to copy».
    //
    // ⚠️ AND IT IS THE SAME NODE THE PRINTER GETS, built by the same function at the
    // same millimetre size (js/catalogue/label-print.js). A preview drawn separately
    // from the print is two labels that drift apart, and the one that drifts is the
    // one nobody looks at until it is stuck on food.
    const profile = getProfile();

    // ⚠️ THE DATE IS WORKED OUT FROM TODAY, EVERY TIME THIS SCREEN PAINTS. The recipe
    // knows how long the food keeps; only the morning knows when it was made. A date
    // stored on the recipe would be yesterday's the moment somebody came in.
    //
    // ⚠️ AND A RECIPE WITH NO SHELF LIFE PRODUCES NO DATE AT ALL — never today's.
    // useByDate() refuses a missing one rather than reading it as zero days, which
    // would print today as a USE BY on food that keeps for a week.
    const due = useByDate(normalizeShelfLifeDays(recipe && recipe.shelfLifeDays));
    const extras = {
      netWeightG: recipe && recipe.netWeightG,
      dateText: due ? dateText(due, lang) : '',
    };
    const resolved = resolveLabel(label, profile, extras, lang);

    // ⚠️ NO PAPER IS NOT NO SCREEN (P17). buildLabel() has already said this recipe
    // can be declared, so resolveLabel() refusing means something upstream changed
    // shape — and the right answer is the screen this file had before printing
    // existed, not a blank page. The card, the caveat, Copy and Send still work,
    // because copying the text is what works when nothing else does.
    if (!resolved.ok) {
      body.replaceChildren(card, languageNote(), caveat(), copyRow(label).root);
      return;
    }

    const preview = el('div', { class: 'lab-preview' });
    const previewNote = el('p', { class: 'lab-preview-note' });
    const noFit = el('p', { class: 'lab-nofit' });
    const actions = copyRow(label);

    body.replaceChildren(preview, previewNote, noFit, card, languageNote(), caveat(), actions.root);

    // ⚠️⚠️ MEASURED ONLY NOW, BECAUSE ONLY NOW IS IT IN THE DOCUMENT. Every width and
    // height a detached node reports is zero, and a fit check against zero says
    // «it fits» about everything. The estimate that chose the starting size ran
    // under Node, where nothing can measure text at all — this is the real answer,
    // and it is the one the Print button obeys.
    // ⚠️⚠️ THE MEASUREMENT LIVES IN ITS OWN FUNCTION SO IT CAN BE RUN AGAIN, AND
    // THAT IS NOT TIDINESS. paint() is called once from inside renderLabel(), BEFORE
    // the router has appended `root` to the page — and a detached node reports every
    // width as zero, which reads as «it fits» for every label ever made. So this runs
    // now (harmlessly, refusing to print because nothing could be measured) and again
    // from mounted(), where the numbers are real.
    measure = () => {
      const fitted = fitSheet(preview, resolved);

      // ⚠️ MEASURED FIRST, SCALED SECOND — see fitPreviewWidth(). And the sentence
      // underneath follows what actually happened: «actual size» is a claim, and on
      // a phone too narrow to hold 76 mm it would be a false one.
      const shownAt = fitted.measured ? fitPreviewWidth(preview, fitted.sheet) : 1;
      previewNote.textContent = t(
        shownAt < 1 ? 'label.preview.scaled' : 'label.preview.actualSize',
        { w: fmtMm(resolved.widthMm), h: fmtMm(resolved.heightMm) },
      );

      // ⚠️ FOUR REASONS, FOUR SENTENCES, IN THIS ORDER. «It will not fit» sends
      // somebody to buy bigger labels; «the shop computer is not answering» sends
      // them to switch it on; «this device cannot reach a printer» sends them to a
      // computer that can. One sentence for all of them sends most people to the
      // wrong place.
      //
      // ⚠️ AND THE VENUE'S PRINTER DECIDES WHICH ROADS EXIST, not only the device: a
      // road whose language this printer cannot read is how somebody ends up with a
      // page of ^XA codes on a sheet of A4.
      const printerReady = isPrinterReady() === true;
      const roads = roadsFor(resolved, { printerReady });

      // ⚠️⚠️ THE «NOT ANSWERING» LINE IS SHOWN EVEN WHEN A FALLBACK ROAD EXISTS, and
      // this is the part driving the app found. With the shop computer switched off,
      // a venue set to Zebra fell back in silence to «copy the printer code» — a
      // perfectly working button that is useless on a phone, offered INSTEAD of the
      // sentence explaining what had actually happened. A fallback may replace the
      // road; it may not replace the explanation.
      const tooBig = t('label.print.tooBig', {
        w: fmtMm(resolved.widthMm), h: fmtMm(resolved.heightMm),
      });
      // ⚠️ THE ZPL PATH HAS ITS OWN «DOES NOT FIT», and it is not the browser's: it
      // has no browser to measure with, so its estimate can refuse a label the screen
      // was happy to draw.
      const why = whyNoRoad(resolved, { printerReady });
      let message = null;
      if (fitted.measured && !fitted.fits) message = tooBig;
      else if (why === 'too-big-for-printer') message = tooBig;
      else if (resolved.printerLanguage === 'zpl' && !printerReady) {
        message = t('label.print.printerOffline');
      } else if (!roads.length) message = t('label.print.noRoad');

      noFit.hidden = !message;
      if (message) noFit.textContent = message;

      // ⚠️ THE BUTTON IS DISABLED, NOT HIDDEN. A missing button is a feature somebody
      // goes looking for; a disabled one beside the sentence explaining it is an
      // answer. And it is the MEASUREMENT that disables it, never the estimate — and
      // never an answer from a node nothing could measure.
      actions.printBtn.disabled = !fitted.measured || !fitted.fits || !roads.length;
      // ⚠️ THE BUTTON SAYS WHAT IT WILL DO. On a Zebra it copies ZPL rather than
      // opening a print dialog, and a button labelled «Stampa» that silently copies
      // is a button nobody trusts twice.
      actions.printBtn.lastChild.textContent = roads.length ? t(roads[0].labelKey) : t('label.print');
      actions.printBtn.onclick = async () => {
        const road = roads[0];
        if (!road || !fitted.measured || !fitted.fits) return;
        // ⚠️ THE BUTTON GOES DEAD WHILE THE JOB IS IN FLIGHT. Queueing is a network
        // round trip; two taps is two labels, and the second one is the one nobody
        // wanted.
        actions.printBtn.disabled = true;
        actions.status.textContent = '';
        let done = null;
        try {
          done = await road.send({
            resolved,
            sizeId: sizeIdFor(profile),
            fontMm: fitted.fontMm,
            queue: onQueue,
          });
        } finally {
          actions.printBtn.disabled = false;
        }
        // ⚠️ A ROAD THAT HANDS SOMETHING OVER HAS TO SAY IT DID. The print dialog is
        // its own receipt — it appears — but a copy to the clipboard, and a job put
        // in a queue, both look exactly like a button that did nothing.
        //
        // ⚠️⚠️ AND THE AGENT ROAD SAYS «SENT», NEVER «PRINTED». Raw bytes to a
        // printer come back with nothing at all, so the app cannot know the paper
        // came out and must not imply that it does.
        if (road.id === 'agent') {
          actions.status.textContent = (done && done.ok)
            ? t('label.print.queued') : t('label.print.queueFailed');
        } else if (road.renderer === 'zpl') {
          actions.status.textContent = (done && done.ok)
            ? t('label.print.zplCopied') : t('label.copyFailed');
        }
      };
    };
    measure();
  }

  // Millimetres as somebody writes them: «76», not «76.0», and «76.5» when it is.
  function fmtMm(n) {
    return String(Math.round(n * 10) / 10);
  }

  // ⚠️ IMMEDIATELY UNDER THE CARD, NOT AT THE END OF A SCROLL. Somebody printing
  // a label in an English bakery while reading an Italian interface has to be
  // able to see, without asking, that the English is on purpose — and the day the
  // interface switch ships (R2) that is exactly the question they will have.
  //
  // ⚠️ AND THE SECOND LINE IS WHAT THE APP CANNOT DO. Ingredient names are typed
  // by hand in Orders and are NOT translated: an Italian venue must type Italian
  // names, or the label reads "Contiene: Wheat" — half translated, which is worse
  // than either language whole. Saying so is the only honest option available.
  //
  // ⚠️⚠️ BOTH LINES ARE THE INTERFACE'S, AND UNTIL 23 Aug 2026 BOTH WERE FIXED
  // ENGLISH — they were built in js/market.js, which cannot import the dictionary.
  // So on a venue set to Italian the label came out correctly in Italian with two
  // English sentences underneath explaining why. Moving them here is what lets them
  // follow the reader while every word ON the label still follows the country.
  //
  // ⚠️ THE NAMES INSIDE THE SENTENCE COME FROM THE DICTIONARY TOO — «italiano», «in
  // Italia» — never from market.js. This is the mistake js/staff/language.js already
  // made and fixed: an Italian sentence with English words dropped into it.
  function languageNote() {
    return el('div', { class: 'lab-language' }, [
      el('p', { class: 'lab-language-line', text: t('label.languageNote', {
        language: t(`language.${lang}.inSentence`),
        country: t(`country.${countryOf(location)}.in`),
      }) }),
      el('p', { class: 'lab-language-line', text: t('label.ingredientNamesNote') }),
    ]);
  }

  function caveat() {
    return el('div', { class: 'lab-caveat' }, [
      el('p', { class: 'lab-caveat-title', text: t('label.caveat.title') }),
      el('p', { text: t('label.caveat.body') }),
    ]);
  }

  // Copying the plain text is the one thing that works whatever gets printed in
  // the end, and it costs nothing to offer now that printing is undecided. Beside it,
  // the same send arrow every other screen carries.
  //
  // ⚠️⚠️ WHAT IS COPIED AND WHAT IS SENT IS THE LABEL'S OWN TEXT, built by the model
  // and not here. The recipe card offers the identical text, and three screens each
  // assembling it is three texts that can come to disagree about what is in somebody's
  // food. declarationText() is the one builder, and it is pinned line for line.
  //
  // ⚠️ IT FOLLOWS THE VENUE'S COUNTRY, NOT THE SCREEN. A copy in English pasted onto
  // Italian packaging is the defect that rule exists to prevent, arriving through the
  // one door nobody thought of.
  function copyRow(label) {
    const status = el('span', { class: 'lab-copy-status' });
    const text = () => declarationText(label, lang);

    // ⚠️ FIRST IN THE ROW, because it is now what this screen is for. Copy and Send
    // were the whole of it while printing was undecided; they stay because they are
    // the only thing that works when there is no printer in the room.
    //
    // ⚠️ NO onclick HERE. paint() assigns it after the sheet has been MEASURED, and
    // disables the button when the label does not fit or this device has no way to
    // reach a printer. A button wired up before the measurement is a button that can
    // print an overflowing label.
    const printBtn = el('button', {
      class: 'cat-alg-sheet-btn lab-print-btn', type: 'button', icon: PRINT_ICON,
    }, [el('span', {}, t('label.print'))]);

    const copy = el('button', {
      class: 'cat-alg-sheet-btn lab-copy', type: 'button',
      onclick: async () => {
        // ⚠️ RACED, NOT AWAITED FOREVER — and by the one helper that owns the clock.
        // navigator.clipboard.writeText can hang indefinitely when the page is not
        // focused; it did exactly that on the client-ordering link in v251, leaving the
        // button dead and the person told nothing.
        status.textContent = await copyToClipboard(text())
          ? t('label.copied') : t('label.copyFailed');
      },
    }, [t('label.copy')]);
    const send = el('button', {
      class: 'cat-alg-sheet-btn lab-send', type: 'button',
      'aria-label': t('ui.send'),
      onclick: () => chooseHowToSend({ subject: label.name || '', text: text() }),
    }, [svgElement(SEND_PATHS, 18), el('span', {}, t('ui.send'))]);
    return {
      root: el('div', { class: 'lab-copy-row' }, [printBtn, copy, send, status]),
      printBtn,
      status,
    };
  }

  paint();
  // ⚠️ THE ROUTER MUST CALL THIS AFTER swap(). Until the node is in the document
  // nothing about it can be measured, and this screen refuses to print rather than
  // print on an answer it never got. catalogue-main.js openLabel() calls it.
  return { root, mounted: () => { if (measure) measure(); } };
}
