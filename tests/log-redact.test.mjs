// Function logs outlive a device push token, so a log line may carry the venue and a hash
// tag, never the token (security plan A3-5). The module is pure; the last test reads
// functions/index.js to pin that no logger call there passes a path or token again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

import { redactTokenPath } from '../functions/log-redact.js';

const TOKEN = 'dQw4w9WgXcQ:APA91bH-secret_device.token0123456789';

test('a real-looking path gives the venue and 12 hex characters, never the token', () => {
  const out = redactTokenPath(`locations/loc-abc123/fcm-tokens/${TOKEN}`);
  assert.equal(out.location, 'loc-abc123');
  assert.match(out.token, /^[0-9a-f]{12}$/);
  assert.equal(out.token, createHash('sha256').update(TOKEN).digest('hex').slice(0, 12));
  assert.ok(!JSON.stringify(out).includes(TOKEN));
  assert.ok(!JSON.stringify(out).includes('APA91'));
});

test('the same token always gets the same tag, another token another one', () => {
  const a = redactTokenPath('locations/bakery/fcm-tokens/tok-one');
  assert.deepEqual(a, redactTokenPath('locations/bakery/fcm-tokens/tok-one'));
  assert.notEqual(a.token, redactTokenPath('locations/bakery/fcm-tokens/tok-two').token);
});

test('bad input never throws and never echoes anything back', () => {
  const inputs = [undefined, null, '', 42, {}, [], 'locations/x', 'locations/x/other/secrettoken',
    `locations/x/fcm-tokens/${TOKEN}/deeper`, `users/u1/fcm-tokens/${TOKEN}`, '../../etc/secrettoken'];
  for (const input of inputs) {
    const out = redactTokenPath(input);
    assert.deepEqual(out, { location: null, token: null });
    assert.ok(!JSON.stringify(out).includes('secrettoken'));
  }
});

test('no logger call in any functions/*.js logs a path or a token as a key', () => {
  const dir = new URL('../functions/', import.meta.url);
  const files = readdirSync(dir).filter(name => name.endsWith('.js'));
  assert.ok(files.includes('index.js') && files.includes('onboarding.js'), 'the scan must see the known files');
  const calls = [];
  const start = /logger\.(?:info|warn|error|debug|log|write)\(/g;
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    start.lastIndex = 0;
    let m;
    while ((m = start.exec(source))) {
      // Walk to the matching close parenthesis (strings in these calls hold no parentheses
      // that would unbalance the count, and a miscount would only widen what is checked).
      let depth = 1;
      let i = start.lastIndex;
      while (i < source.length && depth > 0) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') depth -= 1;
        i += 1;
      }
      calls.push(`${file}: ${source.slice(m.index, i)}`);
    }
  }
  assert.ok(calls.length > 10, `found only ${calls.length} logger calls: the scan is broken`);
  assert.ok(calls.some(c => c.startsWith('index.js') && c.includes('Dropping a dead registration')), 'the call under test must be among those scanned');
  for (const call of calls) {
    assert.ok(!/[{,]\s*(?:path|token)\s*[,}:]/.test(call), `a logger call logs a path or token: ${call}`);
  }
});
