// keyboard-done.js — every single-line box shows the ✓ / «Done» key on a touch
// keyboard, and pressing it closes the keyboard.
//
// Why: on an Android tablet a typed quantity opened the keyboard with no key to
// confirm and close it. The fix is app-wide, so it is done once, by event
// delegation on the document: boxes built later (overlays, cards) are covered
// without each one asking.
//
// Loaded from js/i18n-dom.js, the one module every page already loads.
//
// Deliberate limits:
//   * <textarea> is never touched — Enter is a new line there.
//   * An `enterkeyhint` already in the markup wins (the stocktake uses `next` on
//     purpose), and Enter on such a box is not ours to handle.
//   * Inside a <form> Enter keeps submitting (the sign-in form); only a box
//     outside a form is blurred.
//   * The blur happens in the bubbling phase, AFTER the box's own Enter handler
//     ran, so a search or commit on Enter is never replaced by it.

const TEXT_LIKE_TYPES = ['text', 'search', 'number', 'email', 'tel', 'url', 'password'];

// An <input> whose type is one of the single-line kinds (a missing type is text).
export function isSingleLineInput(node) {
  if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false;
  const raw = typeof node.getAttribute === 'function' ? node.getAttribute('type') : node.type;
  const type = String(raw == null || raw === '' ? 'text' : raw).toLowerCase();
  return TEXT_LIKE_TYPES.includes(type);
}

function insideForm(node) {
  return !!(typeof node.closest === 'function' ? node.closest('form') : node.form);
}

// Gets the Done key: a single-line input with no enterkeyhint of its own and
// outside any <form>. In a form the browser's own key stays (Android shows
// «Next» between fields, and Enter submitting a half-filled form is wrong).
export function wantsDoneKey(node) {
  return isSingleLineInput(node) && !node.getAttribute('enterkeyhint') && !insideForm(node);
}

// Enter closes the keyboard only on a box showing «done», outside any <form>,
// and only on a touch device: with a hardware keyboard the focus must stay in
// a search or quantity box. `coarse` is the answer to (pointer: coarse).
export function shouldBlurOnEnter(node, event, coarse = true) {
  if (!coarse) return false;
  if (!event || event.key !== 'Enter' || event.isComposing) return false;
  if (!isSingleLineInput(node)) return false;
  if (node.getAttribute('enterkeyhint') !== 'done') return false;
  return !insideForm(node);
}

function hint(node) {
  if (wantsDoneKey(node)) node.setAttribute('enterkeyhint', 'done');
}

// Applies the hint to a node and to every input inside it.
export function hintTree(node) {
  if (!node || node.nodeType !== 1) return;
  hint(node);
  if (typeof node.querySelectorAll === 'function') {
    for (const input of node.querySelectorAll('input')) hint(input);
  }
}

export function isCoarsePointer(media = typeof matchMedia === 'function' ? matchMedia : null) {
  try { return !!(media && media('(pointer: coarse)').matches); } catch { return false; }
}

// The hint is set on the box the moment it takes focus — a capturing `focusin`
// listener, just before the keyboard opens. It used to be set as boxes were ADDED,
// by a childList+subtree MutationObserver on the whole page that stayed on for the
// life of the tab and woke on every row the app drew; on a weak tablet left open for
// days that was pure waste, because only a focused box ever opens a keyboard.
export function installKeyboardDone(
  doc,
  media = typeof matchMedia === 'function' ? matchMedia : null,
) {
  if (!doc || typeof doc.addEventListener !== 'function') return;
  doc.addEventListener('focusin', (event) => hint(event.target), true);
  doc.addEventListener('keydown', (event) => {
    const node = event.target;
    if (shouldBlurOnEnter(node, event, isCoarsePointer(media))) node.blur();
  });
}

installKeyboardDone(typeof document !== 'undefined' ? document : null);
