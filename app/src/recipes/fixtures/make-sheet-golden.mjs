// make-sheet-golden.mjs — writes label-sheet-golden.json: the MARKUP the CURRENT app's `buildSheet()`
// (js/catalogue/label-print.js) draws for every label of the corpus (shared/src/fixtures/label-corpus.ts), for the
// three paper profiles, for a GB and an IT venue, at the starting font size. Run with plain node, from anywhere:
//
//     node app/src/recipes/fixtures/make-sheet-golden.mjs
//
// WHY IT EXISTS (parity doc item 110c). LabelSheet.spec.tsx compares the React sheet with `buildSheet()` as outerHTML,
// and that holds only while js/ exists. At the switch js/ is deleted; this file is what keeps the sheet pinned after
// that: the spec also compares LabelSheet's outerHTML with the committed JSON, byte for byte.
//
// EVERYTHING HERE COMES FROM js/, NEVER FROM THE PORTS: the label, the paper, the date and the sheet. If the ports
// disagree with this file, one of them is wrong — fix the port; regenerate only when the CURRENT app was deliberately
// changed (and say so in the commit). NEVER to make a red spec green.
//
// jsdom (an app devDependency) stands in for the browser: buildSheet() builds real DOM nodes. It is installed only
// to read `document`; nothing else of the page exists.
//
// Deterministic: keys in corpus order, one entry per line, a final newline. Writes one file next to this script.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { LABEL_CORPUS, MADE_ON_PARTS, TEMPLATE_PROFILES } from '../../../../shared/src/fixtures/label-corpus.ts';

globalThis.document = new JSDOM('<!doctype html><html><body></body></html>').window.document;

const market = await import('../../../../js/market.js');
const label = await import('../../../../js/catalogue/recipe-label-model.js');
const template = await import('../../../../js/catalogue/label-template-model.js');
const { buildSheet } = await import('../../../../js/catalogue/label-print.js');

const MADE_ON = new Date(...MADE_ON_PARTS);
const VENUES = { GB: { country: 'GB' }, IT: { country: 'IT' } };

const sheets = {};
for (const entry of LABEL_CORPUS) {
  const built = label.buildLabel(entry.recipe, entry.tables, { shows: 'both' });
  if (!built.ok) continue;
  for (const [profileName, profile] of Object.entries(TEMPLATE_PROFILES)) {
    for (const [venueName, location] of Object.entries(VENUES)) {
      const lang = market.outputLanguage(location);
      const extras = { netWeightG: 1200, dateText: template.dateText(template.useByDate(3, MADE_ON), lang) };
      const resolved = template.resolveLabel(built, profile, extras, lang);
      if (!resolved.ok) continue;
      sheets[`${entry.id}|${profileName}|${venueName}`] = buildSheet(resolved, resolved.fontMm).outerHTML;
    }
  }
}

const lines = Object.entries(sheets).map(([key, html]) => `  ${JSON.stringify(key)}: ${JSON.stringify(html)}`);
const target = fileURLToPath(new URL('./label-sheet-golden.json', import.meta.url));
writeFileSync(target, `{\n${lines.join(',\n')}\n}\n`);
console.log(`wrote ${target} (${lines.length} sheets)`);
