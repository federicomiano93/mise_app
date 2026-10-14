// vendor-export-libs.mjs — rebuilds the two libraries the recipe export loads ON CLICK:
//
//   js/vendor/jspdf.esm.js             jsPDF 4.2.1            (MIT) — the PDF
//   js/vendor/write-excel-file.esm.js  write-excel-file 4.1.1 (MIT) — the .xlsx
//
//   node scripts/vendor-export-libs.mjs     run on this PC only, then commit both files
//
// ⚠️ WHY A SCRIPT AND NOT A FILE COPIED BY HAND, LIKE fflate AND Sortable. Those two ship one ES
// file each; these do not. jsPDF imports fast-png, fflate and @babel/runtime, write-excel-file
// imports fflate, so each must be BUNDLED into one file — and a bundle nobody can rebuild is a
// bundle nobody can check. This script is the recipe: exact versions, installed with
// --ignore-scripts into a throwaway folder (nothing lands in the repo's node_modules or
// lockfile, so CI still installs nothing), bundled by the repo's own pinned esbuild.
//
// ⚠️ NOT devDependencies, ON PURPOSE. jsPDF lists html2canvas, canvg, dompurify and core-js as
// OPTIONAL dependencies; in the root lockfile they would join CI's `npm audit`, and an advisory
// in code the app never ships (dompurify has had several) would turn every merge red. They are
// left out here (--omit=optional) and their dynamic imports stay external: jsPDF reaches them
// only from doc.html() and SVG images, which the export never calls.
//
// ⚠️ THE TARGET IS THE APP'S OWN FLOOR (BUILD_CONFIG.target, es2020 — Chrome 80 / Safari 13.1).
// Checked 14 Oct 2026: the only newer call left is Array.prototype.at, inside fast-png's APNG
// path (PNG images — never used); write-excel-file guards its one replaceAll.
//
// A new version: change VERSIONS, run this, read the diff of the headers, drive an export on the
// lab tablet, run the tests (tests/recipe-export-vendor.test.mjs pins the versions in the headers).

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { ROOT, BUILD_CONFIG } from './bundle-lib.mjs';

export const VERSIONS = { jspdf: '4.2.1', 'write-excel-file': '4.1.1' };

const LIBS = [
  { pkg: 'jspdf', out: 'js/vendor/jspdf.esm.js', entry: "export { jsPDF } from 'jspdf';",
    external: ['html2canvas', 'canvg', 'dompurify'] },
  { pkg: 'write-excel-file', out: 'js/vendor/write-excel-file.esm.js',
    entry: "export { default } from 'write-excel-file/browser';", external: [] },
];

const work = mkdtempSync(join(tmpdir(), 'mise-vendor-'));
try {
  writeFileSync(join(work, 'package.json'), '{"name":"vendor-tmp","private":true,"type":"module"}');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--save-exact',
    ...Object.entries(VERSIONS).map(([p, v]) => `${p}@${v}`)], { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
  const lock = JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8'));

  for (const lib of LIBS) {
    const entryFile = join(work, `entry-${lib.pkg}.js`);
    writeFileSync(entryFile, lib.entry + '\n');
    const result = await esbuild.build({
      absWorkingDir: work, entryPoints: [entryFile], bundle: true, format: 'esm', write: false,
      target: BUILD_CONFIG.target, minify: true, legalComments: 'inline', external: lib.external,
      metafile: true, logLevel: 'warning',
    });
    // Every package that really ended up inside THIS bundle (esbuild's own list of inputs), with
    // the integrity npm checked its tarball against.
    const dirs = new Set(Object.keys(result.metafile.inputs)
      .map(p => (p.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/) || [])[1]).filter(Boolean));
    const inside = [...dirs].sort().map(name => {
      const meta = lock.packages[`node_modules/${name}`];
      return ` *   ${name}@${meta.version}  (${meta.license})  ${meta.integrity}`;
    });
    const header = [
      '/**!',
      ` * ${lib.pkg} ${VERSIONS[lib.pkg]} — bundled into one ES module by scripts/vendor-export-libs.mjs.`,
      ' * Do not edit: change the script and run it again. Loaded only when somebody exports a recipe.',
      ' * Packages inside (from the throwaway install\'s package-lock.json):',
      ...inside,
      " * Each package's licence is in brackets above; the notices the packages carry are kept inline below.",
      ' */',
    ].join('\n');
    // LF endings whatever this checkout has, so the file is the same bytes here and in CI.
    writeFileSync(join(ROOT, lib.out), (header + '\n' + result.outputFiles[0].text).replace(/\r\n/g, '\n'));
    console.log(`wrote ${lib.out} (${Math.round(result.outputFiles[0].contents.length / 1024)} KB)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
