// log-redact.js — what a function log may say about a document path.
//
// ⚠️ A DEVICE PUSH TOKEN IS A CREDENTIAL FOR THAT PHONE, and it is the document id in
// locations/{lid}/fcm-tokens/{token}. Logging the whole path put every dead token into
// Cloud Logging, which keeps lines far longer than the token lives. This keeps what a
// person reading the log needs (which venue, and a stable tag to tell two phones
// apart) and drops what could be used to send to the phone.
//
// Pure, with node:crypto only, so tests/log-redact.test.mjs can import it with no
// dependencies. Deliberately never throws: it runs inside an error handler.

import { createHash } from 'node:crypto';

const TOKEN_PATH = /^locations\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/fcm-tokens\/([^/]+)$/;

// { location, token } where `token` is the first 12 hex characters of the token's
// sha256: enough to tell two phones apart in a log, useless for sending anything.
// A path of any other shape, or none, gives nulls — never the raw path.
export function redactTokenPath(path) {
  const match = typeof path === 'string' ? TOKEN_PATH.exec(path) : null;
  if (!match) return { location: null, token: null };
  return {
    location: match[1],
    token: createHash('sha256').update(match[2]).digest('hex').slice(0, 12),
  };
}
