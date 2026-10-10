// build-bundles.mjs — bundles each page's scripts into ONE file under dist/.
//
//   node scripts/build-bundles.mjs          build, then write dist/ (run after changing any js/ file)
//   node scripts/build-bundles.mjs --check  change nothing, exit 1 and list what is stale or missing
//
// ⚠️ WHY IT EXISTS (10 Oct 2026). A page used to load 55–140 separate module files; measured
// on a slow phone, loading fewer files cut the everyday open by about a quarter. esbuild is
// the ONE build tool in the repo and it runs on the developer's machine only: dist/ is
// COMMITTED (GitHub Pages serves only what is committed) and tests/bundles-fresh.test.mjs
// fails when a source changed and dist/ did not — the same shape as records.css.
//
// The design, and why each line is the way it is:
//  • One entry per page (js/pages/<page>.js) listing the scripts the page ran as separate tags.
//  • splitting is OFF. esbuild's code splitting can reorder module evaluation across chunks, and
//    these modules have top-level side effects.
//  • js/i18n.js stays OUT of every bundle and is written once as dist/i18n.js. It holds the
//    current-language state, so there must be ONE instance per page; and a release that changes
//    one feature then does not re-download it (429 KB) inside every bundle.
//  • The Firebase SDK (https://…) stays an import from gstatic, exactly as before.
//  • Identifiers are NOT minified, so a function name in an error report stays readable; source
//    maps (without sources) point back at ../js/…, which GitHub Pages serves.
//  • Every source is read with LF line endings, so this Windows checkout and CI's Linux produce
//    the same bytes.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import {
  ROOT, DIST_DIR, MANIFEST_FILE, PAGES_DIR, BUILD_CONFIG as C, BUILD_SCRIPTS, configSha, entryPages, readManifest, shaOfText,
  shaOfFile, toLF,
} from './bundle-lib.mjs';

// Every option lives in BUILD_CONFIG (bundle-lib), whose fingerprint the manifest records.
const I18N_SOURCE = C.i18nSource;
const MINIFY = { minifyWhitespace: C.minifyWhitespace, minifySyntax: C.minifySyntax, minifyIdentifiers: C.minifyIdentifiers };
const TARGET = C.target;

const readLF = file => toLF(readFileSync(file, 'utf8'));
const rel = abs => abs.replace(/\\/g, '/').slice(ROOT.replace(/\\/g, '/').length);

const plugins = [{
  name: 'mise-bundles',
  setup(build) {
    // The Firebase SDK (and any other https import) is loaded by the browser, as before.
    build.onResolve({ filter: new RegExp(C.externalUrlPattern) }, args => ({ path: args.path, external: true }));
    // Anything that lands on js/i18n.js becomes the sibling dist/i18n.js.
    build.onResolve({ filter: /i18n\.js$/ }, args => {
      if (args.kind === 'entry-point') return null;
      const abs = resolve(args.resolveDir, args.path);
      return rel(abs) === I18N_SOURCE ? { path: C.i18nExternalPath, external: true } : null;
    });
    // Every source is read with LF endings, whatever this checkout has.
    build.onLoad({ filter: /\.js$/, namespace: 'file' }, args => ({
      contents: readLF(args.path), loader: 'js',
    }));
  },
}];

function sortedInputs(paths) {
  const out = {};
  for (const p of [...paths].sort()) out[p] = shaOfFile(p);
  return out;
}

// Everything the build produces, in memory: { 'dist/index.js': text, … } plus the manifest.
export async function buildAll() {
  const pages = entryPages();
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: pages.map(p => `${PAGES_DIR}/${p}.js`),
    outdir: DIST_DIR,
    bundle: C.bundle,
    format: C.format,
    splitting: C.splitting,
    target: TARGET,
    ...MINIFY,
    legalComments: C.legalComments,
    sourcemap: C.sourcemap,
    sourcesContent: C.sourcesContent,
    metafile: true,
    write: false,
    logLevel: 'silent',
    plugins,
  });

  const files = {};
  for (const f of result.outputFiles) files[rel(f.path)] = toLF(f.text);

  // i18n.js has no imports (checked here), so it needs no bundling, only the same squeezing.
  const i18nSource = readLF(join(ROOT, I18N_SOURCE));
  if (/^\s*(import\s|export\s[^\n]*\sfrom\s)/m.test(i18nSource)) {
    throw new Error('js/i18n.js has imports now; it can no longer be written as a file of its own');
  }
  const i18n = await esbuild.transform(i18nSource, {
    loader: 'js', target: TARGET, ...MINIFY, legalComments: C.legalComments,
    sourcemap: 'external', sourcefile: '../js/i18n.js', sourcesContent: C.sourcesContent,
  });
  files[`${DIST_DIR}/i18n.js`] = toLF(i18n.code) + '//# sourceMappingURL=i18n.js.map\n';
  files[`${DIST_DIR}/i18n.js.map`] = toLF(i18n.map);

  const outputs = {};
  for (const [out, meta] of Object.entries(result.metafile.outputs)) {
    if (!out.endsWith('.js')) continue;
    outputs[out] = { sha: shaOfText(files[out]), mapSha: shaOfText(files[`${out}.map`]), inputs: sortedInputs(Object.keys(meta.inputs)) };
  }
  outputs[`${DIST_DIR}/i18n.js`] = {
    sha: shaOfText(files[`${DIST_DIR}/i18n.js`]),
    mapSha: shaOfText(files[`${DIST_DIR}/i18n.js.map`]),
    inputs: sortedInputs([I18N_SOURCE]),
  };
  const sorted = Object.fromEntries(Object.entries(outputs).sort(([a], [b]) => (a < b ? -1 : 1)));
  files[MANIFEST_FILE] = JSON.stringify({ esbuild: esbuild.version, config: configSha(), buildScripts: sortedInputs(BUILD_SCRIPTS), outputs: sorted }, null, 2) + '\n';
  return files;
}

// The files of dist/ that a build owns: bundles, their maps and the manifest.
function ownedFiles() {
  const dir = join(ROOT, DIST_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(n => /\.js(\.map)?$/.test(n) || n === 'build-manifest.json')
    .map(n => `${DIST_DIR}/${n}`);
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await buildAll();

  if (check) {
    const problems = [];
    for (const [name, text] of Object.entries(files)) {
      const abs = join(ROOT, name);
      if (!existsSync(abs)) problems.push(`${name} is missing`);
      else if (readLF(abs) !== text) problems.push(`${name} is stale`);
    }
    for (const name of ownedFiles()) if (!(name in files)) problems.push(`${name} belongs to no entry any more`);
    if (problems.length) {
      console.error(`dist/ is OUT OF DATE:\n  ${problems.join('\n  ')}\nRun: node scripts/build-bundles.mjs`);
      process.exit(1);
    }
    console.log(`dist/ is up to date: ${Object.keys(files).length} files match.`);
    return;
  }

  mkdirSync(join(ROOT, DIST_DIR), { recursive: true });
  for (const name of ownedFiles()) unlinkSync(join(ROOT, name));
  for (const [name, text] of Object.entries(files)) {
    // Written beside and renamed over, with LF endings whatever the platform.
    const abs = join(ROOT, name);
    writeFileSync(`${abs}.tmp`, text);
    renameSync(`${abs}.tmp`, abs);
  }
  const manifest = readManifest();
  const bundles = Object.keys(manifest.outputs);
  console.log(`dist/: ${bundles.length} bundles built with esbuild ${manifest.esbuild}.`);
  for (const b of bundles) console.log(`  ${b}  ${(files[b].length / 1024).toFixed(1)} KB`);
}

const invoked = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invoked) main().catch(err => { console.error(err.message || err); process.exit(1); });
