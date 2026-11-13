// join-link.ts — how a join code TRAVELS: as six digits read aloud, or as a link.
//
// PARTIAL port of js/join-link.js for Mise 2: `JOIN_PAGE`, `joinLinkFor`, `readJoinToken` and
// `kindOfTyped`, identical input for input (join-link.spec.ts runs every test against BOTH files).
// It leaves out the two functions that look a word up in the interface dictionary, which in Mise 2
// belongs to the app: `codeShapeHint` (the app says `join.shapeHint` through its own t()) and
// `expiresInWords` (the arithmetic is `expiresIn` of join-code.ts; the words come with the invite
// card, staff slice 3). Not paired in parity.spec.ts for that reason; join-link.spec.ts compares the
// names, arity and constants of what it does port.
//
// ⚠️ WHY THIS IS NOT IN join-code.ts. That file's original is copied byte-for-byte into functions/,
// because the limits that make six digits safe are only safe together. Nothing here is ever asked on
// the server — the server is TOLD which kind it is being given.

import { isWellFormed, normalizeTyped } from './join-code';
import type { JoinCodeKind } from './join-code';

// shared/ compiles with no DOM and no Node types (it is pure logic); the three platform globals this
// file needs exist in every browser and in Node, and are declared here exactly as far as it uses them.
declare const URL: new (path: string, base?: string) => { origin: string; pathname: string; hash: string };
declare const URLSearchParams: new (init: string) => { get(name: string): string | null };
declare const window: { location: { href: string } } | undefined;

// Where a join link lands: the app's front door. Not a page of its own — whoever opens it may
// already be signed in, may have an account and no venue, or may be a stranger, and the front door
// is the one screen that already tells those apart.
//
// ⚠️ THE SAME SHAPE AS THE CURRENT APP'S, ON PURPOSE (docs/parity/staff-plan.md, slice 1): a link
// sent just before the switch is `…/index.html#join=<token>`, and it must still open Mise 2.
export const JOIN_PAGE = 'index.html';

// The name of the fragment field. Short, because it is typed nowhere and read by machines only.
const FIELD = 'join';

// ⚠️ THE TOKEN GOES AFTER THE #, AND THAT IS A SECURITY DECISION, NOT A STYLE ONE. A fragment is
// never sent to the server, so it cannot land in a web-server log, a proxy log, or a Referer header
// on the way to some other site.
export function joinLinkFor(token: unknown, href?: string): string {
  const code = String(token == null ? '' : token);
  const base = new URL(JOIN_PAGE, href || (typeof window !== 'undefined' ? window.location.href : 'https://example.invalid/'));
  return `${base.origin}${base.pathname}#${FIELD}=${encodeURIComponent(code)}`;
}

// Pull a token back out of an address. Returns '' for anything that is not one — a missing
// fragment, another app's fragment, a truncated paste.
//
// ⚠️ IT VALIDATES THE SHAPE BEFORE HANDING IT BACK. Whatever is in a URL was put there by whoever
// sent the link, so it is untrusted input: a caller that pasted it straight into a network call
// would spend a join attempt on rubbish.
export function readJoinToken(href: unknown): string {
  let hash = '';
  try {
    hash = new URL(String(href == null ? '' : href)).hash;
  } catch {
    return '';
  }
  if (!hash || hash.length < 2) return '';

  const found = new URLSearchParams(hash.slice(1)).get(FIELD);
  if (!found) return '';

  const token = normalizeTyped(found, 'link');
  return isWellFormed(token, 'link') ? token : '';
}

// Which kind of code is this? 'digits', 'link', or null when it is neither, so a caller can refuse
// before spending one of five attempts an hour.
//
// ⚠️ THE TWO SHAPES CANNOT OVERLAP: six digits are exactly six characters; a link is at least
// thirty-two. ⚠️ IT REQUIRES A STRING, exactly as isWellFormed does: everything real that reaches
// here is an input's value or a URL fragment, so a number means a caller has lost track.
export function kindOfTyped(input: unknown): JoinCodeKind | null {
  if (typeof input !== 'string') return null;
  if (isWellFormed(normalizeTyped(input, 'digits'), 'digits')) return 'digits';
  if (isWellFormed(normalizeTyped(input, 'link'), 'link')) return 'link';
  return null;
}
