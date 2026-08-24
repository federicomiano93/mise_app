// share.js — the three ways this app hands a piece of text to a person: the
// clipboard, WhatsApp, and the mail app.
//
// ⚠️ IT EXISTS TO STOP A FOURTH COPY. The raced clipboard write was already written
// out three times (js/calculator-settings.js, and both screens in js/staff/) when
// "Who can get in" needed it too. The Calculator's copy has to stay where it is — a
// feature must never import from another feature's folder — but the three inside
// js/staff/ are one screen's worth of the same errand, and this project already keeps
// a test whose whole job is watching copies drift (tests/copie-allineate.test.mjs).
// One fewer thing for it to watch.
//
// ⚠️ IT MOVED TO js/ ROOT ON 24 Aug 2026, out of js/staff/, and the reason is that
// rule read the other way round: the Catalogue now hands a recipe's ingredient
// declaration to somebody, and it may not import from js/staff/ any more than
// js/staff/ may import from it. Making a FIFTH copy to satisfy a rule whose purpose
// is to stop copies would be the wrong reading of it. Root, pure, no DOM state — the
// shape js/price-model.js and js/photo-model.js already have.
//
// ⚠️ WHATSAPP AND NOT navigator.share(). The platform API is the right instinct
// (P19) and it is genuinely better where it exists — but this app sends every
// order, every client link and every supplier message through wa.me already, so
// a second mechanism here would behave differently on the same phone for the same
// errand. When the whole app moves, this moves with it.

// ⚠️ RACED AGAINST A CLOCK, NEVER AWAITED ON ITS OWN.
// navigator.clipboard.writeText() can sit there and never settle — the page
// losing focus is enough — and it stands between minting an invitation and the
// owner being shown it. Observed for real on the client ordering link (v1.29.1).
const CLIPBOARD_WAIT_MS = 2000;

export async function copyToClipboard(text) {
  try {
    return await Promise.race([
      navigator.clipboard.writeText(text).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), CLIPBOARD_WAIT_MS)),
    ]);
  } catch {
    return false;   // an old browser, a denied permission, an insecure origin
  }
}

// Open WhatsApp with the message already written, and no recipient — the sender
// picks the person in WhatsApp, where their contacts are.
//
// ⚠️ 'noopener' MATTERS EVEN FOR A SITE WE TRUST. Without it the page that opens
// gets a handle on this one through window.opener and can navigate it somewhere
// else, and this app is one an owner is signed into.
export function sendOnWhatsApp(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

// Open the mail app with the message already written, and no recipient — the sender
// picks the person where their contacts are, exactly as with WhatsApp above.
//
// ⚠️⚠️ IT OPENS THE MAIL APP; IT DOES NOT SEND. That is the honest limit of doing this
// without a server, and every screen that offers it says so — letting somebody believe
// a declaration has gone out when it is sitting in a draft is worse than not offering
// it at all. Same shape as mailto() in js/orders/send-chooser.js, which states the same
// limit for an order.
//
// ⚠️ THE SUBJECT AND BODY ARE ENCODED, BOTH OF THEM. An ingredient list is full of
// commas, brackets, percent signs and accents, and a raw `&` in it would silently end
// the body and start a parameter nobody asked for.
export function sendByEmail(subject, body) {
  const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank', 'noopener');
}
