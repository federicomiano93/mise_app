// csp-plugin.ts — Mise 2's Content-Security-Policy, written into index.html at build time.
//
// ⚠️ THE SAME APPROACH AS THE CURRENT APP'S PAGES (index.html, «CSP bootstrap»): a <meta> policy cannot be loosened at
// runtime (two policies combine by intersection), so to let the LOCAL emulators in on localhost without touching the live
// policy, a tiny classic script — the first thing in <head>, before any request — writes the <meta>. On every other host
// the policy is byte-identical (POLICY below) — except for the receipt printer of THIS device, the paragraph further down; on localhost only, connect-src also allows the Auth (9099), Firestore (8080)
// and Functions (5001) emulators. GitHub Pages sends no CSP header, so this meta is the whole policy.
//
// What the page may reach, and why:
//   script-src 'self'   — Mise 2 bundles the Firebase SDK (npm, the version the current app loads from gstatic), so no
//                         gstatic; no inline script runs after the bootstrap.
//   connect-src         — Firestore, Auth (identitytoolkit / securetoken: *.googleapis.com), the Cloud Functions host of
//                         production (us-central1; the preview project has no functions), and https://www.gov.uk for the
//                         UK bank holidays (shared/src/holidays.ts). ⚠️ NO www.google.com: there is no App Check and no
//                         reCAPTCHA (his decision, PR #212).
//   img-src 'self' data: — the label previews, recipe photos and logos are data: URLs.
//   style-src 'self' + TWO hashes — every style is a built stylesheet (React writes element styles through the
//                         CSSOM, which a policy does not govern), but React Aria injects two <style> elements of its own:
//                         usePress's `touch-action: pan-x pan-y pinch-zoom` on every pressable (a double tap on a button
//                         does not zoom the page; found by loading the built app in Chromium with this policy), and, on
//                         iOS/iPadOS only when a modal opens, usePreventScroll's `overscroll-behavior: contain` (scrolling a
//                         dialog past its end does not move the page behind it; found by the code review — no Chromium
//                         run takes that path). Allowed by the hashes of exactly those texts, never 'unsafe-inline';
//                         csp.spec.ts finds EVERY such text in the installed react-aria and requires exactly these hashes,
//                         so an upgrade that changes or adds one turns red.
//   frame-src 'self', base-uri 'self', form-action 'self' — as the current app.
//
// ⚠️ THE FRAME-BUSTER (security plan B1-2, 24 Nov 2026): the bootstrap's FIRST lines hide the page and try to take over the
// top window when the page is loaded inside another site's frame. GitHub Pages cannot send X-Frame-Options, and
// frame-ancestors is ignored in a <meta> policy, so this script is the only guard against clickjacking. It runs before any
// stylesheet or module, needs no 'unsafe-inline' (it IS the bootstrap), and leaves the page hidden when the browser refuses
// the navigation. order.html and reset-password.html do the same; install-guide.html loads js/frame-buster.js.
//
// ⚠️ THE RECEIPT PRINTER (bookings step 3, 18 Nov 2026): the booking slips go straight from the device to the Epson on the
// shop's network (https://<its address>/cgi-bin/fpmate.cgi). connect-src names that ONE address, read by the bootstrap from
// this device's own setting (src/bookings/printerHost.ts) — and only when it matches the strict pattern of a private network
// address, so nothing else can ever be written into the policy. No setting: the policy is exactly POLICY. A changed address
// takes effect at the next page load (the printer screen reloads the page when it saves one).

import type { Plugin } from 'vite';
import { PRINTER_HOST_KEY, PRINTER_HOST_PATTERN } from './src/bookings/printerHost.ts';

export const FUNCTIONS_HOST = 'https://us-central1-bakery-app-ebf90.cloudfunctions.net';
// The SHA-256 of each <style> React Aria injects (`style.textContent` in react-aria/dist/private): usePress's, then
// usePreventScroll's (iOS).
export const REACT_ARIA_STYLES = [
  "'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='",
  "'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='",
] as const;

export const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  `connect-src 'self' https://*.googleapis.com https://firestore.googleapis.com ${FUNCTIONS_HOST} https://www.gov.uk`,
  "frame-src 'self'",
  "img-src 'self' data:",
  `style-src 'self' ${REACT_ARIA_STYLES.join(' ')}`,
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// The emulators, allowed on localhost only (the hostnames are the same list as shared/src/firebase-target.ts' LOCAL_HOSTS).
export const EMULATORS = 'http://localhost:8080 http://localhost:9099 http://localhost:5001 http://127.0.0.1:8080 http://127.0.0.1:9099 http://127.0.0.1:5001';

// The classic script that writes the policy. ES5 on purpose: it runs before anything else, on any browser.
export function bootstrapScript(): string {
  const [head, tail] = POLICY.split(' https://www.gov.uk');
  return [
    '(function () {',
    // Frame-buster (clickjacking): GitHub Pages sends no X-Frame-Options and a <meta> frame-ancestors is ignored.
    '  if (window.top !== window.self) {',
    "    document.documentElement.style.visibility = 'hidden';",
    '    try { window.top.location = window.self.location; } catch (e) {}',
    '  }',
    "  var local = ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(location.hostname) !== -1;",
    `  var emu = local ? ' ${EMULATORS}' : '';`,
    "  var printer = '';",
    `  try { var h = typeof localStorage === 'undefined' ? null : localStorage.getItem(${JSON.stringify(PRINTER_HOST_KEY)}); if (h && new RegExp(${JSON.stringify(PRINTER_HOST_PATTERN)}).test(h)) printer = ' https://' + h; } catch (e) { printer = ''; }`,
    `  document.write('<meta http-equiv="Content-Security-Policy" content="' + ${JSON.stringify(`${head} https://www.gov.uk`)} + printer + emu + ${JSON.stringify(tail ?? '')} + '">');`,
    '})();',
  ].join('\n');
}

// Right after <meta charset>, as in the current app: the charset must stay in the first bytes of the page, and the
// policy must come before any other tag that loads something.
export function withPolicy(html: string): string {
  const charset = /<meta charset="utf-8"\s*\/?>/i;
  if (!charset.test(html)) throw new Error('csp-plugin: index.html has no <meta charset="utf-8">');
  return html.replace(charset, match => `${match}\n    <script>\n${bootstrapScript()}\n    </script>`);
}

// Build only: the dev server injects its own inline preamble and <style> tags, which this policy would refuse.
export function miseCsp(): Plugin {
  return {
    name: 'mise2-csp',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: html => withPolicy(html) },
  };
}
