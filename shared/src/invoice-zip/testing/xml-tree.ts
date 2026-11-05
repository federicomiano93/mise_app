// A small STRICT XML reader for the invoice specs (Node has no DOMParser): text -> the plain tree
// fatturapa.ts works on, { name, children, text }. Elements, attributes (checked, then ignored), text, CDATA, the
// five named entities and numeric ones, comments and processing instructions (skipped). Namespace prefixes are
// stripped from names, and an UNDECLARED prefix is an error, like a real parser. It throws on anything malformed:
// a broken file must be refused, never half read.
// This is NOT a general XML parser (no DTD, no external entities) — the browser uses DOMParser.
//
// A port of tests/helpers/xml-tree.mjs (the helper of the current app's tests); the error messages are in English.
// Specs only: nothing in the app imports it.

import type { TreeNode } from '../fatturapa';

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.·À-￿-]/;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

class XmlError extends Error {}

function decodeEntities(raw: string): string {
  return raw.replace(/&([^;&<\s]*);?/g, (match: string, body: string) => {
    if (!match.endsWith(';')) throw new XmlError('entity without a semicolon');
    if (body[0] === '#') {
      const hex = body[1] === 'x';
      const digits = body.slice(hex ? 2 : 1);
      if (!(hex ? /^[0-9A-Fa-f]+$/ : /^[0-9]+$/).test(digits)) throw new XmlError(`invalid entity &${body};`);
      const code = parseInt(digits, hex ? 16 : 10);
      if (!(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff)
        || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) {
        throw new XmlError(`character not allowed &${body};`);
      }
      return String.fromCodePoint(code);
    }
    if (!Object.prototype.hasOwnProperty.call(NAMED, body)) throw new XmlError(`unknown entity &${body};`);
    return NAMED[body] as string;
  });
}

interface OpenElement { name: string; node: TreeNode }

export function parseXmlTree(source: unknown): TreeNode {
  const s = String(source).replace(/^﻿/, '');
  let i = 0;
  const stack: OpenElement[] = []; // open elements
  let root: TreeNode | null = null;
  const scopes: Record<string, boolean>[] = [{ xml: true }];

  const fail = (message: string): never => { throw new XmlError(`${message} (position ${i})`); };
  const skipSpace = (): void => { while (i < s.length && /\s/.test(s[i] as string)) i += 1; };
  const readName = (): string => {
    if (!NAME_START.test(s[i] || '')) fail('invalid name');
    const start = i;
    while (i < s.length && NAME_CHAR.test(s[i] as string)) i += 1;
    return s.slice(start, i);
  };
  const resolve = (qname: string, isAttribute: boolean): { local: string; prefix: string } => {
    const parts = qname.split(':');
    if (parts.length > 2) fail(`invalid name ${qname}`);
    if (parts.length === 1) return { local: qname, prefix: '' };
    const [prefix, local] = parts as [string, string];
    if (!prefix || !local) fail(`invalid name ${qname}`);
    if (!isAttribute || prefix !== 'xmlns') {
      if (!scopes.some((scope) => Object.prototype.hasOwnProperty.call(scope, prefix))) {
        fail(`undeclared prefix ${prefix}`);
      }
    }
    return { local, prefix };
  };

  const text = (chunk: string): void => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (chunk.trim()) fail('text outside the root element');
      return;
    }
    const decoded = decodeEntities(chunk);
    if (top.node.children.length === 0) top.node.text += decoded;
  };

  while (i < s.length) {
    if (s[i] !== '<') {
      const next = s.indexOf('<', i);
      const end = next === -1 ? s.length : next;
      const chunk = s.slice(i, end);
      if (chunk.includes(']]>')) fail('«]]>» not allowed in text');
      text(chunk);
      i = end;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end === -1) fail('unclosed instruction');
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) fail('unclosed comment');
      if (s.slice(i + 4, end).includes('--')) fail('«--» not allowed in a comment');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) fail('unclosed CDATA');
      const top = stack[stack.length - 1];
      if (!top) fail('CDATA outside the root element');
      if ((top as OpenElement).node.children.length === 0) (top as OpenElement).node.text += s.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (s.startsWith('<!', i)) fail('DTD not allowed');
    if (s.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (s[i] !== '>') fail('invalid closing tag');
      i += 1;
      const open = stack.pop();
      if (!open || open.name !== name) fail(`unexpected closing tag </${name}>`);
      scopes.pop();
      continue;
    }
    // a start tag
    i += 1;
    const name = readName();
    const attributes: [string, string][] = [];
    const seen = new Set<string>();
    let selfClosing = false;
    for (;;) {
      const before = i;
      skipSpace();
      if (s[i] === '>') { i += 1; break; }
      if (s[i] === '/' && s[i + 1] === '>') { i += 2; selfClosing = true; break; }
      if (i === before) fail('attributes not separated');
      const attrName = readName();
      skipSpace();
      if (s[i] !== '=') fail('attribute without a value');
      i += 1;
      skipSpace();
      const quote = s[i];
      if (quote !== '"' && quote !== "'") fail('attribute value without quotes');
      const end = s.indexOf(quote as string, i + 1);
      if (end === -1) fail('unclosed attribute value');
      const rawValue = s.slice(i + 1, end);
      if (rawValue.includes('<')) fail('«<» not allowed in an attribute');
      if (seen.has(attrName)) fail(`repeated attribute ${attrName}`);
      seen.add(attrName);
      attributes.push([attrName, decodeEntities(rawValue)]);
      i = end + 1;
    }
    const scope: Record<string, boolean> = {};
    for (const [attrName] of attributes) {
      if (attrName === 'xmlns') scope[''] = true;
      else if (attrName.startsWith('xmlns:')) scope[attrName.slice(6)] = true;
    }
    scopes.push(scope);
    const { local } = resolve(name, false);
    for (const [attrName] of attributes) {
      if (attrName !== 'xmlns' && !attrName.startsWith('xmlns:')) resolve(attrName, true);
    }
    const node: TreeNode = { name: local, children: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent) parent.node.children.push(node);
    else if (root) fail('more than one root element');
    else root = node;
    if (selfClosing) scopes.pop();
    else stack.push({ name, node });
  }
  if (stack.length) fail(`unclosed element <${(stack[stack.length - 1] as OpenElement).name}>`);
  if (!root) fail('no root element');
  return root as unknown as TreeNode;
}
