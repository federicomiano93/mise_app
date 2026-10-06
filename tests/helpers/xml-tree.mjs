// A small STRICT XML reader for the invoice tests (and the local golden comparison): text -> the plain tree
// js/orders/invoice-zip/fatturapa.js works on, { name, children, text }. Elements, attributes (checked, then
// ignored), text, CDATA, the five named entities and numeric ones, comments and processing instructions
// (skipped). Namespace prefixes are stripped from names, and an UNDECLARED prefix is an error, like a real
// parser. It throws on anything malformed: a broken file must be refused, never half read.
// This is NOT a general XML parser (no DTD, no external entities) — the browser uses DOMParser.

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.·À-￿-]/;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

class XmlError extends Error {}

function decodeEntities(raw) {
  return raw.replace(/&([^;&<\s]*);?/g, (match, body) => {
    if (!match.endsWith(';')) throw new XmlError('entità senza punto e virgola');
    if (body[0] === '#') {
      const hex = body[1] === 'x';
      const digits = body.slice(hex ? 2 : 1);
      if (!(hex ? /^[0-9A-Fa-f]+$/ : /^[0-9]+$/).test(digits)) throw new XmlError(`entità non valida &${body};`);
      const code = parseInt(digits, hex ? 16 : 10);
      if (!(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff)
        || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) {
        throw new XmlError(`carattere non ammesso &${body};`);
      }
      return String.fromCodePoint(code);
    }
    if (!Object.prototype.hasOwnProperty.call(NAMED, body)) throw new XmlError(`entità sconosciuta &${body};`);
    return NAMED[body];
  });
}

export function parseXmlTree(source) {
  const s = String(source).replace(/^﻿/, '');
  let i = 0;
  const stack = []; // open elements: { name, node, scopes }
  let root = null;
  const scopes = [{ xml: true }];

  const fail = (message) => { throw new XmlError(`${message} (posizione ${i})`); };
  const skipSpace = () => { while (i < s.length && /\s/.test(s[i])) i += 1; };
  const readName = () => {
    if (!NAME_START.test(s[i] || '')) fail('nome non valido');
    const start = i;
    while (i < s.length && NAME_CHAR.test(s[i])) i += 1;
    return s.slice(start, i);
  };
  const resolve = (qname, isAttribute) => {
    const parts = qname.split(':');
    if (parts.length > 2) fail(`nome non valido ${qname}`);
    if (parts.length === 1) return { local: qname, prefix: '' };
    const [prefix, local] = parts;
    if (!prefix || !local) fail(`nome non valido ${qname}`);
    if (!isAttribute || prefix !== 'xmlns') {
      if (!scopes.some((scope) => Object.prototype.hasOwnProperty.call(scope, prefix))) {
        fail(`prefisso non dichiarato ${prefix}`);
      }
    }
    return { local, prefix };
  };

  const text = (chunk) => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (chunk.trim()) fail('testo fuori dall’elemento radice');
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
      if (chunk.includes(']]>')) fail('«]]>» non ammesso nel testo');
      text(chunk);
      i = end;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end === -1) fail('istruzione non chiusa');
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) fail('commento non chiuso');
      if (s.slice(i + 4, end).includes('--')) fail('«--» non ammesso in un commento');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) fail('CDATA non chiuso');
      const top = stack[stack.length - 1];
      if (!top) fail('CDATA fuori dall’elemento radice');
      if (top.node.children.length === 0) top.node.text += s.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (s.startsWith('<!', i)) fail('DTD non ammessa');
    if (s.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (s[i] !== '>') fail('tag di chiusura non valido');
      i += 1;
      const open = stack.pop();
      if (!open || open.name !== name) fail(`tag di chiusura inatteso </${name}>`);
      scopes.pop();
      continue;
    }
    // a start tag
    i += 1;
    const name = readName();
    const attributes = [];
    const seen = new Set();
    let selfClosing = false;
    for (;;) {
      const before = i;
      skipSpace();
      if (s[i] === '>') { i += 1; break; }
      if (s[i] === '/' && s[i + 1] === '>') { i += 2; selfClosing = true; break; }
      if (i === before) fail('attributi non separati');
      const attrName = readName();
      skipSpace();
      if (s[i] !== '=') fail('attributo senza valore');
      i += 1;
      skipSpace();
      const quote = s[i];
      if (quote !== '"' && quote !== "'") fail('valore dell’attributo senza virgolette');
      const end = s.indexOf(quote, i + 1);
      if (end === -1) fail('valore dell’attributo non chiuso');
      const rawValue = s.slice(i + 1, end);
      if (rawValue.includes('<')) fail('«<» non ammesso in un attributo');
      if (seen.has(attrName)) fail(`attributo ripetuto ${attrName}`);
      seen.add(attrName);
      attributes.push([attrName, decodeEntities(rawValue)]);
      i = end + 1;
    }
    const scope = {};
    for (const [attrName] of attributes) {
      if (attrName === 'xmlns') scope[''] = true;
      else if (attrName.startsWith('xmlns:')) scope[attrName.slice(6)] = true;
    }
    scopes.push(scope);
    const { local } = resolve(name, false);
    for (const [attrName] of attributes) {
      if (attrName !== 'xmlns' && !attrName.startsWith('xmlns:')) resolve(attrName, true);
    }
    const node = { name: local, children: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent) parent.node.children.push(node);
    else if (root) fail('più di un elemento radice');
    else root = node;
    if (selfClosing) scopes.pop();
    else stack.push({ name, node });
  }
  if (stack.length) fail(`elemento non chiuso <${stack[stack.length - 1].name}>`);
  if (!root) fail('nessun elemento radice');
  return root;
}
