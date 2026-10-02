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

// Gets the Done key: a single-line input with no enterkeyhint of its own.
export function wantsDoneKey(node) {
  return isSingleLineInput(node) && !node.getAttribute('enterkeyhint');
}

// Enter closes the keyboard only on a box showing «done», outside any <form>.
export function shouldBlurOnEnter(node, event) {
  if (!event || event.key !== 'Enter' || event.isComposing) return false;
  if (!isSingleLineInput(node)) return false;
  if (node.getAttribute('enterkeyhint') !== 'done') return false;
  const inForm = typeof node.closest === 'function' ? node.closest('form') : node.form;
  return !inForm;
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

// On Android the keyboard may be configured before or as focus lands, so the
// hint is also set as boxes are ADDED: one scan at install, then one observer
// (childList + subtree, no attribute watching) that walks only the added nodes.
// The focusin path stays as a backstop. `Observer` is injectable for tests.
export function installKeyboardDone(doc, Observer = typeof MutationObserver !== 'undefined' ? MutationObserver : null) {
  if (!doc || typeof doc.addEventListener !== 'function') return;
  doc.addEventListener('focusin', (event) => hint(event.target));
  doc.addEventListener('keydown', (event) => {
    const node = event.target;
    if (shouldBlurOnEnter(node, event)) node.blur();
  });
  if (typeof doc.querySelectorAll === 'function') {
    for (const input of doc.querySelectorAll('input')) hint(input);
  }
  if (Observer && doc.documentElement) {
    new Observer((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) hintTree(added);
      }
    }).observe(doc.documentElement, { childList: true, subtree: true });
  }
}

installKeyboardDone(typeof document !== 'undefined' ? document : null);
