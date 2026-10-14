// vendor-export-libs.mjs — rebuilds the two libraries the recipe export loads ON CLICK:
//
//   js/vendor/jspdf.esm.js             jsPDF 4.2.1            (MIT) — the PDF
//   js/vendor/write-excel-file.esm.js  write-excel-file 4.1.1 (MIT) — the .xlsx
//
//   node scripts/vendor-export-libs.mjs           run on this PC only, then commit both files
//   node scripts/vendor-export-libs.mjs --audit   install the same versions in a throwaway folder,
//                                                 run `npm audit --audit-level=high` there, print the
//                                                 result and write NOTHING to the repo
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
// For the same reason these packages are in NO lockfile and CI never audits them: --audit is how
// the monthly maintenance checks them. It audits what is really bundled (optional dependencies
// omitted, exactly as the build installs them).
//
// ⚠️ THE TARGET IS THE APP'S OWN FLOOR (BUILD_CONFIG.target, es2020 — Chrome 80 / Safari 13.1).
// Checked 14 Oct 2026: the only newer call left is Array.prototype.at, inside fast-png's APNG
// path (PNG images — never used); write-excel-file guards its one replaceAll.
//
// A new version: change VERSIONS, run this, read the diff of the headers, drive an export on the
// lab tablet, run the tests (tests/recipe-export-vendor.test.mjs pins that the headers name the
// versions below, and that the files are the ones the build keeps out of the bundles).
//
// Importing this file installs nothing and needs no dependency: only running it does (main guard at
// the end; esbuild is loaded inside build()).

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ROOT, BUILD_CONFIG } from './bundle-lib.mjs';

export const VERSIONS = { jspdf: '4.2.1', 'write-excel-file': '4.1.1' };

export const LIBS = [
  { pkg: 'jspdf', out: 'js/vendor/jspdf.esm.js', entry: "export { jsPDF } from 'jspdf';",
    external: ['html2canvas', 'canvg', 'dompurify'] },
  { pkg: 'write-excel-file', out: 'js/vendor/write-excel-file.esm.js',
    entry: "export { default } from 'write-excel-file/browser';", external: [] },
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

// The throwaway install, optional dependencies omitted. Returns nothing; the caller owns `work`.
function installInto(work) {
  writeFileSync(join(work, 'package.json'), '{"name":"vendor-tmp","private":true,"type":"module"}');
  execFileSync(npm, ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--save-exact',
    ...Object.entries(VERSIONS).map(([p, v]) => `${p}@${v}`)], { cwd: work, stdio: 'inherit', shell });
}

async function audit() {
  const work = mkdtempSync(join(tmpdir(), 'mise-vendor-'));
  try {
    installInto(work);
    try {
      execFileSync(npm, ['audit', '--audit-level=high'], { cwd: work, stdio: 'inherit', shell });
      console.log('npm audit: nothing at high severity or above.');
    } catch {
      console.log('npm audit reported problems (above). Nothing was written to the repo.');
      process.exitCode = 1;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function build() {
  // Loaded here, not at the top: CI's test job installs nothing, and the test imports this file.
  const esbuild = await import('esbuild');
  const work = mkdtempSync(join(tmpdir(), 'mise-vendor-'));
  try {
    installInto(work);
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
}

const invoked = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invoked) {
  (process.argv.includes('--audit') ? audit() : build()).catch((err) => { console.error(err.message || err); process.exit(1); });
}
