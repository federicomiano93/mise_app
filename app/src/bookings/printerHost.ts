// printerHost.ts — where this device finds the receipt printer (bookings step 3, 18 Nov 2026). Pure, no DOM: csp-plugin.ts
// imports it too, so the page's policy and the screens can never disagree on what an address may be.
//
// ⚠️ THE ADDRESS GOES INTO THE PAGE'S CONTENT-SECURITY-POLICY (csp-plugin.ts, the bootstrap): the app may reach the printer
// only because connect-src names it. So it is checked against ONE strict pattern before it is written anywhere — an address in
// a PRIVATE network (10.x.x.x, 172.16–31.x.x, 192.168.x.x), an optional port, nothing else — which keeps both a typo and any
// attempt to smuggle text into the policy out.

// The device's own setting (localStorage). ⚠️ NOT A KEPT PREFIX: a sign-out or a venue switch forgets it, as it should — the
// printer belongs to a venue's network.
export const PRINTER_HOST_KEY = 'bookings-printer-host';
// «Only plain letters» (no accents, no €): for a printer whose character set shows them wrong. '1' when on.
export const PRINTER_PLAIN_KEY = 'bookings-printer-plain';

// ES5-compatible on purpose: the same source text runs in the CSP bootstrap, before anything else, on any browser.
// ⚠️ NO LEADING ZEROS: a browser reads «192.168.000.010» as OCTAL — 192.168.0.8, another machine — so a part is 0 or starts
// with 1–9, and is at most 255 (checked by the pattern itself, which the page's bootstrap applies too: csp-plugin.ts).
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
export const PRINTER_HOST_PATTERN =
  `^(?:10\\.${OCTET}\\.${OCTET}\\.${OCTET}|172\\.(?:1[6-9]|2\\d|3[01])\\.${OCTET}\\.${OCTET}|192\\.168\\.${OCTET}\\.${OCTET})(?::[1-9]\\d{0,4})?$`;

const PRINTER_HOST_RE = new RegExp(PRINTER_HOST_PATTERN);

// Whether a typed address can be the printer's: a private IPv4 address, each part 0–255, an optional port 1–65535.
export function isPrinterHost(text: string): boolean {
  const host = text.trim();
  if (!PRINTER_HOST_RE.test(host)) return false;
  const port = host.split(':')[1];
  return port === undefined || Number(port) <= 65535;
}
