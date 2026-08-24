// Nothing inside a scrolling screen may sit against the phone's edge.
//
// ⚠️⚠️ FEDERICO SAW THIS TWICE AND THE SECOND TIME HE SAID «lo stesso difetto di prima».
// Measured on his own screenshot at 390px (DPR 2), «Fornitori e ingredienti» drew its
// view switch, its «+ Aggiungi fornitore» and every supplier row starting at 0px, while
// Orders started at 16px. Not an impression — pixels.
//
// THE CAUSE IS SHARED AND WILL HAPPEN AGAIN. `.scroll-area` gives its children only
// `padding-inline: var(--app-gutter)`, which is 0 on a phone — deliberately, so that
// adding the tablet cap in v1.56.0 could not move a single phone. Every page that uses
// it therefore has to pad its OWN content, and three of the four did (`.content`,
// `.home-grid`). suppliers.html never did, from the day it was born (v1.65.0).
//
// ⚠️ SO THIS TEST FINDS THE PAGES ITSELF. Three tests in v1.65.0 carried a hand-written
// list of pages and suppliers.html walked past all three — that is the whole reason it
// shipped unpadded. Here the pages come from the directory, the children come from the
// markup, and the exemptions are a CLOSED list with a reason beside each: a NEW child
// nobody thought about fails, which is the case that actually happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const CSS = ['style.css', 'orders.css', 'tokens.css', 'auth.css', 'catalogue.css']
  .map(read).join('\n');

// Classes that give their content the gutter. ⚠️ Each is CHECKED against the stylesheet
// below, so removing the padding from one of them fails here rather than on a phone.
const GUTTER = ['content', 'home-grid', 'install-host', 'requests-card-host',
  'reg-page', 'recipe-footer',
  // The Orders screen's own column, added when the order moved into one box:
  // the box needs a MARGIN (its border has to sit inside the screen), and a
  // margin is not what this guard looks for — rightly, since a margin can be
  // collapsed away. The column carries the padding for it.
  'orders-column'];

// A direct child that legitimately has no gutter of its own, and why. ⚠️ A reason that
// is only a sentence is worth less than one a machine can re-check, so where the reason
// IS checkable (the overlay's `position: fixed`, the panels' own class) it is checked.
const EXEMPT = {
  'index.html': {
    'home-reminder': 'the card it holds aligns itself with the grid above (a.home-reminder)',
    'session-logout-host': 'holds .session-logout, which is `margin: 28px auto` — centred, not full width',
  },
  'calculator.html': {
    'recipe-tabs': 'holds the recipe panels, and every one of them IS a .content',
  },
  'orders.html': {
    'history-overlay': 'position: fixed — a full-screen overlay, not a column of content',
  },
};

const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'path',
  'circle', 'rect', 'line', 'polyline', 'polygon', 'use', 'area', 'base', 'col',
  'embed', 'track', 'wbr', 'stop', 'ellipse']);

// The direct children of each `.scroll-area` in a page, by tag + class + id.
function scrollAreaChildren(html) {
  const src = html.replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  for (const open of src.matchAll(/<div class="scroll-area[^"]*"/g)) {
    const block = src.slice(open.index);
    const kids = [];
    let depth = 0;
    for (const m of block.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g)) {
      const [, close, tag, attrs, selfClose] = m;
      if (VOID.has(tag.toLowerCase()) || selfClose) continue;
      if (close) {
        depth -= 1;
        if (depth === 0) break;
      } else {
        if (depth === 1) {
          kids.push({
            tag,
            classes: (attrs.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean),
            id: attrs.match(/id="([^"]*)"/)?.[1] || '',
          });
        }
        depth += 1;
      }
    }
    found.push({ area: open[0].match(/class="([^"]*)"/)[1], kids });
  }
  return found;
}

// The declaration block of `.name`, wherever it is defined.
function ruleFor(name) {
  const at = CSS.indexOf(`\n.${name} {`);
  if (at < 0) return null;
  return CSS.slice(CSS.indexOf('{', at) + 1, CSS.indexOf('}', at));
}

// Does this block set left/right padding, and enough of it to read as a margin?
function padsHorizontally(block) {
  if (!block) return false;
  if (/padding-inline:\s*[^;]+/.test(block)) return true;
  const shorthand = block.match(/(?:^|[;{\s])padding:\s*([^;]+)/);
  if (!shorthand) return false;
  const parts = shorthand[1].trim().split(/\s+(?![^(]*\))/);
  const horizontal = parts.length === 1 ? parts[0] : parts[1];
  const px = parseFloat(horizontal);
  return Number.isFinite(px) ? px >= 12 : true;   // calc()/var() counts as intentional
}

test('⚠️ every class this app relies on for the gutter actually has one', () => {
  for (const name of GUTTER) {
    const block = ruleFor(name);
    assert.ok(block, `.${name} is in the gutter list but is defined in NO stylesheet — `
      + 'an undefined class is as silent as an undefined custom property');
    assert.ok(padsHorizontally(block),
      `.${name} is relied on for horizontal padding and no longer has any`);
  }
});

test('⚠️⚠️ nothing inside a .scroll-area is left touching the screen edge', () => {
  const pages = readdirSync(root).filter(f => f.endsWith('.html'));
  let checked = 0;
  const naked = [];
  for (const page of pages) {
    const html = read(page);
    if (!html.includes('class="scroll-area')) continue;
    for (const { area, kids } of scrollAreaChildren(html)) {
      assert.ok(kids.length, `${page}: parsed a .scroll-area (${area}) with no children — `
        + 'the parser is wrong, and a check that finds nothing passes for the wrong reason');
      for (const kid of kids) {
        checked += 1;
        if (kid.classes.some(c => GUTTER.includes(c))) continue;
        if (EXEMPT[page]?.[kid.id]) continue;
        naked.push(`${page}: <${kid.tag} id="${kid.id}" class="${kid.classes.join(' ')}"> `
          + 'sits directly in a .scroll-area with no gutter class');
      }
    }
  }
  // ⚠️ The count guard is the point: without it, a parser that quietly matched nothing
  // would report a perfect app. suppliers.html alone contributes three children.
  assert.ok(checked >= 10, `only ${checked} children were examined — the parser found `
    + 'almost nothing, so this test proved almost nothing');
  assert.deepEqual(naked, [], 'content with no gutter:\n' + naked.join('\n'));
});

// The specific screen he photographed, pinned by name so the fix cannot be undone
// quietly by someone tidying the markup.
test('⚠️ suppliers.html pads BOTH its children, the error line included', () => {
  const html = read('suppliers.html');
  assert.match(html, /<p class="orders-status error reg-page" id="registry-error"/,
    'a message saying the list failed to load must not itself be jammed against the edge');
  assert.match(html, /<div id="registry-host" class="reg-page">/);
  // ⚠️ AND THE FOOTER MUST NOT TAKE IT. The bar is the bottom edge of the app: it spans
  // the full width and lines its buttons up with its own padding-inline.
  const footer = html.match(/<div class="([^"]*)" id="registry-footer"/);
  assert.ok(footer, 'the bottom bar must still be there');
  assert.ok(!footer[1].includes('reg-page'),
    'the bar spans the screen on purpose — padding it would inset its own ground');
  // ⚠️ AND THE TOP OF THE LIST NEEDS AIR TOO. A mutation deleted this and every test
  // stayed green: the view switch went back to touching the header. It is `.content`'s
  // own 14px, and it is on the host alone — the error line sits above it and brings
  // its own spacing when it is shown at all.
  assert.match(read('orders.css'), /#registry-host\.reg-page \{[^}]*padding-top:\s*14px/,
    'the list must start 14px below the header, as .content does on every other page');
});

// ⚠️ THE STATE WORD IS THE ANSWER OF A SHUT SECTION, AND IT MAY NOT BREAK IN HALF.
// Once the «?» joined the head row, «DA COMPILARE» split across two lines at 320px.
// Between a section NAME wrapping and its ANSWER wrapping, the name gives way.
// A mutation removed the rule and nothing noticed.
test('⚠️ the state word never wraps, whatever else has to', () => {
  const css = read('orders.css');
  const at = css.indexOf('\n.alg-head-state {');
  assert.ok(at > 0, '.alg-head-state must be defined');
  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /white-space:\s*nowrap/,
    '«DA COMPILARE» broke over two lines at 320px once the «?» shared the row');
  assert.match(block, /flex-shrink:\s*0/,
    'and it must not be squeezed instead — nowrap alone would let it overflow');
});
