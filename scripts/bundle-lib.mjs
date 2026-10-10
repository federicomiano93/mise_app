// bundle-lib.mjs — what scripts/build-bundles.mjs and tests/bundles-fresh.test.mjs both need:
// which pages have an entry, how a file is fingerprinted, and how the manifest is read.
// One copy, so the script that WRITES the fingerprints and the test that CHECKS them cannot
// drift apart. No dependency: CI's test job installs nothing, and this must load there.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PAGES_DIR = 'js/pages';
export const DIST_DIR = 'dist';
export const MANIFEST_FILE = 'dist/build-manifest.json';
// The loader every entry imports. It is part of each bundle, never a bundle of its own.
export const SHARED_HELPER = 'run-in-order.js';
export const SHA_LENGTH = 16;

// A checkout on Windows has CRLF (core.autocrlf), CI and GitHub Pages have LF. Every
// fingerprint is taken on the LF form, so it comes out the same on both.
export const toLF = text => text.replace(/\r\n/g, '\n');

export const shaOfText = text =>
  createHash('sha256').update(toLF(text)).digest('hex').slice(0, SHA_LENGTH);

export const shaOfFile = (file, root = ROOT) => shaOfText(readFileSync(join(root, file), 'utf8'));

// «index» for js/pages/index.js — every entry file except the shared loader.
export function entryPages(root = ROOT) {
  return readdirSync(join(root, PAGES_DIR))
    .filter(n => n.endsWith('.js') && n !== SHARED_HELPER)
    .map(n => n.slice(0, -3))
    .sort();
}

export function readManifest(root = ROOT) {
  const file = join(root, MANIFEST_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

// Every `dist/<name>.js` a page loads with a <script> tag: { 'index.html': ['dist/index.js'] }.
export function bundleTagsByPage(root = ROOT) {
  const out = {};
  for (const name of readdirSync(root).filter(n => n.endsWith('.html'))) {
    const html = readFileSync(join(root, name), 'utf8');
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="(dist\/[^"]+)"[^>]*>/g)].map(m => m[1]);
    if (tags.length) out[name] = tags;
  }
  return out;
}

// What is wrong between the manifest and the files on disk. Empty means fresh.
export function manifestProblems(root = ROOT) {
  const problems = [];
  const manifest = readManifest(root);
  if (!manifest) return [`${MANIFEST_FILE} is missing`];
  const outputs = manifest.outputs || {};

  for (const page of entryPages(root)) {
    if (!outputs[`${DIST_DIR}/${page}.js`]) problems.push(`${PAGES_DIR}/${page}.js has no bundle in the manifest`);
  }
  for (const [out, info] of Object.entries(outputs)) {
    if (!existsSync(join(root, out))) { problems.push(`${out} is listed but missing`); continue; }
    if (shaOfFile(out, root) !== info.sha) problems.push(`${out} was edited by hand or is out of date`);
    if (!existsSync(join(root, `${out}.map`))) problems.push(`${out}.map is missing`);
    for (const [input, sha] of Object.entries(info.inputs || {})) {
      if (!existsSync(join(root, input))) problems.push(`${out} was built from ${input}, which no longer exists`);
      else if (shaOfFile(input, root) !== sha) problems.push(`${input} changed since ${out} was built`);
    }
  }
  for (const [page, tags] of Object.entries(bundleTagsByPage(root))) {
    for (const tag of tags) if (!existsSync(join(root, tag))) problems.push(`${page} loads ${tag}, which does not exist`);
  }
  return problems;
}
