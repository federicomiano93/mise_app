// csp.spec.ts — the page's Content-Security-Policy (csp-plugin.ts), its bootstrap EXECUTED in node:vm as each kind of
// host would run it: the live site, the preview, the emulator on localhost.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { bootstrapScript, EMULATORS, FUNCTIONS_HOST, POLICY, REACT_ARIA_STYLES, withPolicy } from '../csp-plugin';

function policyOn(hostname: string, stored: Record<string, string> | null = null): string {
  const written: string[] = [];
  const localStorage = stored === null ? undefined : { getItem: (key: string) => stored[key] ?? null };
  vm.runInNewContext(bootstrapScript(), { location: { hostname }, localStorage, document: { write: (s: string) => written.push(s) } });
  expect(written).toHaveLength(1);
  const meta = written[0]!.match(/^<meta http-equiv="Content-Security-Policy" content="([^"]+)">$/);
  expect(meta, written[0]).not.toBeNull();
  return meta![1]!;
}
const directive = (policy: string, name: string) => policy.split('; ').find(d => d.startsWith(`${name} `)) ?? '';

describe('the CSP of Mise 2\'s page', () => {
  test('on the live site and on the preview it is exactly POLICY, byte for byte', () => {
    expect(policyOn('federicomiano93.github.io')).toBe(POLICY);
    expect(policyOn('mise-app-preview--anteprima-hp2f4g1e.web.app')).toBe(POLICY);
  });

  test('connect-src: Firestore, Auth, the production functions host and gov.uk (the UK bank holidays)', () => {
    const connect = directive(POLICY, 'connect-src').split(' ');
    for (const host of ["'self'", 'https://*.googleapis.com', 'https://firestore.googleapis.com', FUNCTIONS_HOST, 'https://www.gov.uk']) {
      expect(connect).toContain(host);
    }
    expect(FUNCTIONS_HOST).toBe('https://us-central1-bakery-app-ebf90.cloudfunctions.net');
  });

  test('⚠️ no App Check, no reCAPTCHA (his decision, PR #212): www.google.com is nowhere; no gstatic (the SDK is bundled)', () => {
    expect(POLICY).not.toMatch(/google\.com|recaptcha|gstatic/);
    expect(directive(POLICY, 'script-src')).toBe("script-src 'self'");
  });

  test('img-src allows data: (label previews, photos, logos); styles and fonts only from the site', () => {
    expect(directive(POLICY, 'img-src')).toBe("img-src 'self' data:");
    expect(directive(POLICY, 'style-src')).toBe(`style-src 'self' ${REACT_ARIA_STYLES.join(' ')}`);
    expect(directive(POLICY, 'font-src')).toBe("font-src 'self'");
    expect(POLICY).not.toMatch(/unsafe-inline|unsafe-eval|\*;|\s\*\s/);
  });

  test('⚠️ the inline styles allowed are EXACTLY the ones React Aria injects TODAY, by the hash of each text', () => {
    // If react-aria changes a text or adds one (an upgrade), the browser refuses it silently — a double tap zooms the
    // page, a dialog's scroll moves the page behind it on iOS: this spec reads the installed library and turns red.
    const dir = join(__dirname, '..', 'node_modules/react-aria/dist/private');
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith('.mjs')) files.push(f); } };
    walk(dir);
    const hashes: string[] = [];
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\.textContent = `([\s\S]*?)`\.trim\(\)/g)) {
        const text = m[1]!.replace(/\$\{[^}]*PRESSABLE_ATTRIBUTE\}/g, 'data-react-aria-pressable').trim();
        expect(text, `${file}: a style built from a value this spec does not know — look again`).not.toContain('${');
        hashes.push(`'sha256-${createHash('sha256').update(text).digest('base64')}'`);
      }
    }
    expect(hashes.length, 'react-aria injects no style this way any more: look again').toBeGreaterThan(0);
    expect([...new Set(hashes)].sort()).toEqual([...REACT_ARIA_STYLES].sort());
  });

  test('on localhost only, the emulators are allowed too — the Functions one at 127.0.0.1:5001 included', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
      const policy = policyOn(host);
      expect(directive(policy, 'connect-src')).toBe(`${directive(POLICY, 'connect-src')} ${EMULATORS}`);
      expect(policy.replace(` ${EMULATORS}`, '')).toBe(POLICY);
    }
    expect(EMULATORS).toContain('http://127.0.0.1:5001');
    expect(policyOn('localhost.evil.test')).toBe(POLICY);
  });

  test('the bootstrap sits right after <meta charset>, before anything that loads', () => {
    const html = '<!doctype html><html><head>\n    <meta charset="utf-8" />\n    <link rel="icon" href="/x.svg" />\n    <script type="module" src="/assets/i.js"></script></head></html>';
    const out = withPolicy(html);
    const at = (s: string) => out.indexOf(s);
    expect(at('<meta charset')).toBeLessThan(at('Content-Security-Policy'));
    expect(at('Content-Security-Policy')).toBeLessThan(at('<link rel="icon"'));
    expect(at('Content-Security-Policy')).toBeLessThan(at('type="module"'));
    // The charset stays within the first bytes, as the HTML standard asks (1024).
    expect(at('<meta charset')).toBeLessThan(1024);
    expect(() => withPolicy('<head></head>')).toThrow(/charset/);
  });

  test('⚠️ the receipt printer: its ONE address joins connect-src, only when it is a private network address', () => {
    const site = 'federicomiano93.github.io';
    const withPrinter = policyOn(site, { 'bookings-printer-host': '192.168.1.50' });
    expect(directive(withPrinter, 'connect-src')).toBe(`${directive(POLICY, 'connect-src')} https://192.168.1.50`);
    expect(withPrinter.replace(' https://192.168.1.50', '')).toBe(POLICY);
    expect(directive(policyOn(site, { 'bookings-printer-host': '10.0.0.7:8443' }), 'connect-src')).toContain(' https://10.0.0.7:8443');
    // Anything else leaves the policy exactly as it is: a public address, a name, an attempt to write into the policy.
    for (const bad of ['8.8.8.8', 'evil.test', '192.168.1.50; script-src *', '192.168.1.50 https://evil.test', '172.32.0.1', '', ' 192.168.1.5', '192.168.001.050', '192.168.1.256', '192.168.1.50:0']) {
      expect(policyOn(site, { 'bookings-printer-host': bad }), bad).toBe(POLICY);
    }
    expect(policyOn(site, {})).toBe(POLICY);
    // A storage that throws (private mode, blocked site data) is no printer, never a broken page.
    const written: string[] = [];
    vm.runInNewContext(bootstrapScript(), {
      location: { hostname: site },
      localStorage: { getItem: () => { throw new Error('blocked'); } },
      document: { write: (text: string) => written.push(text) },
    });
    expect(written[0]).toContain(POLICY.split('; ')[0]);
  });
});
