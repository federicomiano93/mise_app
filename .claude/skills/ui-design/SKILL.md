---
name: ui-design
description: The one design system of Mise — tokens, header, bottom footer, navigation, confirmation dialogs, icons, icon-and-text alignment, rows with a delete icon, the settings-screen kit, buttons, motion and alerts. Use BEFORE building or changing any screen, overlay, sheet, dialog, header, button, icon or stylesheet (tokens.css, style.css, orders.css, any *.css), so the new part matches every other screen. Measuring the result afterwards is the ui-check skill.
---

# UI design — one design system

Build it right with this; measure it afterwards with the `ui-check` skill. Whether a screen reads
well is only Federico, on a phone.

## Mise 2 (`app/`) — its own design system

Everything after this section is the CURRENT app's. Mise 2 has a new design, chosen in Claude
Design (project «Mise 2 — design tablet-first», https://claude.ai/design/p/326b31df-d02f-4c27-bce6-f015fa95b820,
file `mise2.css`: change a value there first, then in `app/src/styles/tokens.css`). Read
`docs/architecture.md` too.
- **Tokens:** `app/src/styles/tokens.css` only, as `var(--…)`; warm «flour» neutrals, a dark rail,
  ONE accent (cobalt) for selection and the one primary action per screen; red, amber and green
  only for MEANING (danger/allergen, to check, done). Geist + Geist Mono, bundled. Light only.
- **Layout:** below 700px one pane and a bottom tab bar (four sections + «More»); from 700px the
  dark rail (92px) and a top bar (venue, date, connection); from 1000px list (384px) + detail.
  CSS media queries only; both navigations stay in the DOM.
- **Components:** one `Name.module.css` per component (`css-modules.spec.ts` refuses an undefined
  class or token). Controls from React Aria Components (`ui/Button`, `ui/Dialog`); icons from
  `lucide-react` (20px by default, 22px in the rail and tab bar, `aria-hidden`).
- **Screens:** `shell/Page` gives each screen its one h1, the tab title and focus on navigation;
  every part sits in a `PartBoundary` («This part didn't load» + Reload). Touch targets 48px
  (`--hit`), steppers 56px (`--hit-lg`). Confirm before sign-out, delete, discard (P20), in a
  `ui/Dialog`, never the browser's.
- **Measure** at 296, 360, 768, 1024 and 1280 in EN and IT with axe-core (the drivers in the
  session scratchpad / `algprobe/mise-drive/`): no sideways scroll, no clipped label (the longest
  Italian words: «Impostazioni» in the rail, «Calcolatore» in the 296px tab bar).

- ⚠️ **Pages load `dist/<name>.css`, the minified copy of each root stylesheet.** After editing ANY
  stylesheet run `node scripts/build-bundles.mjs` before ui-check, a screenshot or a phone preview,
  or you measure the old CSS (then `node scripts/sw-hashes.mjs`). The root `.css` is the source.
- **`tokens.css`** (colour, type, spacing, shadows, radii) loads before every stylesheet; every
  screen uses `var(--…)`. Other stylesheets keep local names only as aliases onto it. No screen
  defines its own tokens; a new need extends `tokens.css` for every screen.
- Technical choices: take the better option (tokens, `tabular-nums`, accessible focus rings, `rem`).
  **Light theme only**, his choice. Aesthetic choices: use the value in `tokens.css`; if it is not
  there, ask him. Check a value means what its name suggests — `--brand-2` is a DARKER green (a
  button's hover), not a tint; used as text on `--brand` it measured 1.63:1 and shipped.
- **Header:** Back left (`margin-right:auto`), title centred, actions right — every screen,
  overlays included. 18px/600, letter-spacing −0.3px; round 36×36 icon buttons
  (`.orders-icon-btn` / `.cat-icon-btn`) with a 1.5px translucent-white rim and an on-brand focus
  ring (the green ring is invisible on the green header). The overlay title is taken out of the flow
  (`position:absolute; left:50%`) so the right side cannot push it off centre.
- **Bottom footer** for secondary actions (Settings, Log): `.recipe-footer` + `.recipe-footer-btn`.
  A bar's visibility is DERIVED from its children — `hidden = ![...children].some(c => !c.hidden)`
  (`js/orders/registry-main.js`). A bar carries no permission; each button carries its own (gating
  the catalogue's bar on `canManage` would have hidden the allergen sheet from counter staff).
- **Navigation:** list → detail one level at a time; Back (the `M15 18l-6-6 6-6` chevron) steps up
  one level and closes the screen only at the top.
- **Confirmations:** one dialog, never the browser's — `confirmDialog({title?, message, okLabel,
  cancelLabel, danger})` / `alertDialog(message)` from `confirm-dialog.js` (copied per feature,
  styles `.app-dialog-*` in `tokens.css`); `danger:true` on delete/discard/reset. z-index 10000,
  above the update banner (9999), or the banner's reload destroys the edits the dialog guards.
- **Icons:** inline SVG, never emoji — 24×24, stroked, 2px, round caps, `currentColor`. Calculator:
  `icon(name, size)` from `js/calculator-icons.js`; Orders/Catalogue: static SVG consts + the `el()`
  `icon:` prop. (A `✓` inside status text is fine.)
- **Icon + text is a flex row:** the button AND the wrapper `<span>` need `display:flex;
  align-items:center; gap:…`, or the SVG sits ~2px low. The most common alignment bug in this app.
- **A row with a delete icon:** the frame belongs to the row (`.wa-entry-card`), the inner drill
  button is transparent — a button cannot nest in a button.
- **Settings screens:** one kit, `.set-*` in `tokens.css` — `.set-section`, `.set-row`,
  `.set-switch` (a real `role="switch"` checkbox), `.set-seg`, `.set-door`, `.set-block`,
  `.set-saved`, `.set-danger`. A switch or single choice saves on the tap with «Saved ✓»; a form of
  fields or a list keeps Save + confirm (P20). Each feature builds the markup with its own `el()`.
- **Buttons:** `.btn-primary` (solid green), `.btn-secondary`; destructive is low-key red that never
  competes with Save. Press feedback `transform: scale(.97)` over 60ms.
- **Motion:** sheets fade + slide up ~200ms, dialogs fade + scale ~150ms; the
  `prefers-reduced-motion` switch in `tokens.css` turns it all off.
- **Alerts:** in-app banners at the top of the relevant screen; the main actionable signal is the
  most prominent.

Traps that live in the project CLAUDE.md «Standing traps» and still apply here: `.ing-row` means
two things (Calculator and Orders), `.cp-*` is shared by the Clients editor and the recipe editor,
and every phone-side `display:none` for a tablet-only element needs a tablet `display` rule.
