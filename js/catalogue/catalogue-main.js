// catalogue-main.js — entry point / orchestrator for the Recipe catalogue page.
// Owns the view routing (list ↔ detail ↔ editor), the header controls, the shared
// confirm dialog and toast, and the live-list subscription. Feature-local only:
// imports firebaseConfig indirectly (via the data layer) and the pure Calculator
// data model only inside import-to-calculator.js — never from js/orders/.

import { t, onLanguageChange } from '../i18n.js';
import {
  initCatalogue, getRecipes, getUsage, bumpUsage, saveRecipe, deleteRecipe, setSyncErrorHandler,
  getIngredients, getSuppliers, getRecipesById, getLabelProfile, saveLabelProfile,
  printerReady, queueLabelJob,
} from './catalogue-store.js';
import { renderList } from './catalogue-list.js';
import { renderAllergenSheet } from './allergen-sheet.js';
import { renderPhotoCapture } from './photo-capture.js';
import { renderSettings } from './catalogue-settings.js';
import { setPhotoEnabled } from './firebase-photo.js';
import { renderLabel } from './label-view.js';
import { renderDetail } from './catalogue-detail.js';
import { renderEditor } from './catalogue-editor.js';
import { renderGuidedEditor } from './guided-editor.js';
import { renderRun, resumableSession, clearSession } from './guided-run.js';
import { importRecipeIntoCalculator, isRecipeLinkedToCalculator } from './import-to-calculator.js';
import { nonWeighableLabels, weighableTotalGrams } from './catalogue-model.js';
import { normalizeSteps, progressText } from './guided-model.js';
import { confirmDialog } from './confirm-dialog.js';
// The session, for the venue's own document: its country decides what language a
// label is printed in. Imported from js/ root, not from a feature folder.
import { currentSession, onSession, sessionReady } from '../firebase.js';
// Whether this venue tracks allergens at all — the switch lives in Orders
// («Fornitori e ingredienti» → Impostazioni) and every screen that shows an allergen
// obeys it. From js/ root, so both halves of the app read one answer.
import { allergensOn } from '../venue-features.js';
// The way to a recipe's Food cost product, and the one judgement of who may take it.
// From js/ root: the catalogue and Food cost share an address, never a folder.
import { mayOpenFoodCost, foodCostHref, recipeIdFromHash } from '../recipe-link.js';
// Whether this person may add an ingredient to the records from here — the same answer the
// records page itself gives. From js/ root: the records belong to Orders.
import { mayEditRecords } from '../records.js';
import { openIngredientCreate } from '../ingredient-create.js';
import { el } from './dom.js';
import { isTabletNow, watchTablet } from './tablet.js';

// The arrow the empty right-hand pane draws (the same one the Suppliers pane uses).
const POINTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/><path d="M21 12H9"/></svg>';

const screen = document.getElementById('catScreen');
const splitEl = document.getElementById('catSplit');
const listCol = document.getElementById('catListCol');
const titleEl = document.getElementById('catTitle');
const subEl = document.getElementById('catSub');
const homeBtn = document.getElementById('catHome');
const backBtn = document.getElementById('catBack');
const addBtn = document.getElementById('catAdd');
const editBtn = document.getElementById('catEdit');
const footerEl = document.getElementById('catFooter');
const settingsBtn = document.getElementById('catSettings');
const allergensBtn = document.getElementById('catAllergens');

// Which of the three the label screen opens on. Session-only on purpose: it is a
// property of this morning's job, not of a recipe.
let labelShows = 'both';
let view = 'list';        // 'list' | 'detail' | 'editor' | 'steps' | 'run'
let searchQuery = '';
let activeList = null;     // { root, refresh } while the list is shown
let activeDetail = null;   // { root, refreshCost } while a recipe is shown
let activeSettings = null; // { root, refresh } while Settings is shown
let activeSheet = null;    // { root, refresh } while the allergen sheet is shown
// ⚠️ ITS OWN QUERY, NOT the list's. The two screens search the same recipes for
// different reasons — "which do I cook" versus "which one is a customer asking
// about" — and carrying one into the other means opening a screen already
// filtered by something you typed for a different job.
let sheetQuery = '';
let activeRun = null;      // { root, confirmLeave, stop } while a guided mix is on screen
let currentRecipe = null;  // the recipe shown in detail (for the header Edit button)
let leaveGuard = null;     // async () => boolean; blocks Back when there are unsaved edits
// True only while a LIVE change redraws the open recipe (redrawDetail): nobody asked to
// move, so focus stays where it is — somebody typing in the search box beside it must
// not lose the keyboard because the owner corrected the salt on another phone.
let quietFocus = false;
let resumeOffered = false; // the "you were mixing" offer is made once per page load
// ⚠️ THE TABLET SPLIT (29 Sep 2026): list on the left, a recipe on the right — for the
// LIST and a RECIPE only. Every other route leaves it (leaveSplit) and is exactly what it
// is on a phone. All of this is declared here, above the first onSession/onLanguageChange
// below, or it is a TDZ crash when the session answers at once.
let splitOn = false;       // is the two-column layout showing right now?
let paneEmpty = null;      // the placeholder node kept for the right-hand pane
// The usage counts the list was last drawn with. ⚠️ While a recipe is open beside the list
// they are FROZEN: every snapshot (the print agent's heartbeat included) would otherwise
// re-sort the rows under a finger. Fresh counts apply the next time the list is shown.
let listUsage = null;

// ── Header + view helpers ───────────────────────────────────────────────────────

function setHeader({ title, sub, back, add, edit = false, footer = false }) {
  // ⚠️⚠️ THE data-i18n ATTRIBUTES HAVE TO GO, AND THIS WAS A REAL DEFECT ON EVERY
  // SCREEN OF THIS PAGE. catalogue.html marks both elements `data-i18n` so they read
  // correctly before any JavaScript runs — but js/i18n-dom.js rewrites EVERY
  // [data-i18n] element whenever the language changes, and the venue's language
  // arrives a moment AFTER the page has drawn itself. Open a recipe, or the allergen
  // sheet, or this screen, in that moment and the header silently reverted to
  // "Recipes": the title said one thing and the screen showed another.
  //
  // Found by driving the new photo screen, which is simply fast enough to be there
  // when it happens. Once a screen has named itself, the static pass no longer owns
  // these two.
  titleEl.removeAttribute('data-i18n');
  subEl.removeAttribute('data-i18n');
  titleEl.textContent = title;
  subEl.textContent = sub;
  subEl.hidden = !sub;   // the list has none: see showList
  homeBtn.hidden = back;   // Home shows only on the list; Back replaces it elsewhere
  backBtn.hidden = !back;
  addBtn.hidden = !add;
  editBtn.hidden = !edit;
  // ⚠️ THE BOTTOM BAR IS CHROME, SO IT IS HIDDEN PER SCREEN RATHER THAN BUILT PER
  // SCREEN. Left visible everywhere it would put a Settings button under an open
  // editor and beside a running mixing timer — one mis-tap from leaving either.
  footerEl.hidden = !footer;
  // ⚠️⚠️ THE PERMISSION IS ON THE BUTTON, NOT ON THE BAR, AND THAT CHANGED HERE.
  // Until the allergen sheet moved down here the switch WAS the only thing behind the
  // bar, so hiding the whole bar from an employee was the same thing as hiding the
  // switch. It is not any more: the sheet has never had a role gate — the rules let
  // any member of the venue read recipes and ingredients — and its own header names
  // counter staff as its first audience, «somebody asked "does this contain nuts?"
  // wants an answer NOW». Gating the bar would take the one screen in this app that
  // can send somebody to hospital away from exactly the person it was written for.
  // Federico's decision, asked before the work: everyone, employees included.
  //
  // ⚠️ Hiding Settings is courtesy, never security: the server refuses setRecipePhoto
  // from an employee regardless (functions/onboarding.js), proved with a second
  // account in v1.60.0.
  settingsBtn.hidden = currentSession().canManage !== true;
  // ⚠️⚠️ AND THE ALLERGEN BUTTON FOLLOWS THE VENUE, NOT THE PERSON. This is the other
  // half of the switch in «Fornitori e ingredienti» → Impostazioni: a venue that does
  // not track allergens must not be offered a sheet that would list every recipe as
  // «non dichiarato» about data nobody there can reach any more.
  //
  // ⚠️ IT IS NOT A ROLE GATE AND MUST NEVER BECOME ONE. Everybody in a venue that DOES
  // track allergens keeps this button, employees first — see the note above.
  allergensBtn.hidden = !allergensOn(currentSession().location);
  // With one of the two gone the bar can be empty, and an empty bar is a grey strip
  // that does nothing. Derived, never typed: add a third button and it comes back.
  if (footer) footerEl.hidden = ![...footerEl.children].some(child => !child.hidden);
}

function swap(node) {
  screen.replaceChildren(node);
  screen.scrollTop = 0;
  // Move focus into the new view so keyboard/screen-reader users don't drop to the
  // top of the document on every transition. The view container itself is focused
  // (not an input) to avoid popping the mobile keyboard.
  node.setAttribute('tabindex', '-1');
  if (quietFocus) return;
  try { node.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}

// ⚠️ EVERY ROUTE OUT OF THE RUN GOES THROUGH HERE. The run holds a repeating
// timer, a visibilitychange listener, the alarm and the screen wake lock; leaving
// the screen without releasing them leaves a phone that never sleeps and, worse,
// an alarm that can still go off on a screen showing something else.
function stopRun() {
  if (activeRun) { activeRun.stop(); activeRun = null; }
}

// ── The tablet split ────────────────────────────────────────────────────────────

// Turn the two-column layout on or off. #catScreen is the right-hand pane only while it
// is on (the class is what tokens.css styles); off, it is the whole screen again.
function setSplit(on) {
  splitOn = on;
  splitEl.dataset.split = on ? 'on' : 'off';
  listCol.hidden = !on;
  screen.classList.toggle('app-split-pane', on);
}

// ⚠️ EVERY ROUTE THAT IS NOT THE LIST OR A RECIPE CALLS THIS FIRST — the editor, the
// mixing steps, the run, the label, the allergen sheet, Settings, the photo screen. They
// were written for a screen that is theirs alone and keep it. The list column is emptied,
// not just hidden, so a screen that comes back builds a fresh one.
function leaveSplit() {
  if (!splitOn) return;
  setSplit(false);
  listCol.replaceChildren();
  paneEmpty = null;
  activeList = null;
}

// The list's own header: it stays while a recipe is open beside it. Title, Home on the
// left, «+» on the right; the header's Edit is hidden — the pane head carries its own.
//
// No subtitle: «Ricette e scalatura in kg» is cut to «Ricette e scalatur…» on a
// 360px phone between two buttons on each side (ui-check, 29 Sep 2026), and a cut
// line reads as a fault. The title alone names the screen.
function setListHeader() {
  setHeader({ title: t('section.catalogue'), sub: '', back: false, add: true, footer: true });
}

// The list into the left column (tablet). ⚠️ NOT re-run when a recipe is opened while the
// list is already there: that is what keeps the search text, the scroll and the focus.
function buildList(selectedId) {
  listUsage = getUsage();
  return renderList({
    recipes: getRecipes(),
    usageMap: listUsage,
    initialQuery: searchQuery,
    selectedId,
    onQueryChange: (q) => { searchQuery = q; },
    onOpen: openDetail,
    onAdd: () => openEditor(null),
  });
}

function paintListColumn(selectedId) {
  activeList = buildList(selectedId);
  listCol.replaceChildren(activeList.root);
  activeList.root.setAttribute('tabindex', '-1');
}

// What the right-hand pane says while no recipe is open. ONE node, its words asked here at
// paint time and again on onLanguageChange: the venue's language arrives AFTER the first
// paint, and a placeholder worded once stayed English on an Italian tablet (the Orders
// and Suppliers splits, 29 Sep 2026).
function showPaneEmpty() {
  if (!paneEmpty) {
    paneEmpty = el('div', { class: 'app-split-empty' }, [
      el('span', { class: 'app-split-empty-icon', 'aria-hidden': 'true', icon: POINTER_SVG }),
      el('h2', {}),
      el('p', {}),
    ]);
  }
  paneEmpty.querySelector('h2').textContent = t('cat.split.empty.title');
  paneEmpty.querySelector('p').textContent = t('cat.split.empty.text');
  screen.replaceChildren(paneEmpty);
}

// The header Edit button, and the pane head's, do the same thing.
// ⚠️ ALWAYS THE CURRENT STORED RECIPE, never the copy the screen was drawn from: a save is
// a merge of name, ingredients and steps, so an editor opened on a stale copy would
// overwrite what somebody corrected on another phone.
function editCurrent() {
  if (!currentRecipe) return;
  const stored = getRecipes().find(r => r.id === currentRecipe.id);
  if (stored) openEditor(stored);
  else recipeGone();
}

// The open recipe was deleted elsewhere: back to the list (the placeholder on a tablet).
function recipeGone() {
  toast(t('cat.recipeDeleted'));
  showList();
}

// Draw the open recipe again in place, from a fresher copy: same place, same scroll.
// The scaled batch is kept per recipe outside the screen, so it survives.
function redrawDetail(recipe) {
  const body = screen.querySelector('.cat-pane-body');
  const top = splitOn ? (body ? body.scrollTop : 0) : screen.scrollTop;
  // A zoomed list locks the page; the view that set the lock is about to be replaced.
  document.body.classList.remove('cat-zoom-lock');
  currentRecipe = recipe;
  quietFocus = true;
  try {
    if (splitOn) showDetailTablet(recipe);
    else showDetailPhone(recipe);
  } finally { quietFocus = false; }
  const fresh = screen.querySelector('.cat-pane-body');
  if (splitOn && fresh) fresh.scrollTop = top;
  else if (!splitOn) screen.scrollTop = top;
}

// The recipes changed while a recipe is open: follow it. Gone -> the list; changed ->
// redrawn from the fresh copy (the pencil then edits what is really stored).
function followOpenRecipe() {
  const latest = getRecipes().find(r => r.id === currentRecipe.id);
  if (!latest) { recipeGone(); return; }
  if (JSON.stringify(latest) !== JSON.stringify(currentRecipe)) redrawDetail(latest);
  else activeDetail.refreshCost(latest);
}

// The list beside an open recipe, or the list itself, follows the data — with the usage
// counts frozen while a recipe is open (see listUsage).
function refreshList() {
  if (!activeList) return;
  if (!(view === 'detail' && splitOn)) listUsage = getUsage();
  activeList.refresh(getRecipes(), listUsage);
}

// The light head of the pane (tokens.css `.app-split-pane .app-header`): the recipe's name
// centred and Edit on the right. No Back — the list is right there.
function buildPaneHead(recipe) {
  return el('header', { class: 'app-header' }, [
    el('span', { class: 'app-header-slot' }),
    el('div', { class: 'app-header-title' }, [
      el('h1', { text: recipe.name || t('cat.recipe'), tabindex: '-1' }),
    ]),
    el('span', { class: 'app-header-slot' }, [
      el('button', {
        class: 'app-icon-btn',
        type: 'button',
        'aria-label': t('aria.editRecipe'),
        // The very same pencil the page header draws (catalogue.html): one drawing.
        icon: editBtn.innerHTML,
        onclick: editCurrent,
      }),
    ]),
  ]);
}

// A recipe's node into the right place: the pane on a tablet split, the whole screen
// otherwise. Focus goes to the pane head on a tablet, as swap() gives it to the view.
function showDetailNode(recipe, node) {
  if (!splitOn) { swap(node); return; }
  const head = buildPaneHead(recipe);
  const body = el('div', { class: 'cat-pane-body' }, [node]);
  screen.replaceChildren(head, body);
  const title = head.querySelector('h1');
  if (quietFocus) return;
  try { title.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}

function showList() {
  stopRun();
  view = 'list';
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  leaveGuard = null;
  setListHeader();
  if (isTabletNow()) {
    setSplit(true);
    paintListColumn(null);
    showPaneEmpty();
    try { activeList.root.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
    return;
  }
  leaveSplit();
  activeList = buildList(null);
  swap(activeList.root);
}

// The label for one recipe. Read-only like the sheet, so no leave guard.
//
// ⚠️ Back goes to the LIST, not to the recipe, because handleBack() is the app's
// one way out and always goes there. Consistent with every other screen here, and
// the recipe is one tap away from the list.
function openLabel(recipe) {
  stopRun();
  leaveSplit();
  view = 'label';
  activeList = null;
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  currentRecipe = recipe;
  leaveGuard = null;
  setHeader({ title: recipe.name || t('cat.label'), sub: t('cat.label'), back: true, add: false });
  // ⚠️ HELD, NOT INLINED: mounted() below is what makes the fit measurement real.
  const labelView = renderLabel({
    recipe,
    ingredients: getIngredients(),
    recipesById: getRecipesById(),
    // ⚠️ THE VENUE'S OWN DOCUMENT, because its `country` decides what language the
    // label is PRINTED in — a legal matter, not a preference (js/market.js). Read
    // fresh on every open rather than captured once: a country set from another
    // phone must reach this screen without a reload.
    location: currentSession().location,
    initialShows: labelShows,
    // ⚠️ A GETTER, not the profile itself. What paper this venue prints on is a
    // setting a manager can change on another device, and the screen must ask when
    // it paints rather than hold whatever was true when it opened — the same shape
    // as photoOn below, for the same reason.
    getProfile: () => getLabelProfile(),
    // ⚠️ A GETTER for the same reason: a shop computer can be switched on or off
    // while this page is open, and the answer must be asked when it is needed.
    isPrinterReady: () => printerReady(),
    onQueue: (payload, copies) => queueLabelJob(payload, copies),
    // Remembered for the session only: which of the three somebody wants is a
    // property of the job they are doing this morning, not of the recipe.
    onShowsChange: (value) => { labelShows = value; },
  });
  swap(labelView.root);
  // ⚠️ AFTER swap(), NEVER BEFORE. The label measures itself against the paper it
  // is drawn on, and a node that is not in the document measures zero — which reads
  // as «it fits» for every label there is.
  labelView.mounted();
}

// Every recipe's allergens on one screen, plus the work list. Read-only, so it
// needs no leave guard: nothing here can be half-typed and lost.
function showAllergenSheet() {
  stopRun();
  leaveSplit();
  view = 'allergens';
  activeList = null;
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  leaveGuard = null;
  setHeader({ title: t('cat.allergens'), sub: t('cat.recipeCatalogue'), back: true, add: false });
  activeSheet = renderAllergenSheet({
    recipes: getRecipes(),
    ingredients: getIngredients(),
    recipesById: getRecipesById(),
    // ⚠️ A GETTER, read at paint time. The venue's `country` decides which words
    // the law card prints, and this screen can be opened before the session has
    // resolved — captured once, a null location would say "nobody has said which
    // country" for ever. Same reason openLabel() reads it fresh on every open.
    getLocation: () => currentSession().location,
    initialQuery: sheetQuery,
    onQueryChange: (q) => { sheetQuery = q; },
    onOpen: openDetail,
  });
  swap(activeSheet.root);
}

// A recipe on a PHONE: the whole screen, the header's Back and Edit.
function showDetailPhone(recipe) {
  leaveSplit();
  activeList = null;
  setHeader({ title: recipe.name || t('cat.recipe'), sub: t('cat.recipe'), back: true, add: false, edit: true });
  activeDetail = renderDetail({ recipe, app });
  swap(activeDetail.root);
}

// A recipe on a TABLET: the pane on the right. The page header stays the list's, and the
// list stays ALIVE in its column — ⚠️ not re-rendered when it is already there, which is
// what keeps the search text, the scroll and the focus; only the open row is re-marked.
// Coming from any other route (the column was emptied) it is painted here, once.
function showDetailTablet(recipe) {
  const listAlive = splitOn && activeList;
  setSplit(true);
  setListHeader();
  if (listAlive) activeList.select(recipe.id);
  else paintListColumn(recipe.id);
  activeDetail = renderDetail({ recipe, app });
  showDetailNode(recipe, activeDetail.root);
}

// `force` is for the app's own redraws (a stale Resume button); only a person's TAP on the
// open recipe is a no-op.
function openDetail(recipe, { force = false } = {}) {
  // Read-only, so nothing to ask when another recipe replaces this one; and tapping the
  // recipe that is already open does nothing at all.
  if (!force && splitOn && view === 'detail' && currentRecipe && currentRecipe.id === recipe.id) return;
  stopRun();
  view = 'detail';
  currentRecipe = recipe;
  leaveGuard = null;
  if (!force) bumpUsage(recipe.id);
  if (isTabletNow()) showDetailTablet(recipe);
  else showDetailPhone(recipe);
}

function openEditor(recipe, draft) {
  stopRun();
  leaveSplit();
  view = 'editor';
  activeList = null;
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  setHeader({
    // ⚠️ A draft is a NEW recipe, so `recipe` stays null and the title is right
    // without a special case. See renderEditor for the four things that depends on.
    title: recipe ? t('cat.editRecipe') : t('cat.newRecipe'),
    sub: t('cat.recipeCatalogue'), back: true, add: false,
  });
  swap(renderEditor({
    recipe, draft, allRecipes: getRecipes(), app,
    // ⚠️ A GETTER, read when the editor is built: the two label fields appear only
    // for a venue that actually prints them, and that switch lives in Settings.
    getLabelProfile: () => getLabelProfile(),
  }));
}

// Is the photograph reader switched on for this venue?
//
// ⚠️ OFF UNLESS THE FIELD SAYS true, and only a literal true. This is the opposite
// default to a SECTION, deliberately: a section missing from a venue's document means
// yes, because a part of the app added later must not switch itself off. This one
// spends money per tap, so a venue that never asked for it must never find it on.
// functions/recipe-photo-model.js photoEnabled() reads it the same way, and it is the
// one that actually refuses.
//
// `overriddenPhotoOn` holds the answer between throwing the switch and the next page
// load: the session's copy of the location document is read when the location opens
// and does not follow a write made afterwards.
let overriddenPhotoOn = null;
function photoIsOn() {
  if (overriddenPhotoOn !== null) return overriddenPhotoOn;
  const location = currentSession().location;
  return !!location && location.recipePhoto === true;
}

// ⚠️ IT ASKS, AND IT SAYS WHAT IT COSTS. This is the only control in the app that
// starts something billable, so switching it on is a decision somebody makes on
// purpose rather than a tap they can make by accident.
async function togglePhoto() {
  const turningOn = !photoIsOn();
  const ok = await confirmDialog({
    title: turningOn ? t('cat.photo.turnOnTitle') : t('cat.photo.turnOffTitle'),
    message: turningOn ? t('cat.photo.turnOnBody') : t('cat.photo.turnOffBody'),
    okLabel: turningOn ? t('cat.photo.turnOn') : t('cat.photo.turnOff'),
    cancelLabel: t('ui.cancel'),
  });
  if (!ok) return;
  // ⚠️ THE SCREEN THIS TAP BELONGS TO, CAPTURED BEFORE THE ROUND TRIP. setPhotoEnabled
  // is a Cloud Function call — a real journey, cold start included — and nothing locks
  // the screen while it is in flight: the dialog removes itself before it resolves, and
  // Back stays live. Somebody can be two screens away by the time it lands.
  const settingsAtTap = activeSettings;
  try {
    await setPhotoEnabled(turningOn);
    overriddenPhotoOn = turningOn;
    // ⚠️ REPAINT ONLY IF THEY ARE STILL ON THAT SAME SCREEN. The old line ended in
    // `else showList()`, which would tear down whatever they had moved to — an open
    // editor with typing in it, a running mixing timer — WITHOUT asking the leave
    // guard, because showList() is a direct swap. The switch has already been written;
    // there is nothing left that has to be shown anywhere.
    if (settingsAtTap && activeSettings === settingsAtTap) settingsAtTap.refresh(turningOn);
    toast(turningOn ? t('cat.photo.nowOn') : t('cat.photo.nowOff'));
  } catch (err) {
    // ⚠️ The server's own words when it has any: it is the half that knows why.
    toast((err && err.message && !/^internal$/i.test(err.message)) ? err.message : t('cat.photo.err.failed'));
  }
}

// What this venue lets itself do. One switch today.
//
// ⚠️ Reached only from the bottom bar, which setHeader() hides from anybody who is
// not an owner or a manager — and the server refuses the change regardless.
function showSettings() {
  stopRun();
  leaveSplit();
  view = 'settings';
  activeList = null;
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  leaveGuard = null;
  setHeader({ title: t('ui.settings'), sub: t('cat.recipeCatalogue'), back: true, add: false });
  activeSettings = renderSettings({
    photoOn: photoIsOn(),
    onTogglePhoto: togglePhoto,
    // ⚠️ THE VALUE, not a getter, and the difference is deliberate: this screen is
    // where the profile is EDITED, so it owns a working copy for as long as it is
    // open. Re-reading the store under a half-typed size is how a field fights the
    // person filling it in.
    labelProfile: getLabelProfile(),
    // The store is local-first and rolls its own copy back on a rejection; the
    // screen rolls back what a person can see. Both, because they are two copies.
    onSaveLabel: patch => saveLabelProfile(patch),
  });
  swap(activeSettings.root);
}

// ⚠️ BACK FROM THE PHOTO SCREEN GOES TO A BLANK NEW-RECIPE FORM, ONCE. The app's one
// rule is that Back always returns to the list (handleBack), and this is the single
// exception: the photo screen is now reached from inside the new-recipe form, so
// dropping somebody on the list would strand them mid-task.
//
// ⚠️ CONSUMED THE INSTANT IT IS READ, exactly like the one-shot flag behind "Back to
// Mise" (v275). Left set, every later Back would open an editor instead of the list.
let backToEditor = false;
// ⚠️ AND WHAT WAS TYPED COMES BACK WITH IT. Without this the editor's working copy
// died the moment the photo screen replaced it — it lives only in renderEditor's
// closure, is never written anywhere, and swap() throws the DOM away. So somebody who
// typed a name, tapped the photo button, then changed their mind came back to a BLANK
// form: the app had asked "shall I replace what you typed?", they said yes expecting a
// photo to replace it, and nothing did. Consumed with the marker, in the same gesture.
let backToEditorDraft = null;

// Read a recipe from a photograph.
//
// ⚠️ REACHED FROM THE NEW-RECIPE FORM, AND THE OLD COMMENT HERE SAID IT NEVER COULD BE:
// "from an open editor it would have to ask 'merge this with what you have typed, or
// replace it?', and neither answer is one somebody can give safely." That was right
// about an EXISTING recipe and wrong about a new one — a new form is empty, and if
// anything has been typed the editor asks before it navigates. Federico's note of
// 23 Aug 2026: this is needed at the moment you add a recipe, which is where it is now.
function showPhotoCapture(fromEditor = false, keepDraft = null) {
  backToEditor = !!fromEditor;
  backToEditorDraft = fromEditor ? keepDraft : null;
  stopRun();
  leaveSplit();
  view = 'photo';
  activeList = null;
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  leaveGuard = null;
  setHeader({ title: t('cat.photo.title'), sub: t('cat.recipeCatalogue'), back: true, add: false });
  swap(renderPhotoCapture({
    app,
    // The draft never touches the database. It goes straight into the ordinary
    // editor as a working copy, and waits there for the same Save as any recipe
    // typed by hand.
    onDraft: (draft, notes) => {
      // The read succeeded, so this IS the way back to the editor — the one-shot has
      // done its job and must not fire again on the next Back.
      backToEditor = false;
      backToEditorDraft = null;
      openEditor(null, draft);
      if (notes && notes.rowsCapped) toast(t('cat.photo.capped'));
    },
  }).root);
}

function openGuidedEditor(recipe) {
  stopRun();
  leaveSplit();
  view = 'steps';
  activeList = null;
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  currentRecipe = recipe;
  setHeader({ title: t('cat.mixingSteps'), sub: recipe.name || t('cat.recipe'), back: true, add: false });
  swap(renderGuidedEditor({ recipe, app }));
}

// Start a mix, or pick one back up. `resume` is a saved session or null.
//
// ⚠️ THE HEADER PENCIL IS HIDDEN HERE (edit: false). It opens the recipe editor,
// which rebuilds the ingredient rows — reachable from a running mix, it is one tap
// between somebody's hands in dough and the amounts they are working to.
function openRun(recipe, targetGrams, resume) {
  stopRun();
  leaveSplit();
  view = 'run';
  activeList = null;
  activeDetail = null;
  activeSettings = null;
  activeSheet = null;
  currentRecipe = recipe;
  setHeader({ title: recipe.name || t('cat.recipe'), sub: t('cat.guidedMixing'), back: true, add: false, edit: false });
  activeRun = renderRun({ recipe, targetGrams, app, resume });
  leaveGuard = activeRun.confirmLeave;
  swap(activeRun.root);
}

// Offered once per page load, and only when there is genuinely a dough on the go
// — see isResumable() in the model for what "genuinely" rules out (another day, a
// clock that moved, a recipe since deleted).
async function offerResume() {
  if (resumeOffered) return;
  const saved = resumableSession(getRecipes());
  if (!saved) return;
  resumeOffered = true;
  const recipe = getRecipes().find(r => r.id === saved.recipeId);
  const total = normalizeSteps(saved.snapshot.steps).length;
  const ok = await confirmDialog({
    title: t('cat.carryOnMixing'),
    message: t('cat.partWayThrough', {
      name: saved.snapshot.name || recipe.name,
      progress: progressText(saved.stepIndex, total, { inline: true }),
    }),
    okLabel: t('cat.carryOn'), cancelLabel: t('cat.notNow'),
  });
  // "Not now" KEEPS the session: it answers where to go next, never whether the
  // dough exists. The recipe's own screen still offers to resume it.
  if (ok) openRun(recipe, saved.snapshot.targetGrams, saved);
}

async function handleBack() {
  if (leaveGuard) {
    const ok = await leaveGuard();
    if (!ok) return;
  }
  leaveGuard = null;
  // ⚠️ READ AND CLEARED IN ONE GESTURE. Left set it would send every later Back into a
  // new editor — the trap the "Back to Mise" flag was written to avoid.
  if (backToEditor) { const kept = backToEditorDraft; backToEditor = false; backToEditorDraft = null; openEditor(null, kept); return; }
  showList();
}

function toast(msg) {
  const t = document.getElementById('catToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ── The app object handed to the detail/editor views ────────────────────────────

const app = {
  confirm: confirmDialog,
  toast,
  showList,
  openDetail,
  openEditor,
  openLabel,
  openGuidedEditor,
  saveRecipe,
  deleteRecipe,
  bumpUsage,
  setLeaveGuard: (fn) => { leaveGuard = fn; },
  // The new-recipe form's way to the photograph reader, and whether to offer it at
  // all. ⚠️ photoOn is a FUNCTION, not a value: the switch can be thrown from another
  // phone, and a value captured when this object was built would be stale for the
  // life of the page.
  openPhotoCapture: (keepDraft) => showPhotoCapture(true, keepDraft),
  photoOn: () => photoIsOn(),
  startGuided: (recipe, targetGrams) => openRun(recipe, targetGrams, null),
  resumeGuided: (recipe) => {
    const saved = resumableSession(getRecipes());
    if (saved && saved.recipeId === recipe.id) openRun(recipe, saved.snapshot.targetGrams, saved);
    // A session that has aged out (or belongs to another recipe) is not silently
    // swapped for a fresh run: the button said "resume", and starting from step
    // one instead would look identical and be a different dough.
    else { clearSession(); toast(t('cat.thatMixIsNo')); openDetail(recipe, { force: true }); }
  },
  // The saved run, but only if it is this recipe's — so a recipe screen never
  // offers to resume somebody else's dough.
  guidedSessionFor: (recipeId) => {
    const saved = resumableSession(getRecipes());
    return saved && saved.recipeId === recipeId ? saved : null;
  },
  // Live getters, not snapshots: the editor is open while the ingredient listener
  // is still streaming in, so an ingredient renamed in Orders reaches an open recipe
  // without a reload — and a chooser opened before the first snapshot is not stuck
  // showing an empty list for as long as the screen stays open.
  ingredients: getIngredients,
  suppliers: getSuppliers,
  allRecipes: getRecipes,
  // The recipe screen's «Apri nel Food cost»: whether to draw it, and where it goes.
  // ⚠️ ASKED OF THE SESSION EACH TIME, never captured: the session arrives after the
  // first paint, and a manager can show Food cost to employees from another phone.
  mayOpenFoodCost: () => { const s = currentSession(); return mayOpenFoodCost(s.location, s.canManage); },
  openFoodCost: (recipe) => { if (recipe && recipe.id) window.location.href = foodCostHref(recipe.id); },
  // A recipe row's missing ingredient, added with the card «Fornitori e ingredienti» uses.
  // Federico, 13 Sep 2026: «semplicemente apri una scheda ingrediente come in fornitori ed
  // ingredienti». ⚠️ Asked of the session each time, like Food cost above.
  mayCreateIngredient: () => { const s = currentSession(); return mayEditRecords(s.location, s.canManage); },
  createIngredient: (name) => openIngredientCreate({ name, suppliers: getSuppliers(), ingredients: getIngredients() }),
  // Delete a catalogue recipe with a strong confirm, warning first if the recipe
  // was imported into the Calculator (the two are independent copies — deleting
  // here never touches the Calculator). The link check is raced with a short
  // timeout so a slow/offline read never blocks the delete. Returns true if it was
  // deleted (and navigation moved back to the list), false if cancelled.
  async confirmAndDelete(recipe) {
    let linked = false;
    try {
      linked = await Promise.race([
        isRecipeLinkedToCalculator(recipe.id),
        new Promise((res) => setTimeout(() => res(false), 2500)),
      ]);
    } catch (e) { linked = false; }

    const base = t('cat.deleteRecipeQ', { name: recipe.name || t('cat.thisRecipe') });
    const message = linked
      ? base + t('cat.itWasImportedInto')
      : base;

    const ok = await confirmDialog({ title: t('cat.deleteRecipe2'), message, okLabel: t('ui.delete'), danger: true, cancelLabel: t('ui.cancel') });
    if (!ok) return false;
    deleteRecipe(recipe.id);
    toast(t('cat.recipeDeleted'));
    showList();
    return true;
  },
  async importRecipe(recipe) {
    // The Calculator is grams-only. If there's no weighable ingredient there is
    // nothing to import; otherwise warn about any rows that will be left out.
    if (weighableTotalGrams(recipe) <= 0) {
      toast(t('cat.nothingToImport'));
      return;
    }
    const skipped = nonWeighableLabels(recipe);
    const warn = skipped.length
      ? `\n\n${t('cat.nonScalableNote', { n: skipped.length, list: skipped.join(', ') })}`
      : '';
    const ok = await confirmDialog({
      title: t('cat.importIntoCalculator2'),
      message: `${t('cat.copyIntoCalculator', { name: recipe.name })}${warn}`,
      okLabel: t('ui.import'),
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;
    try {
      const { action } = await importRecipeIntoCalculator(recipe);
      bumpUsage(recipe.id);
      toast(action === 'updated'
        ? t('cat.updatedInCalculator', { name: recipe.name })
        : t('cat.addedToCalculator', { name: recipe.name }));
    } catch (err) {
      console.error('Import into Calculator failed:', err);
      toast(t('cat.importFailedCheckYour'));
    }
  },
};

// ── Wire up ─────────────────────────────────────────────────────────────────────

backBtn.addEventListener('click', handleBack);
addBtn.addEventListener('click', () => openEditor(null));
editBtn.addEventListener('click', editCurrent);
allergensBtn.addEventListener('click', showAllergenSheet);
settingsBtn.addEventListener('click', showSettings);

// Surface background write failures (rolled back by the store) as a toast.
setSyncErrorHandler((msg) => toast(msg));

// The recipe named by Back from Food cost (see openWantedRecipe, further down).
//
// ⚠️⚠️ DECLARED HERE, BEFORE ANYTHING THAT CAN CALL openWantedRecipe(), and it must stay
// here (27 Sep 2026). onSession() below answers AT ONCE when the session is already
// ready — which happens whenever signing in finishes before this page's own files have,
// more often since the sign-in got faster. Declared after it, the name did not exist
// yet: the call threw, the rest of this file never ran, and the catalogue stayed broken
// until a reload, with every later data update throwing the same error.
let wantedRecipeId = recipeIdFromHash(window.location.hash);
const WANTED_RECIPE_WAIT_MS = 5000;

// Start the live sync; when the collection changes and the list is showing, refresh
// its cards in place (without rebuilding the search box). If the live stream dies,
// tell the user their view may be stale.
initCatalogue(
  () => {
    // Back from Food cost names a recipe that may arrive only now — see openWantedRecipe().
    openWantedRecipe();
    // Beside an open recipe on a tablet the list is on screen too, and stays current.
    if (view === 'list' || (view === 'detail' && splitOn)) refreshList();
    // The offer needs the recipes to have arrived — a session is only worth
    // resuming if its recipe is still in the catalogue.
    if (view === 'list') offerResume();
    // A recipe on screen rebuilds its cards whenever anything they depend on
    // arrives — the ingredients and their allergens (still streaming in on a cold
    // open), or the recipe itself edited on another phone. ⚠️ THE WHOLE RECIPE FOLLOWS, not
    // only its cost cards: on a tablet a recipe stays open for hours, and its quantities
    // must follow a correction made on another phone; deleted elsewhere, it goes back to
    // the list with a note (followOpenRecipe).
    if (view === 'detail' && activeDetail && currentRecipe) followOpenRecipe();
    // ⚠️ THE ALLERGEN SHEET NEVER REFRESHED AT ALL until now — it was drawn once
    // and never again, so a declaration made on another phone, or data still
    // arriving on a cold open, simply never reached it. On the screen whose job is
    // saying what a recipe contains, that is the wrong thing to be stale. Its
    // search box is mounted once and survives this: only the summary, the work
    // boxes and the rows are replaced.
    if (view === 'allergens' && activeSheet) {
      activeSheet.refresh(getRecipes(), getIngredients(), getRecipesById());
    }
  },
  () => toast(t('cat.liveSyncInterruptedRecipes')),
);

// ⚠️ AND AGAIN WHEN THE LANGUAGE ARRIVES — see js/foodcost/foodcost-main.js.
// Only from the list, so an open editor is never redrawn under somebody's hands.
// ⚠️ THE LIST REDRAWS ITSELF; EVERY OTHER SCREEN MUST NOT. Redrawing over an open
// editor would throw away what somebody has typed, which is why this has always
// been narrow. The photo screen is the exception that is safe: it holds only the
// photographs, and its own paint() rebuilds them — so it repaints itself (see
// photo-capture.js) and only its HEADER, which lives out here, is re-applied.
// ⚠️⚠️ THE LIST IS DRAWN BEFORE THE SESSION IS READY, EVERY TIME, and until now
// nothing redrew it when the session arrived. Measured: at one second `canManage` is
// false and the venue document is null; at three seconds both are right and the
// screen still shows what it painted at one.
//
// It was invisible while nothing on the list depended on the session. The photograph
// switch does — it is shown only to an owner or a manager, and only when the venue
// has it on — so an owner opening the Catalogue simply never saw it, for ever. Not a
// race: a certainty, hidden only by the fact that a language change happened to
// repaint the list as a side effect.
//
// ⚠️ ONCE, AND ONLY FROM THE LIST. Repainting on every session change would rebuild
// the screen under somebody's fingers; repainting any other view would throw away
// what they had typed. Same rule, same reason, as the language handler below.
let paintedWithSession = false;
onSession((s) => {
  if (s.status !== 'ready' || paintedWithSession) return;
  paintedWithSession = true;
  if (view === 'list') showList();
  // ⚠️ AN OPEN RECIPE IS REBUILT WHOLE, since 13 Sep 2026. Two things on it are decided by
  // the session — the «Apri nel Food cost» card (whoever may open Food cost) and the
  // owner's «Elimina ricetta» — and a recipe opened before the session drew neither.
  // Refreshing only the cards brought the first back and left the second missing (found
  // by the code review). Rebuilding is safe: the screen holds no input, and a scaled
  // batch is kept per recipe outside it.
  else if (view === 'detail' && activeDetail && currentRecipe) {
    const latest = getRecipes().find(r => r.id === currentRecipe.id) || currentRecipe;
    currentRecipe = latest;
    activeDetail = renderDetail({ recipe: latest, app });
    showDetailNode(latest, activeDetail.root);
    // The list column is on screen beside it: its header follows the session as well.
    if (splitOn) setListHeader();
  }
  // ⚠️ THE ALLERGEN SHEET NEEDS THIS TOO, and it is the one screen where being
  // early is worse than being wrong quietly: its top card names the allergens the
  // law requires in the venue's COUNTRY, and before the session lands there is no
  // country to read. It repaints rather than rebuilding, so the search text and
  // the keyboard survive — the reason it is safe here where an editor would not be.
  else if (view === 'allergens' && activeSheet) {
    activeSheet.refresh(getRecipes(), getIngredients(), getRecipesById());
  }
  // Back from Food cost waits for the session before it reopens the recipe — see
  // openWantedRecipe(). It does nothing when no recipe was named.
  openWantedRecipe();
});

onLanguageChange(() => {
  if (view === 'list') showList();
  else if (view === 'detail' && splitOn) {
    // The list beside the recipe and the page header are words too; the recipe itself is
    // left alone, as on a phone. Only the pencil's label needs re-wording in the pane.
    setListHeader();
    paintListColumn(currentRecipe ? currentRecipe.id : null);
    const pencil = screen.querySelector('.app-header button');
    if (pencil) pencil.setAttribute('aria-label', t('aria.editRecipe'));
  } else if (view === 'photo') {
    setHeader({ title: t('cat.photo.title'), sub: t('cat.recipeCatalogue'), back: true, add: false });
  } else if (view === 'allergens') {
    // Rebuilt, not repainted: every label and placeholder on it is a t() call
    // resolved when the element is drawn.
    showAllergenSheet();
  }
});

// ⚠️ CROSSING THE WIDTH (a rotation, a resized window) re-lays out the list and a recipe
// only — both are read-only, so drawing them again loses nothing (the search text is kept
// in searchQuery, a scaled batch outside the screen). Any other route is left alone: an
// open editor is never redrawn under somebody's hands.
watchTablet((isTablet) => {
  if (view === 'list') showList();
  else if (view === 'detail' && currentRecipe && isTablet !== splitOn) {
    const latest = getRecipes().find(r => r.id === currentRecipe.id) || currentRecipe;
    currentRecipe = latest;
    if (isTablet) showDetailTablet(latest);
    else showDetailPhone(latest);
  }
});

// ── Back from Food cost ──────────────────────────────────────────────────────
//
// A recipe's «Apri nel Food cost» leaves this page, and Food cost's Back returns to that
// recipe as catalogue.html#recipe=<id> (js/recipe-link.js) — one level up, where the tap
// came from, not the top of the list.
//
// ⚠️ ONE-SHOT: the address is spent the moment it is used, so a reload or a later Back
// never reopens the recipe. ⚠️ AND IT GIVES UP: a recipe that is not here within a few
// seconds — deleted on another phone, or a slow first open — leaves the list where it
// is, rather than jumping onto the screen long after somebody started something else.
// (wantedRecipeId and WANTED_RECIPE_WAIT_MS are declared above initCatalogue — see there.)

function openWantedRecipe() {
  if (!wantedRecipeId) return;
  // ⚠️ NOT BEFORE THE SESSION. The recipe is usually already in the phone's copy at page
  // load, and a recipe screen built before the session knows nobody's role: an owner's
  // «Elimina ricetta» was simply never drawn (found by the code review). onSession asks
  // again the moment the session is ready.
  if (currentSession().status !== 'ready') return;
  // Only over the list it would have opened from — never over a screen somebody has
  // since chosen for themselves.
  if (view !== 'list') { forgetWantedRecipe(); return; }
  const recipe = getRecipes().find(r => r.id === wantedRecipeId);
  if (!recipe) return;   // not arrived yet: the next data update asks again
  forgetWantedRecipe();
  openDetail(recipe);
}

function forgetWantedRecipe() {
  wantedRecipeId = null;
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch (e) { /* best-effort: at worst a reload opens the recipe again */ }
}

showList();
if (wantedRecipeId) {
  openWantedRecipe();
  // ⚠️ COUNTED FROM THE SESSION, not from the page load: the recipe is not opened before
  // the session (see openWantedRecipe), and a sign-in slower than the wait would otherwise
  // forget the recipe before it was ever allowed to open.
  sessionReady.then(() => setTimeout(forgetWantedRecipe, WANTED_RECIPE_WAIT_MS));
}
