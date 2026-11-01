// The two vendored export libraries: the headers name the versions the script installs, and the
// files the build keeps out of the bundles are the ones the script writes. (Importing the script
// installs nothing: it runs only when invoked.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSIONS, LIBS } from '../scripts/vendor-export-libs.mjs';
import { BUILD_CONFIG } from '../scripts/bundle-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('each vendored header names exactly the version the script installs', () => {
  assert.deepEqual(LIBS.map(l => l.pkg).sort(), Object.keys(VERSIONS).sort());
  for (const lib of LIBS) {
    const head = readFileSync(join(root, lib.out), 'utf8').split('\n').slice(0, 12).join('\n');
    assert.ok(head.includes(` * ${lib.pkg} ${VERSIONS[lib.pkg]} — bundled into one ES module`), `${lib.out} header`);
    assert.ok(head.includes(`${lib.pkg}@${VERSIONS[lib.pkg]}`), `${lib.out} package list`);
  }
});

test('the files the build keeps out of the bundles are exactly the ones the script writes', () => {
  assert.deepEqual([...BUILD_CONFIG.lazyVendorFiles].sort(), LIBS.map(l => l.out).sort());
});

test('the script documents --audit and writes nothing to the repo in that mode', () => {
  const src = readFileSync(join(root, 'scripts/vendor-export-libs.mjs'), 'utf8');
  assert.match(src, /--audit/);
  const auditBody = src.slice(src.indexOf('async function audit()'), src.indexOf('async function build()'));
  assert.match(auditBody, /\['audit', '--audit-level=high'\]/);
  assert.doesNotMatch(auditBody, /ROOT|writeFileSync\(join\(ROOT/);
});
