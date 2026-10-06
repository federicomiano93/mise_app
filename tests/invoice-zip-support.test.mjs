// The small pure pieces under the invoice reader: SHA-256, the Python-compatible numbers, the test XML reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256Hex, sha256Bytes } from '../js/orders/invoice-zip/sha256.js';
import { pyFloat, pySum, roundHalfUp, stripChars } from '../js/orders/invoice-zip/py-compat.js';
import { domToTree } from '../js/orders/invoice-zip/fatturapa.js';
import { parseXmlTree } from './helpers/xml-tree.mjs';

test('SHA-256 matches the FIPS 180-4 vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(
    sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  assert.equal(sha256Hex('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('SHA-256 agrees with node:crypto around every padding boundary and on unicode', () => {
  for (let length = 0; length <= 130; length += 1) {
    const bytes = randomBytes(length);
    assert.equal(sha256Bytes(bytes), createHash('sha256').update(bytes).digest('hex'), `${length} bytes`);
  }
  for (const text of ['è à ù', 'ÈRSSMRA80A01H501U', '日本語のテキスト', 'emoji 🍞 pane', 'x'.repeat(1000)]) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), text);
  }
});

test('pyFloat reads a decimal like Python float() and refuses what is not one', () => {
  assert.equal(pyFloat('25.00'), 25);
  assert.equal(pyFloat('-3.5'), -3.5);
  assert.equal(pyFloat('.5'), 0.5);
  assert.equal(pyFloat('1e3'), 1000);
  for (const bad of ['', ' ', 'abc', '1.2.3', '1,5', 'inf', 'nan', '1_000', null, undefined]) {
    assert.equal(pyFloat(bad), null, String(bad));
  }
});

test('roundHalfUp rounds the shortest decimal, ties away from zero (Decimal ROUND_HALF_UP)', () => {
  assert.equal(roundHalfUp(0.00005, 4), 0.0001);
  assert.equal(roundHalfUp(2.675, 2), 2.68); // toFixed(2) gives 2.67: the binary value is below the tie
  assert.equal(roundHalfUp(1.005, 2), 1.01);
  assert.equal(roundHalfUp(0.57, 4), 0.57);
  assert.equal(roundHalfUp(15.323529411764707, 4), 15.3235);
  assert.equal(roundHalfUp(9.090909090909092, 4), 9.0909);
  assert.equal(roundHalfUp(-0.00005, 4), -0.0001);
  assert.equal(roundHalfUp(1.5e-6, 6), 0.000002);
  assert.equal(roundHalfUp(1e21, 3), 1e21);
  assert.equal(roundHalfUp(0.05, 6), 0.05);
});

test('pySum adds like Python 3.12+ (compensated)', () => {
  assert.equal(pySum([0.1, 0.2, 0.3]), 0.6); // a plain loop gives 0.6000000000000001
  assert.equal(pySum([]), 0);
  assert.equal(pySum([1e100, 1.0, -1e100]), 1);
});

test('stripChars is str.strip(chars)', () => {
  assert.equal(stripChars('-- a b -.', ' -.'), 'a b');
  assert.equal(stripChars('', ' '), '');
  assert.equal(stripChars('xxx', 'x'), '');
});

test('the test XML reader builds the tree: local names, text before the first child, entities, CDATA', () => {
  const tree = parseXmlTree(
    '﻿<?xml version="1.0"?><!-- c --><p:A xmlns:p="urn:x" k="1"><p:B>a &amp; b &#65; &#x42;<![CDATA[ <c> ]]></p:B>'
    + '<C/><D>x<E>inner</E>tail</D></p:A>');
  assert.equal(tree.name, 'A');
  assert.deepEqual(tree.children.map((c) => c.name), ['B', 'C', 'D']);
  assert.equal(tree.children[0].text, 'a & b A B <c> ');
  assert.equal(tree.children[2].text, 'x');
  assert.equal(tree.children[2].children[0].text, 'inner');
});

test('the test XML reader throws on malformed input', () => {
  const bad = [
    '', '   ', '<a><b></a>', '<a>', '<a></b>', '<a/><b/>', 'text<a/>', '<a/>text', '<a k=1/>', '<a k="1" k="2"/>',
    '<a>&unknown;</a>', '<a>&amp</a>', '<a>&#xZZ;</a>', '<a><!-- x --- y --></a>', '<a><![CDATA[ x </a>',
    '<q:a/>', '<a b:c="1"/>', '<!DOCTYPE a><a/>', '<a k="<"/>', '<a>x]]>y</a>', '<1a/>', '<a><b/ ></a>',
  ];
  for (const text of bad) assert.throws(() => parseXmlTree(text), Error, JSON.stringify(text));
});

test('domToTree converts what a DOMParser result exposes and refuses a parsererror document', () => {
  const el = (localName, childNodes) => ({ nodeType: 1, localName, childNodes });
  const txt = (nodeValue, nodeType = 3) => ({ nodeType, nodeValue });
  const document = {
    documentElement: el('A', [txt('hi '), txt('there', 4), el('B', [txt('x')]), txt('tail'), { nodeType: 8, nodeValue: 'c' }]),
    getElementsByTagName: () => [],
  };
  assert.deepEqual(domToTree(document), {
    name: 'A', text: 'hi there', children: [{ name: 'B', text: 'x', children: [] }],
  });
  assert.throws(() => domToTree({ documentElement: el('parsererror', []) }), /invalid XML/);
  assert.throws(() => domToTree({ documentElement: el('a', []), getElementsByTagName: () => [{}] }), /invalid XML/);
  assert.throws(() => domToTree({ documentElement: null }), /empty XML/);
});
