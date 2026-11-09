// csp.spec.ts — the page's Content-Security-Policy (csp-plugin.ts), its bootstrap EXECUTED in node:vm as each kind of
// host would run it: the live site, the preview, the emulator on localhost.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import { bootstrapScript, EMULATORS, FUNCTIONS_HOST, POLICY, REACT_ARIA_PRESS_STYLE, withPolicy } from '../csp-plugin';

function policyOn(hostname: string): string {
  const written: string[] = [];
  vm.runInNewContext(bootstrapScript(), { location: { hostname }, document: { write: (s: string) => written.push(s) } });
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
    expect(directive(POLICY, 'style-src')).toBe(`style-src 'self' ${REACT_ARIA_PRESS_STYLE}`);
    expect(directive(POLICY, 'font-src')).toBe("font-src 'self'");
    expect(POLICY).not.toMatch(/unsafe-inline|unsafe-eval|\*;|\s\*\s/);
  });

  test('⚠️ the one inline style allowed is React Aria\'s pressable rule, by the hash of the text it injects TODAY', () => {
    // If react-aria changes the text (an upgrade), the browser refuses it silently and a double tap zooms the page:
    // this spec reads the installed library and turns red instead. Recompute the hash, check what the rule does, update.
    const source = readFileSync(join(__dirname, '..', 'node_modules/react-aria/dist/private/interactions/usePress.mjs'), 'utf8');
    const template = source.match(/style\.textContent = `([\s\S]*?)`\.trim\(\)/);
    expect(template, 'usePress no longer injects its style this way: look again').not.toBeNull();
    const text = template![1]!.replace(/\$\{[^}]*PRESSABLE_ATTRIBUTE\}/g, 'data-react-aria-pressable').trim();
    expect(text).toContain('touch-action: pan-x pan-y pinch-zoom;');
    expect(`'sha256-${createHash('sha256').update(text).digest('base64')}'`).toBe(REACT_ARIA_PRESS_STYLE);
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
});
