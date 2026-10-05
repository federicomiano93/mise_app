// registry.js — «Fornitori»: who you buy from, and what you buy from them.
//
// This is what used to sit behind the gear on the Orders screen, under a word that
// was wrong for it. A supplier's phone number and an ingredient's allergens are not
// SETTINGS — they are the records this business keeps — and nobody looks for their
// suppliers behind an ⚙. Worse, «fornitori» meant two different things inside
// Orders: tapping a supplier on the Order tab opens its ORDER, tapping the same
// supplier in the panel opened its RECORD. Same list, same word, two destinations.
//
// So the records moved to a screen of their own, one tap from the Home. The gear
// keeps what really is a setting.
//
// ⚠️ NO ROLE GATE ANYWHERE ON THE WAY IN, and that is deliberate rather than an
// oversight. The old panel was open to everybody in the location on purpose
// (adding a supplier and correcting a typo are ordinary work); only the
// irreversible half — Delete — asks canManageHere(), and firestore.rules refuses
// it regardless of what this screen chooses to draw (P2). Gating the DOOR would
// wall off the allergen form behind it, which is the one screen in this app that
// can send somebody to hospital — the exact trap v1.62.0 cost.
//
// NAVIGATION — a stack, so Back is honest at every depth:
//
//   Ingredienti · Fornitori · Imballaggi     (the page itself)
//     └─ one supplier: its record + everything it sells
//          ├─ its form
//          └─ one ingredient's form
//
// Each level below the first is a full-screen .mgmt-overlay with the app's standard
// header (Back on the left, title centred) — the same pattern the supplier's order
// screen and the read-only product list already use.

import { t, onLanguageChange } from '../i18n.js';
import { supplierLabel, supplierMatches } from '../supplier-label.js';
import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { isTabletNow, watchTablet } from './tablet-layout.js';
import { snapshotFields, snapshotChanged } from '../form-dirty.js';
import { removeLevel } from './level-stack.js';
import { buildSearchBox } from './search-box.js';
import { dayShort } from './suppliers.js';
import { NO_SUPPLIER_ID } from './no-supplier.js';
import { ingredientDisplayName } from '../ingredient-name.js';
import { formatPricePerUnit } from '../price-model.js';
import { allergenState } from '../allergen-model.js';
// Food or packaging? From js/ root: Food cost and the Catalogue ask the same question.
import { isPackaging } from '../ingredient-kind.js';
// ⚠️ THE TWO CARDS LIVE IN js/ ROOT since 13 Sep 2026, because the Catalogue opens them too.
// This screen still decides everything around them: the overlay, the navigation, and — for
// the ingredient card — whether the price is drawn and which panels the venue uses.
import { buildIngredientForm } from '../ingredient-record-form.js';
import { itemWithPrice, needsPriceRead } from '../ingredient-edit-model.js';
import { buildSupplierForm } from '../supplier-record-form.js';
import { mayWritePrices } from './firebase-orders.js';
// ⚠️ A FEATURE SWITCH, NOT A ROLE GATE, and the difference is why this may sit in a
// file that is forbidden to ask canManageHere(). It answers «does this venue track
// allergens at all», which is the same answer for everybody standing in the building.
import { ingredientPanels, setIngredientPanel, setPackPhoto } from './firebase-features.js';
import { renderPackPhotoCapture } from './photo-capture.js';
import { buildMergeChooser, runMergeFlow } from './ingredient-merge-screen.js';
import { buildRegistrySettings } from './registry-settings.js';
import {
  BACK_ICON, mgmtRow,
} from './mgmt-ui.js';

// data:    { suppliers(): [], ingredients(): [], categories(current): [], orderUnits(current): [],
//            packs(current): [], categoriesLoaded(): boolean, pricesLoaded(): boolean,
//            readPrice(id): Promise<price doc | null> } — live getters; categories,
//            orderUnits and packs are the words the ingredient card's menus offer (orderUnits only
//            for the card of before, which an old stored price shape opens)
// actions: { saveSupplier, saveIngredient, priceHistory, setSupplierActive,
//            setIngredientActive, deleteSupplier, deleteIngredient, deleteCategory(list, ids) }
// hooks:   { onChrome({ addLabel }) } — told on every paint which word the page
//            header's «+» should carry, because it follows the active tab.
//          { pane } — the element beside the list where a level opens on a TABLET
//            (suppliers.html #registry-pane). Absent = every level is full screen.
// -> { node, refresh(), openSettings(), addCurrent(), askBeforeLeaving(), leaveWouldAsk() }
export function buildRegistry(data, actions, hooks = {}) {
  // ⚠️ INGREDIENTS FIRST, AND THAT IS THE POINT OF THE SCREEN. Federico: «adesso quando
  // apro la schermata vedo prima i fornitori, invece voglio vedere prima gli
  // ingredienti». The backlog says why — 67 ingredients, 0 declared: this list IS the
  // work, the supplier list is the occasional errand.
  // ⚠️ THREE THINGS MOVE TOGETHER OR IT IS WORSE THAN NOT MOVING THEM: this default, the
  // DOM order of the buttons, and which one is built already `active`. paintChrome()
  // recomputes `active` from `tab` on every paint, so a default changed alone lights the
  // wrong tab on the FIRST FRAME — a flash on every open.
  let tab = 'ingredients';        // 'ingredients' | 'packaging' | 'suppliers'
  let query = '';                 // the search text for that list
  // Everything above the page itself. Each entry is { view, overlay }; Back pops one.
  const stack = [];
  // The tablet's right-hand pane, its placeholder, and each overlay's own Back.
  const pane = hooks.pane || null;
  let paneEmpty = null;
  const backOf = new WeakMap();

  const listHost = el('div', { class: 'reg-list-host' });

  // ── The switch ──────────────────────────────────────────────────────────────
  // A .view-switch, not a .tab-bar, and the same control the Order tab already uses:
  // these are windows onto ONE set of records, not different sections.
  // ⚠️⚠️ THE WORDS ARE NOT PUT ON THESE BUTTONS HERE, and that is the whole point.
  // registry-main.js calls buildRegistry() at MODULE LOAD — before a venue is open, so
  // before the app knows which language it speaks. A t() on this line answers in the
  // starting language and keeps that answer for the life of the page: the labels
  // read «Suppliers · All ingredients» on an Italian screen, in the app's own words,
  // for as long as it stayed open. Caught by driving it, not by reading it.
  //
  // ⚠️ AND IT IS THE EIGHTH SHAPE OF THAT DEFECT. tests/frozen-phrases.test.mjs looks
  // for a top-level CONST that calls t(); these calls sit inside a function, which is
  // normally the fix — except the function itself is called at module load. paintChrome()
  // below runs on every repaint instead, which is after the language is known.
  const ingredientsBtn = el('button', {
    type: 'button', class: 'view-switch-btn active', role: 'tab', 'aria-selected': 'true',
    onClick: () => setTab('ingredients'),
  });
  // «Imballaggi» (Federico, 13 Sep 2026): «imballaggi è una sezione che deve essere
  // aggiunta in fornitori ed ingredienti perché in questo momento non abbiamo da nessuna
  // parte una sezione imballaggi». Beside the ingredients: the same kind of record, bought
  // from the same suppliers, priced and ordered the same way.
  const packagingBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'tab', 'aria-selected': 'false',
    onClick: () => setTab('packaging'),
  });
  const suppliersBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'tab', 'aria-selected': 'false',
    onClick: () => setTab('suppliers'),
  });
  // Order on screen: Ingredients · Suppliers · Packaging (30 Sep 2026; the buttons are
  // still BUILT in the order above, only the switch is arranged differently).
  // ⚠️ Ingredients on the LEFT and lit, matching the `tab` default above.
  const viewSwitch = el('div', { class: 'view-switch', role: 'tablist' }, [ingredientsBtn, suppliersBtn, packagingBtn]);

  // An address can ask for the packaging list (suppliers.html#packaging) — Food cost's
  // packaging chooser sends somebody here when there is nothing to choose yet. Applied
  // before the first paint below, so the right tab is lit from the first frame.
  if (typeof location !== 'undefined' && location.hash === '#packaging') tab = 'packaging';

  // MOUNTED ONCE, ROWS REPAINTED — the same arrangement as the supplier list and
  // the flat ingredient list on the Order tab. A live snapshot from another phone
  // must never rip the search box out from under the finger typing into it.
  // Placeholder deliberately left empty here too — paintChrome() fills it.
  const search = buildSearchBox({
    value: query,
    // Stored immediately so an external refresh() keeps the text; the repaint is
    // the debounced half.
    onInput: text => { query = text; },
    onChange: paintList,
  });

  function setTab(next) {
    if (tab === next) return;
    tab = next;
    // Clear the search when switching, so one list's query never filters the other.
    query = '';
    search.input.value = '';
    paintList();
  }

  // Every word that is not a row: the switch labels and the search placeholder.
  // Called from paintList(), so it runs again on every live snapshot AND after the
  // venue's language has arrived — see the note on the buttons above.
  function paintChrome() {
    suppliersBtn.textContent = t('orders.tab.suppliers');
    packagingBtn.textContent = t('orders.tab.packaging');
    ingredientsBtn.textContent = t('ui.ingredients');
    viewSwitch.setAttribute('aria-label', t('orders.registry.whichList'));
    [[suppliersBtn, tab === 'suppliers'], [packagingBtn, tab === 'packaging'], [ingredientsBtn, tab === 'ingredients']]
      .forEach(([btn, on]) => {
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
      });
    const ph = tab === 'suppliers' ? t('orders.searchASupplier')
      : tab === 'packaging' ? t('orders.searchPackaging')
        : t('orders.searchAnIngredient');
    search.input.placeholder = ph;
    // buildSearchBox copies the placeholder into aria-label at build time, when there
    // was none — so a screen reader would announce an unlabelled field (P18).
    search.input.setAttribute('aria-label', ph);
    hooks.onChrome?.({ addLabel: addLabel() });
  }

  // ── «Add», from the page header ─────────────────────────────────────────────
  // ⚠️ THE HEADER «+» AND THE EMPTY-STATE BUTTON CALL THIS ONE FUNCTION, so they can
  // never add different things. It follows the active tab. ⚠️ NO PERMISSION CHECK, on
  // purpose and exactly as before: the dashed button it replaces had none (see the note
  // at the top of this file — adding and correcting are ordinary work, and only Delete
  // asks canManageHere()). Do not add one here.
  function addCurrent() {
    openFromList(() => {
      if (tab === 'suppliers') openSupplierForm(null);
      else openIngredientForm(null, null, tab === 'packaging' ? 'packaging' : 'ingredient');
    });
  }

  function addLabel() {
    return t(tab === 'suppliers' ? 'orders.add.supplier'
      : tab === 'packaging' ? 'orders.add.packaging' : 'orders.add.ingredient');
  }

  // The screen-level empty state (tokens.css): what is missing, one sentence on why it
  // matters, and the same action the header «+» carries.
  function emptyState(which) {
    return el('div', { class: 'empty-state' }, [
      el('p', { class: 'empty-title', text: t(`orders.empty.${which}.title`) }),
      el('p', { class: 'empty-sub', text: t(`orders.empty.${which}.sub`) }),
      el('button', { class: 'empty-action', type: 'button', text: addLabel(), onClick: addCurrent }),
    ]);
  }

  // ⚠️ THE SWITCH AND THE SEARCH STAY PUT WHILE THE LIST SCROLLS (Federico, 29 Sep 2026:
  // «la fascia ingredienti, fornitori e imballaggi più la barra di ricerca devono restare
  // fisse quando scorro giù»). One wrapper, so the two stick together; orders.css
  // .reg-sticky-head gives it the opaque ground rows slide under.
  const head = el('div', { class: 'reg-sticky-head' }, [viewSwitch, search.node]);
  const node = el('div', {}, [head, listHost]);

  // ── The lists ───────────────────────────────────────────────────────────────
  function paintList() {
    paintChrome();
    listHost.replaceChildren();
    if (tab === 'suppliers') paintSuppliers();
    else paintItems(tab === 'packaging' ? 'packaging' : 'ingredient');
    paintSelection();
    paintPane();
  }

  function matches(name) {
    const q = query.trim().toLowerCase();
    return !q || String(name || '').toLowerCase().includes(q);
  }

  // A supplier is found by its invoice name AND by the short name the list shows.
  function matchesSupplier(s) {
    return supplierMatches(s, query.trim().toLowerCase(), v => String(v || '').toLowerCase());
  }

  function paintSuppliers() {
    const all = data.suppliers().slice().sort((a, b) => supplierLabel(a).localeCompare(supplierLabel(b)));
    const visible = all.filter(matchesSupplier);

    if (!all.length) {
      listHost.appendChild(emptyState('suppliers'));
      return;
    }
    if (!visible.length) {
      listHost.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noSupplierMatchesYour') }));
      return;
    }

    // ⚠️ THE ROW OPENS THE SUPPLIER, IT DOES NOT OPEN A FORM. That is the whole
    // point of this screen existing: one level at a time, so what a supplier SELLS
    // is reachable without going through its address details first.
    const list = el('div', { class: 'mgmt-list' });
    const counts = countBySupplier();
    visible.forEach(s => list.appendChild(drillRow(
      supplierLabel(s),
      // ⚠️ THE PLURAL IS IN THE DICTIONARY, never an `if` here: Italian and English
      // do not agree about when one form becomes the other, and a ternary in code
      // is a plural rule that only speaks English.
      [s.category, t('orders.productsCount', { n: counts[s.id] || 0 })].filter(Boolean).join(' · '),
      s.active !== false,
      () => openFromList(() => openSupplier(s.id), `supplier:${s.id}`),
      `supplier:${s.id}`,
    )));
    listHost.appendChild(list);
  }

  // Every ingredient — or every piece of packaging — A–Z, whoever sells it. ⚠️ NOT A
  // CONVENIENCE — it is the screen for going down a list of sixty-seven and declaring
  // each one. Doing that supplier by supplier means remembering which ones are done.
  //   kind: 'ingredient' | 'packaging'
  function paintItems(kind) {
    const packaging = kind === 'packaging';
    const supById = {};
    data.suppliers().forEach(s => { supById[s.id] = supplierLabel(s); });
    const all = data.ingredients().filter(i => isPackaging(i) === packaging)
      .sort((a, b) => ingredientDisplayName(a).localeCompare(ingredientDisplayName(b)));
    const visible = all.filter(i => matches(i.name) || matches(i.shortName));

    if (!all.length) {
      listHost.appendChild(emptyState(packaging ? 'packaging' : 'ingredients'));
      return;
    }
    if (!visible.length) {
      listHost.appendChild(el('p', { class: 'mgmt-empty', text: packaging ? t('orders.noPackagingMatches') : t('orders.noIngredientMatchesYour') }));
      return;
    }

    const list = el('div', { class: 'mgmt-list' });
    // ⚠️ `?? ''`, NEVER undefined: undefined is what a supplier's OWN screen passes to mean
    // «do not name the supplier». An item with no supplier (or a deleted one) matched no
    // entry here, read as undefined, and was drawn as if on its supplier's screen — no
    // «No supplier», and a «Packaging» tag on the packaging list. Found driving it.
    visible.forEach(i => list.appendChild(ingredientRow(i, supById[i.supplierId] ?? '')));
    listHost.appendChild(list);
  }

  // How many products each supplier has. Built once per paint rather than filtered
  // per row: with 67 ingredients and 10 suppliers the per-row version is 670 passes
  // for a number that changes only when the data does.
  function countBySupplier() {
    const out = {};
    data.ingredients().forEach(i => {
      const key = i.supplierId || NO_SUPPLIER_ID;
      out[key] = (out[key] || 0) + 1;
    });
    return out;
  }

  // A row that DRILLS IN: the whole row is the button, and it carries a chevron
  // saying so. Distinct from mgmtRow, whose row is inert and whose actions are the
  // links at its right-hand end.
  // `selKey` ('supplier:<id>' | 'ingredient:<id>') is what paintSelection() matches to mark
  // the row that is open in the tablet's pane; a row without one is never marked.
  function drillRow(name, meta, active, onOpen, selKey = null) {
    return el('button', {
      type: 'button',
      class: 'mgmt-item reg-drill' + (active ? '' : ' inactive'),
      'data-sel': selKey,
      onClick: onOpen,
    }, [
      el('div', { class: 'mgmt-item-main' }, [
        el('span', { class: 'mgmt-item-name', text: name }),
        el('span', { class: 'mgmt-item-meta', text: meta }),
      ]),
      el('span', { class: 'reg-chevron', 'aria-hidden': 'true', icon: CHEVRON_SVG }),
    ]);
  }

  // ⚠️ THE ALLERGEN STATE IS ON THE ROW, and it is the only reason this list can
  // guide anybody through sixty-seven of them. Without it the list says which
  // ingredients exist; with it, it says which ones still have no answer.
  // `supplierName` is undefined ON A SUPPLIER'S OWN SCREEN, where naming the supplier
  // again would be noise.
  //
  // ⚠️ AND «undefined» MUST NOT FALL THROUGH TO «No supplier». The first draft did
  // `supplierName || t('orders.noSupplier')`, so every product on Aldo's own screen
  // said «Nessun fornitore» — a plain lie, on the screen that exists to say whose it
  // is. Found by looking at a screenshot after 34 driven checks had passed.
  function ingredientRow(item, supplierName) {
    const meta = [
      // On a supplier's own screen both kinds share one list, so packaging says so.
      supplierName === undefined && isPackaging(item) ? t('orders.packagingTag') : null,
      supplierName === undefined ? null : (supplierName || t('orders.noSupplier')),
      item.brand,
      formatPricePerUnit(item) || null,
    ].filter(Boolean).join(' · ');

    // A row on the LIST (it names its supplier, even as «No supplier») replaces what the pane
    // holds; a row on a supplier's own screen — supplierName undefined, itself in the pane —
    // opens its card ABOVE that screen, as on a phone.
    const onList = supplierName !== undefined;
    const row = drillRow(ingredientDisplayName(item), meta, item.active !== false,
      () => (onList ? openFromList(() => openIngredientForm(item, null), `ingredient:${item.id}`) : openIngredientForm(item, null)),
      onList ? `ingredient:${item.id}` : null);
    // ⚠️ A WORD, NEVER A COLOUR ALONE (P18, and the v1.63.0 rule). «Not declared»
    // and «contains none of the 14» look identical as an empty allergen list, and
    // only the verification stamp tells them apart.
    //
    // ⚠️ AND IT GOES WITH THE FEATURE. A venue that does not track allergens must not
    // be told that sixty-seven of its products are «non dichiarato» — that is a job
    // list for work it has decided not to do, pointing at a form it can no longer
    // open. Read per row rather than captured per paint: the switch can be thrown
    // while this screen is open.
    // ⚠️ AND NEVER ON PACKAGING: a box has no allergens to declare.
    if (!isPackaging(item) && ingredientPanels().allergens && allergenState(item) === 'unknown') {
      row.querySelector('.mgmt-item-main').appendChild(
        el('span', { class: 'reg-flag', text: t('orders.notDeclaredShort') }));
    }
    return row;
  }

  // ── One supplier ────────────────────────────────────────────────────────────
  function openSupplier(id) {
    push((entry) => {
      const supplier = data.suppliers().find(s => s.id === id);
      // It can be gone: another phone may have deleted it while this was open.
      if (!supplier) { popEntry(entry); return null; }

      const body = el('div', { class: 'mgmt-scroll' });

      // Its own record, with the three actions. mgmtRow rather than a bespoke card:
      // Delete is gated inside it, and a second implementation of that gate is a
      // second place for it to be forgotten.
      const days = (list) => (list || []).map(dayShort).join(', ');
      // The invoice name stays in sight here, on its own screen, once a shorter one is shown
      // everywhere else — the one place it is still needed, to match a delivery note.
      const invoiceName = supplierLabel(supplier) !== supplier.name ? supplier.name : ''; // invoice name, on purpose
      const meta = [
        invoiceName,
        supplier.category,
        supplier.deliveryDays?.length ? `${t('orders.deliveryShort')} ${days(supplier.deliveryDays)}` : '',
        supplier.orderDays?.length ? `${t('orders.orderShort')} ${days(supplier.orderDays)}` : '',
        supplier.phone,
        supplier.email,
      ].filter(Boolean).join(' · ');

      body.appendChild(el('div', { class: 'mgmt-list' }, [
        mgmtRow(supplierLabel(supplier), meta, supplier.active !== false,
          () => openSupplierForm(supplier),
          () => actions.setSupplierActive(supplier.id, supplier.active === false),
          // ⚠️ AFTER DELETING, STEP BACK OUT. Staying on the screen of something
          // that no longer exists leaves a Back arrow as the only way off a page
          // about nothing — and the next repaint would pop it anyway, which looks
          // like the app closing by itself.
          async () => { await actions.deleteSupplier(supplier.id); popEntry(entry); }),
      ]));

      const mine = data.ingredients()
        .filter(i => (i.supplierId || NO_SUPPLIER_ID) === supplier.id)
        .sort((a, b) => ingredientDisplayName(a).localeCompare(ingredientDisplayName(b)));

      body.appendChild(el('h3', { class: 'mgmt-section-title', text: t('orders.whatTheySell') }));
      // ⚠️ NO ADD BUTTONS ON THIS SCREEN (2 Oct 2026, Federico: «one + only»). A new ingredient or
      // packaging is added from the Ingredienti / Imballaggi tab with the header «+»; this screen is
      // opened from the Fornitori tab, where that «+» adds a supplier, so the empty text says where to go.

      if (!mine.length) {
        body.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noIngredientsYetAddPlus') }));
      } else {
        const list = el('div', { class: 'mgmt-list' });
        mine.forEach(i => list.appendChild(ingredientRow(i)));
        body.appendChild(list);
      }

      return overlay(entry, supplierLabel(supplier), body);
    }, { selects: `supplier:${id}` });
  }

  // ── The supplier's own form ─────────────────────────────────────────────────
  //   onSaved({ id, name }) — told once the supplier is stored (the ingredient card's
  //                           «+ Nuovo fornitore» selects it)
  //   onClosed()            — told when somebody backs out without saving
  function openSupplierForm(item, { onSaved = null, onClosed = null } = {}) {
    push((entry) => {
      const close = () => { popEntry(entry); onClosed?.(); };
      const form = buildSupplierForm({
        item,
        save: actions.saveSupplier,
        onDone: (saved) => { popAfterSave(entry); onSaved?.(saved); },
      });
      const body = el('div', { class: 'mgmt-scroll' }, [form]);
      return overlay(entry, item ? t('orders.editSupplier') : t('orders.newSupplier'), body, close, form.headerSave);
    });
  }

  // «+ Nuovo fornitore» from inside an ingredient's card. The supplier card opens ABOVE it,
  // and the ingredient card stays mounted and untouched underneath — refresh() never redraws
  // a .mgmt-form — so everything typed there is still there. Resolves with { id, name } once
  // the supplier is saved, or with null if they backed out.
  function createSupplier() {
    return new Promise(resolve => openSupplierForm(null, { onSaved: resolve, onClosed: () => resolve(null) }));
  }

  // ── One ingredient's form ───────────────────────────────────────────────────
  //   presetKind: 'packaging' when added from the packaging list
  //
  // ⚠️⚠️ AN EXISTING INGREDIENT OPENS ONLY WITH ITS PRICE (5th review of PR #254, 2 Oct 2026). The prices
  // are a second live collection and can arrive AFTER the ingredients: a card opened in that moment shows
  // empty price boxes, and an untouched Save writes «no price» over the stored one — the card erasing
  // what it failed to show. So, while the live prices have not answered, the price document is read first
  // (the same guard Orders' openIngredientEdit uses, js/ingredient-edit-model.js). A read that fails opens
  // NOTHING: the failure is said, and nothing can be saved over a price nobody saw.
  // ⚠️ AND FROM THE LIST AS IT IS NOW, NEVER FROM THE ROW'S OWN COPY (6th review, 2 Oct 2026): a row keeps
  // the object it was drawn with, and a supplier's screen under an open card is not redrawn — so a row drawn
  // before the prices arrived would open a card with no price after they had (or with an old one).
  let opening = false;
  async function openIngredientForm(item, presetSupplierId, presetKind = null) {
    const current = item ? (data.ingredients().find(i => i.id === item.id) || item) : item;
    let shown = current;
    if (current && needsPriceRead({ mayPrice: mayWritePrices(), pricesLoaded: data.pricesLoaded?.() === true })) {
      if (opening) return;           // a second tap while the price is on its way
      opening = true;
      try {
        shown = itemWithPrice(current, await data.readPrice(current.id));
      } catch (err) {
        console.error('The ingredient card could not read its price:', err);
        await alertDialog(t('orders.addIngredientFailed'));
        return;
      } finally {
        opening = false;
      }
    }
    return showIngredientForm(shown, presetSupplierId, presetKind);
  }

  function showIngredientForm(item, presetSupplierId, presetKind = null) {
    return push((entry) => {
      const form = buildIngredientForm({
        item,
        suppliers: data.suppliers(),
        preset: presetSupplierId,
        presetKind,
        // The menus' words, from the page's live data — the card imports no feature code.
        categories: data.categories?.(item?.category) || [],
        orderUnits: data.orderUnits?.(item?.unit) || [],
        packs: data.packs?.(item?.packUnit) || [],
        // ⚠️ DECIDED HERE AND HANDED IN, since the card moved to js/ root: whether the
        // price is drawn (the role AND Food cost — see mayWritePrices) and which panels
        // this venue uses. The card itself reads neither.
        mayPrice: mayWritePrices(),
        panels: ingredientPanels(),
        // ⚠️ THE PHOTO SCREEN IS HANDED IN AS AN ACTION, not imported by the form.
        // The form then knows nothing about overlays and this file stays the only
        // one that navigates — the same seam saveIngredient and priceHistory use.
        // ⚠️ `openMerge` ONLY FOR AN EXISTING INGREDIENT (never packaging) AND ONLY WHEN registry-main.js says this
        // person may merge (`mergePacks`, a getter like `deleteIngredient`: owner or manager with Food cost).
        actions: {
          ...actions,
          capturePackPhoto,
          packPhotoOn: () => ingredientPanels().packPhoto,
          createSupplier,
          ...(item && !isPackaging(item) && actions.mergePacks ? { openMerge: () => openMergeChooser(item, entry) } : {}),
        },
        onDone: () => popAfterSave(entry),
      });
      const body = el('div', { class: 'mgmt-scroll' }, [form]);
      const packaging = item ? isPackaging(item) : presetKind === 'packaging';
      const title = packaging
        ? (item ? t('orders.editPackaging') : t('orders.newPackaging'))
        : (item ? t('orders.editIngredient') : t('orders.newIngredient'));
      return overlay(entry, title, body, undefined, form.headerSave);
    }, { selects: item ? `ingredient:${item.id}` : null });
  }

  // ── «Unisci un'altra confezione…» ───────────────────────────────────────────
  // A level ABOVE the ingredient's card (which stays mounted underneath, like the photo screen): the list of the
  // supplier's other ingredients, then the flow of ingredient-merge-screen.js. Back steps up one level (P20).
  // ⚠️ TYPING IN THE CARD IS NEVER LOST: with edits not saved yet it refuses to start, because after a merge the
  // card is closed and opened again on the merged history.
  let merging = false;
  async function openMergeChooser(a, cardEntry) {
    if (entryDirty(cardEntry)) { await alertDialog(t('orders.merge.saveFirst')); return; }
    push((entry) => {
      entry.keepAlive = true;   // refresh() must not rebuild the list under a typed search
      const body = buildMergeChooser({
        a,
        list: () => data.ingredients(),
        onPick: (b) => mergeInto(a, b, entry, cardEntry, body),
      });
      return overlay(entry, t('orders.merge.title'), body);
    });
  }

  async function mergeInto(a, b, chooserEntry, cardEntry, chooserBody) {
    if (merging) return;           // a second tap while the first is being checked or written
    merging = true;
    // While the batches are written the list is disabled and Back too (a level closed mid-write would hide the
    // «half way» message), and the status line says what is going on.
    const back = chooserEntry.overlay?.querySelector('.orders-header .orders-icon-btn');
    const onBusy = (message) => {
      chooserBody?.setBusy?.(message);
      if (back) back.disabled = Boolean(message);
    };
    try {
      const stored = data.ingredients().find(i => i.id === b.id) || b;
      if (await runMergeFlow({ a, b: stored, onBusy }) !== 'merged') return;
      popEntry(chooserEntry);
      popEntry(cardEntry);
      // The card of A again, on the merged history, with the one word that says it worked. ⚠️ THE STATUS GOES IN
      // EMPTY and gets its words on the next frame: a live region announces a CHANGE, never text it was born with.
      const reopened = await openIngredientForm(a, null);
      const done = el('p', { class: 'orders-status ok', role: 'status', 'aria-live': 'polite' });
      reopened?.overlay?.querySelector('.mgmt-scroll')?.prepend(done);
      requestAnimationFrame(() => { done.textContent = t('orders.merge.done'); });
    } finally {
      merging = false;
    }
  }

  // ── Photograph the packet ───────────────────────────────────────────────────
  //
  // Resolves with { text, notes } once the reader has answered, or null if the person
  // backed out. ⚠️ IT ALWAYS RESOLVES: a promise handed to a form and never settled
  // leaves the button that opened it disabled for the life of that form.
  //
  // ⚠️⚠️ THE FORM STAYS MOUNTED UNDERNEATH, UNTOUCHED, and that is the whole reason
  // this is an overlay rather than a swap. The Catalogue's copy of this feature needs a
  // one-shot «come back to the editor» marker, a leave-guard drop and a «replace what
  // you typed?» dialog — all of it because its swap() DESTROYS the editor. Here
  // refresh() explicitly leaves a .mgmt-form alone, so backing out returns to the form
  // with every character still in it. None of that machinery is copied.
  function capturePackPhoto() {
    return new Promise((resolve) => {
      let mine = null;
      let settled = false;
      let disposeCapture = null;
      // The ONE funnel every way out goes through (the reader's answer, Back, and the
      // pane being cleared all end here), so the screen's language listener and its
      // photographs are released exactly once.
      const settle = (value) => {
        if (settled) return;
        settled = true;
        popEntry(mine);
        disposeCapture?.();
        resolve(value);
      };
      push((entry) => {
        mine = entry;
        entry.keepAlive = true;   // refresh() must not rebuild this screen
        const { root, dispose } = renderPackPhotoCapture({
          onText: (text, notes) => settle({ text, notes }),
        });
        disposeCapture = dispose;
        return overlay(
          entry,
          t('orders.pack.photo.title'),
          el('div', { class: 'mgmt-scroll' }, [root]),
          () => settle(null),
        );
      });
    });
  }

  // ── The two switches ────────────────────────────────────────────────────────
  //
  // ⚠️ REACHED FROM THE GEAR IN THE PAGE HEADER, which registry-main.js hides from
  // anybody who is not an owner or a manager — and the server refuses the change
  // regardless of what this page draws (P2).
  //
  // ⚠️ IT LIVES ON THIS SCREEN AND NOT IN THE CATALOGUE'S SETTINGS, though the
  // catalogue is where most of what it hides is READ. A venue can have Orders and no
  // Catalogue — the restaurant does, today — and putting the switch there would leave
  // that venue with the allergen form and no way to switch it off. This is also where
  // Federico asked for it: «il settings degli ingredienti».
  function openSettings() {
    push((entry) => overlay(entry, t('ui.settings'), buildRegistrySettings({
      panels: ingredientPanels(),
      // Read at the moment the screen is built — and it IS rebuilt by refresh() on every
      // snapshot, so the list and the counts are always the live ones.
      categories: () => data.categories?.() || [],
      categoriesReady: () => data.categoriesLoaded?.() !== false,
      ingredients: () => data.ingredients(),
      onDeleteCategory: (list, ids) => actions.deleteCategory(list, ids),
      onSet: async (key, on) => {
        // ⚠️ TWO CALLABLES, ROUTED BY KEY. setIngredientPanels writes two fields whose
        // absence means YES; setPackPhoto writes one whose absence means NO, because it
        // spends money. Sending the third through the first would put a money switch on
        // the safety switch's code path, where a missing value reads as ON.
        if (key === 'packPhoto') await setPackPhoto(on);
        else await setIngredientPanel(key, on);
        // The rows behind the overlay carry the «non dichiarato» flag, so they are
        // wrong the moment the switch moves.
        paintList();
      },
    })), { fullScreen: true });
  }

  // ── The overlay stack ───────────────────────────────────────────────────────
  // `onBack` defaults to pop. It is a parameter because ONE caller has to know that
  // its screen was left WITHOUT an answer: capturePackPhoto() below hands a promise to
  // the form it came from, and a Back that only popped would leave that promise pending
  // for ever — with the button that opened it disabled for the life of the form, and
  // nothing on screen saying why.
  // `headerAction` (optional) is the level's ONE Save, drawn in the header's right-hand slot: the record
  // forms own the button (they disable it while a write runs) and hand it up as `form.headerSave`.
  function overlay(entry, title, body, onBack = () => popEntry(entry), headerAction = null) {
    const node = el('div', { class: 'mgmt-overlay' }, [
      el('header', { class: 'app-header orders-header' }, [
        el('span', { class: 'app-header-slot' }, [
          el('button', { type: 'button', class: 'app-icon-btn orders-icon-btn', 'aria-label': t('ui.back'), icon: BACK_ICON, onClick: () => guardedLeave(entry, onBack) }),
        ]),
        el('div', { class: 'app-header-title orders-header-title' }, [el('h1', { text: title })]),
        el('span', { class: 'app-header-slot' }, headerAction ? [headerAction] : []),
      ]),
      body,
    ]);
    // ⚠️ THE UNGUARDED close is what is remembered: the pane's own replace / leave paths have
    // already asked once for the whole pane (paneDirty), and asking again per level would be twice.
    // Remembered so clearing the pane can leave a level THE WAY ITS OWN BACK DOES: the
    // photo screen and the supplier card above an ingredient hand a promise to the form
    // beneath, and a plain removal would leave that promise pending for ever.
    backOf.set(node, onBack);
    return node;
  }

  // `build` is a FUNCTION, not a node, so refresh() can redraw the level that is on
  // screen from live data without the caller knowing which level that is.
  //   fullScreen — always over the whole page, at every size (Settings)
  //   selects    — 'supplier:<id>' | 'ingredient:<id>': the list row this level stands for
  // ⚠️ THE PANE IS CHOSEN HERE AND ONLY HERE, by isTabletNow() and never for a full-screen
  // level: a phone appends to document.body exactly as before.
  function push(build, { fullScreen = false, selects = null } = {}) {
    const entry = { build, overlay: null, fullScreen, selects, snapshot: null };
    stack.push(entry);
    const node = build(entry);
    if (!node) return;              // build() popped us (the thing is gone)
    entry.overlay = node;
    const host = pane && !fullScreen && isTabletNow() ? pane : document.body;
    host.appendChild(node);
    // Taken once the form is built and in place, to tell «typed into» from «just opened».
    const form = node.querySelector('.mgmt-form');
    entry.snapshot = form ? snapshotFields(form) : null;
    stackChanged();
    focusLevel(node);
    return entry;
  }

  // ⚠️ A LEVEL CLOSES ITSELF, NEVER «THE TOP». A save or a delete answers after an await, and
  // by then the pane may hold something else (a row tapped meanwhile replaced it): a pop()
  // would close THAT level and throw its typing away. So every level's Back / done / delete
  // is bound to its own entry, and closing an entry that is already gone does nothing.
  function popEntry(entry) {
    const removed = removeLevel(stack, entry);
    if (!removed) return;
    removed.overlay?.remove();
    stackChanged();
    if (removed.keepAlive && redrawOwed) { redrawOwed = false; refresh(); }
  }

  // ⚠️ AFTER A SAVE, THE LEVEL UNDERNEATH IS REDRAWN. The saved document's snapshot lands while
  // the form is still on top, and refresh() leaves a form alone — so the supplier's screen came
  // back with its OLD title and name (the «name to show», 29 Sep 2026). Only after a save: a
  // plain Back keeps the level as it was, scroll position included.
  function popAfterSave(entry) {
    // Already gone (another row tapped while the save ran): nothing was uncovered to redraw.
    if (!stack.includes(entry)) return;
    popEntry(entry);
    refresh();
  }

  // Keyboard users land in a level that opens in the pane (the heading is focusable by
  // script only). Not on a phone, where the level covers the page as before.
  function focusLevel(node) {
    if (node.parentNode !== pane) return;
    const heading = node.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  // ── The tablet's pane ───────────────────────────────────────────────────────

  function paneHolds() {
    return !!pane && [...pane.children].some(child => child.classList.contains('mgmt-overlay'));
  }

  // The placeholder. ONE node kept in the pane and only shown or hidden. ⚠️ Its words are
  // asked here, at paint time, and again on onLanguageChange (registered below): the venue's
  // language arrives AFTER the first paint, and a placeholder worded only at build time
  // stayed English on an Italian tablet (the Orders split, 29 Sep 2026).
  function paintPane() {
    if (!pane) return;
    if (!paneEmpty) {
      paneEmpty = el('div', { class: 'app-split-empty' }, [
        el('span', { class: 'app-split-empty-icon', 'aria-hidden': 'true', icon: POINTER_SVG }),
        el('h2', {}),
        el('p', {}),
      ]);
      pane.prepend(paneEmpty);
    }
    const which = tab === 'suppliers' ? 'suppliers' : tab === 'packaging' ? 'packaging' : 'ingredients';
    paneEmpty.querySelector('h2').textContent = t(`orders.registry.pane.${which}.title`);
    paneEmpty.querySelector('p').textContent = t(`orders.registry.pane.${which}.text`);
    paneEmpty.hidden = paneHolds();
  }

  // The list row whose level is open in the pane — the FIRST level, the one a row opened.
  // Nothing on a phone, where the list is covered and nothing is «beside» it.
  function selectedKey() {
    const root = stack.find(entry => !entry.fullScreen);
    if (!root || !root.selects || !root.overlay || root.overlay.parentNode !== pane) return null;
    return root.selects;
  }

  // Re-run after every repaint of the list (refresh() repaints on each snapshot) and every
  // change of the stack.
  function paintSelection() {
    const key = selectedKey();
    listHost.querySelectorAll('[data-sel]').forEach(row => {
      if (key !== null && row.dataset.sel === key) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    });
  }

  // The row that was open, and whether the pane held something a moment ago: when the pane
  // EMPTIES, focus goes back to that row (or the list), because the level that held it has
  // just left the page and the keyboard would otherwise start again from the top.
  let lastKey = null;
  let paneWasHolding = false;
  let replacing = false;

  function stackChanged() {
    const key = selectedKey();
    if (key !== null) lastKey = key;
    paintSelection();
    paintPane();
    const holds = paneHolds();
    if (paneWasHolding && !holds && !replacing && pane && isTabletNow()) restoreListFocus();
    paneWasHolding = holds;
  }

  function restoreListFocus() {
    const active = document.activeElement;
    if (active && active !== document.body && !pane.contains(active)) return;   // they are elsewhere
    const rows = [...listHost.querySelectorAll('[data-sel]')];
    const row = rows.find(r => r.dataset.sel === lastKey) || rows[0];
    row?.focus({ preventScroll: true });
  }

  // ⚠️ P20 — TYPED WORK IS NEVER LOST SILENTLY. True when any level of the pane holds a form
  // whose fields differ from what they held when it opened.
  // ⚠️ EXCEPT A FORM WHOSE SAVE IS IN FLIGHT (its Save button, in the level's header, is disabled while the write
  // runs): that typing IS being saved, so «not saved» would be a lie. Replacing it is safe;
  // its late answer closes only its own level (popEntry).
  function saveInFlight(entry) {
    return !!entry.overlay?.querySelector('.mgmt-form') && !!entry.overlay.querySelector('.app-header-save:disabled');
  }

  function entryDirty(entry) {
    return !!entry.snapshot && !saveInFlight(entry) && snapshotChanged(entry.snapshot);
  }

  function paneDirty() {
    return stack.some(entry => !entry.fullScreen && entryDirty(entry));
  }

  // ⚠️ P20 ON EVERY SIZE (Federico, 30 Sep 2026): a level's own Back or Cancel never throws its
  // typing away without asking. Until now only the TABLET asked (when the pane was replaced or
  // the page left); on a phone the card's Back discarded a half-typed record in silence.
  async function guardedLeave(entry, close) {
    if (entryDirty(entry) && !(await confirmDiscard())) return;
    close();
  }

  function confirmDiscard() {
    return confirmDialog({
      title: t('orders.registry.discardTitle'),
      message: t('orders.registry.discardMessage'),
      okLabel: t('ui.discard'),
      cancelLabel: t('ui.cancel'),
      danger: true,
    });
  }

  // For the PAGE's own Back (registry-main.js): on a tablet the pane can hold typing while
  // the header still leads away from the page. Resolves true when it is fine to leave —
  // at once on a phone, where the full-screen level covers that button.
  function askBeforeLeaving() {
    if (!pane || !isTabletNow() || !paneDirty()) return Promise.resolve(true);
    return confirmDiscard();
  }

  // Whether askBeforeLeaving() would ask, so the caller can keep a plain link plain.
  function leaveWouldAsk() {
    return !!pane && isTabletNow() && paneDirty();
  }

  // Close every level of the pane, top first, each the way its own Back would.
  function clearPane() {
    for (let guard = stack.length; guard > 0; guard--) {
      const top = stack[stack.length - 1];
      if (!top || top.fullScreen) break;
      const back = top.overlay ? backOf.get(top.overlay) : null;
      if (back) back();
      popEntry(top);   // a Back that did not pop: never loop
    }
  }

  // What tapping a row on the LIST (or the header «+») does. On a phone: just open it, over
  // the list, exactly as before. On a tablet: the new item REPLACES what the pane holds —
  // after asking, if that would throw away typing.
  // `key` is the row's selection key: tapping the row that is ALREADY open does nothing.
  function openFromList(open, key = null) {
    if (!pane || !isTabletNow()) { open(); return; }
    if (key !== null && key === selectedKey()) return;
    const replace = () => {
      replacing = true;             // the pane empties for a moment: no focus jump to the list
      try { clearPane(); open(); } finally { replacing = false; }
    };
    if (!paneDirty()) { replace(); return; }
    confirmDiscard().then((ok) => {
      if (ok) replace();
    });
  }

  // Move a LIVE overlay without rebuilding it, and give the focus back to the box being
  // typed in: appendChild on a focused element drops the focus (and the keyboard with it).
  function moveOverlay(node, target) {
    const active = node.contains(document.activeElement) ? document.activeElement : null;
    let caret = null;
    try { caret = active ? [active.selectionStart, active.selectionEnd] : null; } catch { caret = null; }
    target.appendChild(node);
    if (!active) return;
    active.focus({ preventScroll: true });
    try {
      if (caret && caret[0] !== null) active.setSelectionRange(caret[0], caret[1]);
    } catch { /* a number input has no caret to restore */ }
  }

  // The width was crossed (rotation, a resized window). Levels stay ALIVE and keep what
  // was typed; they only change parent. To a phone every level goes to the body, in stack
  // order (Settings included, or a form moved after it would cover it); to a tablet the
  // non-Settings levels go into the pane.
  function placeOverlays() {
    if (!pane) return;
    const open = stack.filter(entry => entry.overlay);
    if (isTabletNow()) {
      open.filter(entry => !entry.fullScreen && entry.overlay.parentNode !== pane)
        .forEach(entry => moveOverlay(entry.overlay, pane));
    } else if (open.some(entry => !entry.fullScreen && entry.overlay.parentNode !== document.body)) {
      open.forEach(entry => moveOverlay(entry.overlay, document.body));
    }
    stackChanged();
  }

  // ⚠️ REDRAW ONLY WHAT CANNOT BE TYPED INTO. A live snapshot arrives whenever
  // another phone saves; rebuilding a FORM would throw away half-typed allergen
  // ticks and a price nobody had saved yet. So the two forms are left alone and
  // only the list, or a supplier's screen, is repainted.
  //
  // ⚠️ AND THE TOP OF THE STACK IS REDRAWN, NOT JUST THE PAGE UNDERNEATH. A
  // supplier's screen is the one place a newly-added product has to appear, and it
  // is exactly where somebody adding sixty-seven of them is standing. Only the
  // first render was ever checked in this project before v1.60.1 deleted an
  // allergen card on the second one.
  let redrawOwed = false;
  function refresh() {
    paintList();
    const top = stack[stack.length - 1];
    if (!top || !top.overlay) return;
    if (top.overlay.querySelector('.mgmt-form')) return;   // a form: leave it be
    // ⚠️ THE PHOTO SCREEN IS LEFT BE TOO: its photos and its «reading in flight» marker live
    // only in that node, and a rebuild would drop both (and let the update gate reload over
    // a paid reading). One redraw is owed and runs when the level closes (popEntry).
    if (top.keepAlive) { redrawOwed = true; return; }
    const next = top.build(top);
    if (!next) return;                                     // build() popped it
    top.overlay.replaceWith(next);
    top.overlay = next;
  }

  paintList();
  // ⚠️ LAST, after every declaration above: both answer at once when there is something to
  // say (tests/early-session-callback.test.mjs).
  onLanguageChange(paintPane);
  watchTablet(placeOverlays);
  return { node, refresh, openSettings, addCurrent, askBeforeLeaving, leaveWouldAsk };
}

// The placeholder's icon: an arrow pointing back at the list.
const POINTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/><path d="M21 12H9"/></svg>';

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
