// The test XML reader (testing/xml-tree.ts) is itself pinned, because every invoice spec reads its XML through it.
// Ported from the two XML-reader tests of tests/invoice-zip-support.test.mjs ('the test XML reader builds the tree…',
// 'the test XML reader throws on malformed input'). The helper has no js/ twin to run against: the original lives in
// tests/helpers/, which no spec of shared/ imports. With sha256.spec.ts, py-compat.spec.ts and fatturapa.spec.ts
// (domToTree), the nine tests of that file are all ported.

import { describe, expect, test } from 'vitest';
import { parseXmlTree } from './xml-tree';

describe('the test XML reader', () => {
  test('builds the tree: local names, text before the first child, entities, CDATA', () => {
    const tree = parseXmlTree(
      '﻿<?xml version="1.0"?><!-- c --><p:A xmlns:p="urn:x" k="1"><p:B>a &amp; b &#65; &#x42;<![CDATA[ <c> ]]></p:B>'
      + '<C/><D>x<E>inner</E>tail</D></p:A>');
    expect(tree.name).toBe('A');
    expect(tree.children.map((c) => c.name)).toStrictEqual(['B', 'C', 'D']);
    expect((tree.children[0] as { text: string }).text).toBe('a & b A B <c> ');
    expect((tree.children[2] as { text: string }).text).toBe('x');
    expect(((tree.children[2] as { children: { text: string }[] }).children[0] as { text: string }).text).toBe('inner');
  });

  test('throws on malformed input', () => {
    const bad = [
      '', '   ', '<a><b></a>', '<a>', '<a></b>', '<a/><b/>', 'text<a/>', '<a/>text', '<a k=1/>', '<a k="1" k="2"/>',
      '<a>&unknown;</a>', '<a>&amp</a>', '<a>&#xZZ;</a>', '<a><!-- x --- y --></a>', '<a><![CDATA[ x </a>',
      '<q:a/>', '<a b:c="1"/>', '<!DOCTYPE a><a/>', '<a k="<"/>', '<a>x]]>y</a>', '<1a/>', '<a><b/ ></a>',
    ];
    for (const text of bad) expect(() => parseXmlTree(text), JSON.stringify(text)).toThrow(Error);
  });
});
