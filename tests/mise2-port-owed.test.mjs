// Mise 2's «port owed» ledger — no marked spec may survive into the switch.
//
// When main (v1.144.1) was merged into the Mise 2 release branch (8 Nov 2026), many js/ originals
// had moved on: partial-owner roles, Food cost weighing and two decimals, invoice per-piece prices,
// pastries notes, «due today» reminders… Mise 2's specs compare each shared/ port with its js/
// original, so those comparisons went red. Porting them is step 2 of the go-live plan, so each one
// was turned into an EXPECTED failure (`test.fails`) carrying the marker below, which fails again
// by itself the moment its port lands and the marker is not removed.
//
// ⚠️ AN EXPECTED FAILURE IS A KNOWN DIFFERENCE BETWEEN THE TWO APPS. Shipped, it is a behaviour the
// current app has and Mise 2 does not — some of them lose data a current-app phone wrote. So:
// - every run prints how many markers are left (look for «port owed» in the output);
// - the moment Mise 2 gains a service worker — which is what the switch is (step 4) — or the run is
//   told it is the switch build (MISE2_SWITCH=1), ONE marker left is a failure.
//
// ⚠️ MANY GAPS HAVE NO SPEC TO MARK (modules no spec pairs with its original: the recipe categories
// written whole, usage hours, the Orders draft journal, the piece weight in grams…). Those live as
// unticked `- [ ]` lines in docs/mise2-port-owed.md («Switch checklist»), and the same switch check
// refuses any of them left unticked. The switch PR sets MISE2_SWITCH=1 in CI (the go-live steps say so):
// the service-worker sniffing below is only a second net.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'PORT OWED (release branch';
const CHECKLIST = 'docs/mise2-port-owed.md';

function sources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function markers() {
  const found = [];
  for (const dir of ['app/src', 'shared/src']) {
    for (const file of sources(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes(MARKER)) found.push(`${file.slice(ROOT.length + 1).replace(/\\/g, '/')}:${i + 1}`);
      });
    }
  }
  return found;
}

// What the switch adds to Mise 2: a service worker of its own (registered from app/src, a worker
// file, or a PWA/Workbox build plugin).
function mise2HasServiceWorker() {
  const pkg = join(ROOT, 'app/package.json');
  if (existsSync(pkg) && /workbox|vite-plugin-pwa/i.test(readFileSync(pkg, 'utf8'))) return true;
  for (const name of ['app/public/sw.js', 'app/src/sw.ts', 'app/src/service-worker.ts']) {
    if (existsSync(join(ROOT, name))) return true;
  }
  const registers = /serviceWorker\s*\??\.\s*register\s*\(|registerSW\s*\(|VitePWA\s*\(/;
  const files = [...sources(join(ROOT, 'app/src')).filter((f) => !/\.spec\.tsx?$/.test(f)),
                 join(ROOT, 'app/index.html'), join(ROOT, 'app/vite.config.ts')].filter((f) => existsSync(f));
  return files.some((f) => registers.test(readFileSync(f, 'utf8')));
}

// The `- [ ]` lines of the checklist's «Switch checklist» section: what no spec can mark.
function unticked() {
  const text = readFileSync(join(ROOT, CHECKLIST), 'utf8');
  return text.split('\n').filter((line) => /^\s*- \[ \]/.test(line)).map((line) => line.trim().slice(0, 120));
}

test('⚠️ every expected failure in Mise 2\'s specs carries the marker', () => {
  // A `.fails` (or a skipped test) without the marker would hide a difference from the count below.
  // Each one carries the marker on the line above it, or is the switch on a PORT_OWED set, whose keys
  // carry the marker.
  const unmarked = [];
  for (const dir of ['app/src', 'shared/src']) {
    for (const file of sources(join(ROOT, dir)).filter((f) => /\.spec\.tsx?$/.test(f))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\b(test|it|describe)\.(fails|skip|todo)\b/.test(line)) return;
        if (line.includes('PORT_OWED.has(') || (i > 0 && lines[i - 1].includes(MARKER))) return;
        unmarked.push(`${file.slice(ROOT.length + 1).replace(/\\/g, '/')}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(unmarked, []);
});

test('mise2: port owed — the count of Mise 2 specs still waiting for a port of main', (t) => {
  const found = markers();
  t.diagnostic(`port owed: ${found.length} marker line(s) left in app/src and shared/src (one per test, or one per module in the PORT_OWED sets of parity.spec.ts and odd-inputs.spec.ts; 56 expected failures on 8 Nov 2026) — must be 0 before the switch`);
  for (const where of found) t.diagnostic(`  ${where}`);
  const open = unticked();
  t.diagnostic(`port owed: ${open.length} unticked line(s) in ${CHECKLIST} — must be 0 before the switch`);
});

test('⚠️ mise2: no port owed survives the switch (a Mise 2 service worker, or MISE2_SWITCH=1)', () => {
  const switching = process.env.MISE2_SWITCH === '1' || mise2HasServiceWorker();
  if (!switching) return;
  const found = markers();
  assert.deepEqual(found, [],
    `Mise 2 is about to take over with ${found.length} difference(s) from the current app still marked «PORT OWED»: port them first`);
  const open = unticked();
  assert.deepEqual(open, [],
    `Mise 2 is about to take over with ${open.length} item(s) of ${CHECKLIST} still unticked: port them, or record his decision and tick them`);
});
