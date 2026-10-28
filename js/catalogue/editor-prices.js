// editor-prices.js — the venue's ingredient prices, read ONCE for the open recipe editor.
//
// Federico, 28 Oct 2026 (partly reversing 13 Sep 2026): the recipe editor marks a row Food
// cost cannot price, and that needs to know which ingredients HAVE a price. This is the
// only place the catalogue reads `ingredient-prices`, and the answer goes to unpriced-rows.js
// which turns it into booleans.
//
// ⚠️ ONE-SHOT getDocs, NOT A LISTENER. The editor has no teardown hook, so an onSnapshot
// opened here would stay attached for the life of the page. COST (P14): one read per priced
// ingredient (~65 documents) each time a recipe editor is opened — nothing while the
// catalogue is merely browsed.
//
// ⚠️ NEVER KEPT. The result is a plain map held by the caller for as long as the editor is
// open: not in catalogue-store.js, not in localStorage. Callers must ask only somebody who
// may read Food cost (catalogue-main.js); for anyone else the rules would refuse, so no
// request is made at all.
//
// On any failure (permission refused, offline with nothing cached) it resolves null and
// logs the error code only — no data, no message text — and the editor simply shows no marks.

import { pathFor } from '../location.js';
import { db, authReady } from './firebase-catalogue.js';
import {
  collection,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export async function readPricesForEditor() {
  try {
    await authReady;
    const snap = await getDocs(collection(db, pathFor('ingredient-prices')));
    const prices = {};
    snap.docs.forEach(d => { prices[d.id] = d.data(); });
    return prices;
  } catch (err) {
    console.warn('readPricesForEditor failed:', err && err.code ? err.code : 'unknown');
    return null;
  }
}
