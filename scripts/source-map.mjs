// source-map.mjs — turns a bundled stack frame back into the file and line it came from.
//
// ⚠️ WHY IT EXISTS (10 Oct 2026). Every page loads one bundle, dist/<page>.js, so an error a phone
// reports now says `…/dist/orders.js:1:23456` — a column in a minified line, which tells nobody
// anything. dist/<page>.js.map (built beside the bundle, without the sources) says which js/ file
// and line that column was. This is the pure half: a base64-VLQ decoder written here (no library,
// P19), a lookup, and a function that rewrites the sample stack read-errors.mjs prints. The file
// system and the network stay in read-errors.mjs; tests/source-map.test.mjs pins this half.
//
// ⚠️ THE MAP IS THE ONE IN THIS CHECKOUT. A report from an older release can only be mapped with
// today's build, whose columns may have moved: the result is then marked «mapped with the current
// build» and the original frame is always kept beside it.

import { posix } from 'node:path';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...BASE64].map((ch, i) => [ch, i]));

// One VLQ run → the signed integers it holds. «A» is 0, «C» is 1, «D» is -1, «gB» is 16.
export function decodeVlq(text) {
  const values = [];
  let shift = 0;
  let acc = 0;
  for (const ch of text) {
    const digit = DIGIT.get(ch);
    if (digit === undefined) throw new Error(`not a source-map character: ${JSON.stringify(ch)}`);
    acc += (digit & 31) * 2 ** shift;
    if (digit & 32) { shift += 5; continue; }
    values.push(acc % 2 === 1 ? -(acc - 1) / 2 : acc / 2);
    shift = 0;
    acc = 0;
  }
  return values;
}

// The `mappings` string → one array per generated line, each holding its segments as
// { col, source, line, column } with ABSOLUTE numbers (the format stores each as a delta from
// the previous segment). Segments with only a column (no original place) are dropped.
export function decodeMappings(mappings) {
  let source = 0;
  let line = 0;
  let column = 0;
  return String(mappings).split(';').map(part => {
    let col = 0;
    const segments = [];
    for (const chunk of part.split(',')) {
      if (!chunk) continue;
      const v = decodeVlq(chunk);
      col += v[0];
      if (v.length < 4) continue;
      source += v[1];
      line += v[2];
      column += v[3];
      segments.push({ col, source, line, column });
    }
    return segments;
  });
}

// line is 1-based and column 0-based, as in a browser's `file.js:LINE:COL` once the column has
// had 1 taken off. Returns { source, line (1-based), column (0-based) } or null.
export function originalPosition(map, line, column) {
  const decoded = map.decoded || (map.decoded = decodeMappings(map.mappings));
  const segments = decoded[line - 1];
  if (!segments || !segments.length) return null;
  let hit = null;
  for (const segment of segments) {
    if (segment.col > column) break;
    hit = segment;
  }
  if (!hit || hit.source >= map.sources.length) return null;
  return { source: map.sources[hit.source], line: hit.line + 1, column: hit.column };
}

// A `sources` entry is relative to the map's own folder: «../js/orders/x.js» beside dist/ → js/orders/x.js.
export function repoPath(mapFile, source) {
  return posix.normalize(posix.join(posix.dirname(mapFile), source));
}

const FRAME = /\b(dist\/[A-Za-z0-9_-]+\.js):(\d+):(\d+)/;

// Rewrites a (cleaned, newline-separated) stack: every frame in a bundle keeps its own line, and
// a line «→ js/file.js:LINE» follows it. loadMap(mapFile) returns the parsed map or null.
// appVersion / currentVersion: the cache number the report came from and the one in this checkout;
// unless they are equal the mapping carries the «(mapped with the current build)» warning.
export function mapStack(stack, { loadMap, appVersion = null, currentVersion = null } = {}) {
  if (!stack) return stack;
  const sameBuild = appVersion !== null && appVersion === currentVersion;
  const out = [];
  for (const text of String(stack).split('\n')) {
    out.push(text);
    const found = FRAME.exec(text);
    if (!found) continue;
    const mapFile = `${found[1]}.map`;
    let map = null;
    try { map = loadMap(mapFile); } catch { map = null; }
    if (!map || !Array.isArray(map.sources)) continue;
    const place = originalPosition(map, Number(found[2]), Number(found[3]) - 1);
    if (!place) continue;
    out.push(`→ ${repoPath(mapFile, place.source)}:${place.line}${sameBuild ? '' : ' (mapped with the current build)'}`);
  }
  return out.join('\n');
}

// 'theitalianclub-v658' in sw.js → '658', the number a report carries as appVersion.
export function currentCacheVersion(swSource) {
  const match = /const CACHE_NAME = '[^']*-v(\d+)'/.exec(String(swSource));
  return match ? match[1] : null;
}
