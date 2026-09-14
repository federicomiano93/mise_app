// build-records-css.mjs — writes records.css, the styles of the two record cards (an
// ingredient, a supplier) for pages that do not load orders.css.
//
//   node scripts/build-records-css.mjs
//
// Why a generated copy: the cards were drawn only on Orders pages, which load style.css and
// orders.css. Since 13 Sep 2026 the Catalogue opens the ingredient card too, and loading the
// whole Orders stylesheet there would pull in a feature's worth of rules the page never
// uses. Moving the rules out of orders.css instead would re-order the cascade of every Orders
// page that was measured with it. So orders.css stays untouched, and this script copies
// exactly the rules whose every class is one the cards draw — declarations unchanged,
// selectors scoped under `.rec-host`, the class on the layer holding a card.
//
// tests/records-css.test.mjs runs buildRecordsCss() and demands records.css be identical, so
// a style changed in orders.css, or a class added to a card, fails the suite until this is
// run again.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The files that draw the cards, and the layer that hosts them in the Catalogue.
export const CARD_FILES = Object.freeze([
  'js/ingredient-record-form.js',
  'js/record-ui.js',
  'js/supplier-record-form.js',
  'js/catalogue/ingredient-create.js',
]);
// Drawn inside a card by js/help-button.js, not by the card's own code.
const EXTRA_CLASSES = Object.freeze(['help-btn']);
// Where the rules are copied from, in the order the Orders pages load them.
const SOURCES = Object.freeze(['style.css', 'orders.css']);

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const squash = s => s.replace(/\s+/g, ' ').trim();
const classesOf = selector => [...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1]);
const escape = s => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// Every class a card can carry.
function cardClasses(read) {
  const used = new Set(EXTRA_CLASSES);
  for (const file of CARD_FILES) {
    const src = read(file);
    for (const m of src.matchAll(/class(?:Name)?\s*[:=]\s*(['"`])([^'"`]+)\1/g)) {
      m[2].split(/\s+/).forEach(c => { if (c && !c.includes('$')) used.add(c); });
    }
    for (const m of src.matchAll(/classList\.(?:add|toggle|remove|contains)\(\s*'([^']+)'/g)) used.add(m[1]);
    // Classes assembled from pieces: 'alg-head-state' + ' alg-head-state--warn'.
    for (const m of src.matchAll(/'\s?((?:alg|mgmt|day|btn)-[\w-]+)/g)) used.add(m[1]);
  }
  return used;
}

// A stylesheet as a flat list of { head, body, media }.
function parseRules(text, media = null, out = []) {
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf('{', pos);
    if (open < 0) break;
    const head = text.slice(pos, open).trim();
    let depth = 1;
    let end = open + 1;
    while (depth && end < text.length) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}') depth--;
      end++;
    }
    const body = text.slice(open + 1, end - 1);
    if (/^@media|^@supports/.test(head)) parseRules(body, head, out);
    else out.push({ head, body, media });
    pos = end;
  }
  return out;
}

export function buildRecordsCss(readFile) {
  const read = name => readFile(name).replace(/\r\n/g, '\n');
  const used = cardClasses(read);
  const rules = [];
  const vars = new Set();
  for (const file of SOURCES) {
    for (const rule of parseRules(stripComments(read(file)))) {
      if (rule.head.startsWith('@')) continue;
      const parts = rule.head.split(',').map(p => p.trim()).filter(part => {
        const classes = classesOf(part);
        return classes.length && classes.every(c => used.has(c)) && !/^(html|body|:root)\b/.test(part);
      });
      if (!parts.length) continue;
      rules.push({ file, media: rule.media, parts, body: rule.body });
      for (const m of rule.body.matchAll(/var\((--[\w-]+)/g)) vars.add(m[1]);
    }
  }

  // ⚠️ AND THE PAGE-WIDE RULES OF style.css THAT REACH A CARD ON THE ORDERS PAGES: the reset
  // that zeroes every margin (paragraphs, tick boxes) and the Calculator's number boxes (bold,
  // no spinner). They carry no class, so the loop above cannot see them — found by measuring
  // the card on both pages. Scoped inside :where(), which keeps their ORIGINAL zero-class
  // weight: on the Orders pages they lose to every class rule, and so must they here. (An iOS
  // older than 14 ignores :where() and drops these few rules; the card then keeps the
  // browser's own margins — a looser card, never a broken one.)
  const globals = [];
  for (const rule of parseRules(stripComments(read('style.css')))) {
    if (rule.head.startsWith('@')) continue;
    const parts = rule.head.split(',').map(p => p.trim())
      .filter(part => !classesOf(part).length && /^(\*|input\[type="number"\])(?![\w-])/.test(part));
    if (parts.length) globals.push({ parts, body: rule.body });
  }

  // The custom properties those rules name that tokens.css does not define — style.css's
  // own aliases onto the shared tokens — with style.css's own values.
  const tokens = stripComments(read('tokens.css'));
  const aliases = [];
  for (const name of [...vars].sort()) {
    if (new RegExp(`${escape(name)}\\s*:`).test(tokens)) continue;
    for (const file of SOURCES) {
      const m = stripComments(read(file)).match(new RegExp(`${escape(name)}\\s*:\\s*([^;]+);`));
      if (m) { aliases.push(`  ${name}: ${squash(m[1])};`); break; }
    }
  }

  // What a card INHERITS on the Orders pages: style.css's body sets the font and the colour and
  // leaves line-height and smoothing to the browser. The host page's own body (catalogue.css:
  // a wider font stack, line-height 1.45, antialiased) would otherwise make every label of the
  // card a fraction taller than on «Fornitori e ingredienti» — measured, 0.4px a line.
  const bodyRule = parseRules(stripComments(read('style.css'))).find(r => r.head === 'body');
  const bodyValue = (prop, fallback) => {
    const m = bodyRule && bodyRule.body.match(new RegExp(`(?:^|;)\\s*${escape(prop)}\\s*:\\s*([^;]+)`));
    return m ? squash(m[1]) : fallback;
  };
  const inherited = [
    ['font-family', bodyValue('font-family', 'inherit')],
    ['color', bodyValue('color', 'inherit')],
    ['line-height', bodyValue('line-height', 'normal')],
    ['-webkit-font-smoothing', bodyValue('-webkit-font-smoothing', 'auto')],
  ].map(([prop, value]) => `  ${prop}: ${value};`);

  const declarations = body => body.split(';').map(squash).filter(Boolean).map(d => `  ${d};`).join('\n');
  let css = `/* records.css — GENERATED by scripts/build-records-css.mjs. Do not edit by hand.

   The styles of the two record cards (an ingredient, a supplier) for pages that do not load
   orders.css — today catalogue.html, where a recipe row's missing ingredient is added with the
   same card «Fornitori e ingredienti» uses (13 Sep 2026).

   Every rule is a rule of style.css or orders.css with its declarations unchanged and its
   selector scoped under .rec-host, the layer holding a card, so it styles those cards and
   nothing else on the page. tests/records-css.test.mjs fails when this file and its sources
   part: run the script again. */

/* The names style.css gives the shared tokens; catalogue.html does not load style.css. */
.rec-host {
${aliases.join('\n')}
}

/* What a card inherits on the Orders pages (style.css body), not what this page's body gives. */
.rec-host .mgmt-scroll {
${inherited.join('\n')}
}
`;
  if (globals.length) {
    css += `\n/* ── page-wide rules of style.css, at their original weight ── */\n`;
    for (const rule of globals) {
      css += `${rule.parts.map(p => `:where(.rec-host .mgmt-scroll) ${p}`).join(',\n')} {\n${declarations(rule.body)}\n}\n`;
    }
  }
  let lastFile = null;
  for (const rule of rules) {
    if (rule.file !== lastFile) { css += `\n/* ── from ${rule.file} ── */\n`; lastFile = rule.file; }
    const block = `${rule.parts.map(p => `.rec-host ${p}`).join(',\n')} {\n${declarations(rule.body)}\n}\n`;
    css += rule.media
      ? `${rule.media} {\n${block.replace(/^(?=.)/gm, '  ')}}\n`
      : block;
  }
  return css;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../', import.meta.url);
  const css = buildRecordsCss(name => readFileSync(new URL(name, root), 'utf8'));
  writeFileSync(new URL('records.css', root), css);
  console.log(`records.css written: ${css.split('\n').length} lines`);
}
