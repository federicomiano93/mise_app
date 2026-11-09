// csp-plugin.ts — Mise 2's Content-Security-Policy, written into index.html at build time.
//
// ⚠️ THE SAME APPROACH AS THE CURRENT APP'S PAGES (index.html, «CSP bootstrap»): a <meta> policy cannot be loosened at
// runtime (two policies combine by intersection), so to let the LOCAL emulators in on localhost without touching the live
// policy, a tiny classic script — the first thing in <head>, before any request — writes the <meta>. On every other host
// the policy is byte-identical (POLICY below); on localhost only, connect-src also allows the Auth (9099), Firestore (8080)
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
//   style-src 'self' + ONE hash — every style is a built stylesheet (React writes element styles through the CSSOM,
//                         which a policy does not govern), but React Aria's usePress injects one <style> element of its
//                         own: `touch-action: pan-x pan-y pinch-zoom` on every pressable, so a double tap on a button does
//                         not zoom the page (found by loading the built app in Chromium with this policy, 8 Nov 2026).
//                         Allowed by the hash of exactly that text, never by 'unsafe-inline'; csp.spec.ts recomputes it
//                         from the installed react-aria, so an upgrade that changes the text turns red.
//   frame-src 'self', base-uri 'self', form-action 'self' — as the current app.

import type { Plugin } from 'vite';

export const FUNCTIONS_HOST = 'https://us-central1-bakery-app-ebf90.cloudfunctions.net';
// The SHA-256 of React Aria's pressable style (react-aria/dist/private/interactions/usePress, `style.textContent`).
export const REACT_ARIA_PRESS_STYLE = "'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='";

export const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  `connect-src 'self' https://*.googleapis.com https://firestore.googleapis.com ${FUNCTIONS_HOST} https://www.gov.uk`,
  "frame-src 'self'",
  "img-src 'self' data:",
  `style-src 'self' ${REACT_ARIA_PRESS_STYLE}`,
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
    "  var local = ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(location.hostname) !== -1;",
    `  var emu = local ? ' ${EMULATORS}' : '';`,
    `  document.write('<meta http-equiv="Content-Security-Policy" content="' + ${JSON.stringify(`${head} https://www.gov.uk`)} + emu + ${JSON.stringify(tail ?? '')} + '">');`,
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

export function miseCsp(): Plugin {
  return {
    name: 'mise2-csp',
    transformIndexHtml: { order: 'post', handler: html => withPolicy(html) },
  };
}
