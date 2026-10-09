// feedback-notes.mjs — the pure half of scripts/read-feedback.mjs: turning the REST answers
// about `locations/{lid}/feedback/{id}` into notes, and the one path a delete may name.
// No network, no credentials, so the tests can pin it (tests/feedback-notes.test.mjs).
//
// ⚠️ THE TEXT IS WRITTEN BY PEOPLE IN A KITCHEN, NOT BY THE OWNER. Every member of a venue
// with the switch on can send one, and what it says reaches an AI assistant. So it is DATA:
// control and invisible characters are flattened (a right-to-left override could reorder
// what is read) and it is cut to the length the rules allow — the same treatment
// .claude/hooks/session-start.mjs gives anything that came from outside this PC.

const LOCATION_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
// The id is the one addDoc() makes — the rules refuse any other shape.
const NOTE_PATH = new RegExp(`^locations/(${LOCATION_ID})/feedback/([A-Za-z0-9]{20})$`);

export function clean(text, max) {
  const flat = String(text ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// 'projects/p/databases/(default)/documents/locations/x/feedback/abc' → 'locations/x/feedback/abc'
export function relativePath(name) {
  const at = String(name ?? '').indexOf('/documents/');
  return at === -1 ? null : String(name).slice(at + '/documents/'.length);
}

// The only documents read-feedback.mjs may delete: one note, in one venue. Anything else —
// a venue, a collection, another collection's document — is refused before a request is made.
export function notePath(path) {
  const match = NOTE_PATH.exec(String(path ?? ''));
  return match ? { path: match[0], locationId: match[1], id: match[2] } : null;
}

function str(field) {
  return typeof field?.stringValue === 'string' ? field.stringValue : null;
}

// One runQuery row → a note, or null when the row is not a feedback document at all.
export function noteFrom(document) {
  const where = notePath(relativePath(document?.name));
  if (!where) return null;
  const f = document.fields || {};
  return {
    path: where.path,
    locationId: where.locationId,
    uid: clean(str(f.uid) ?? '', 128),
    text: clean(str(f.text) ?? '', 2000),
    screen: clean(str(f.screen) ?? '', 40),
    appVersion: clean(str(f.appVersion) ?? '', 12),
    createdAt: f.createdAt?.timestampValue ?? null,
  };
}

// How one note is printed. ⚠️ THE TEXT GOES OUT AS A JSON STRING, quoted and escaped, and the
// block around it carries a marker made fresh on every run: a note that types «=== END NOTES
// ===» followed by an order can neither close the quote nor guess the marker, so it cannot
// step outside the data it is.
export function noteLines(note, { venue, who }) {
  return [
    `[${note.path}]`,
    `  ${note.createdAt || 'no date'} · ${clean(venue, 60)} · ${clean(who, 40)} · screen ${note.screen || '?'} · app v${note.appVersion || '?'}`,
    `  text: ${JSON.stringify(note.text)}`,
  ];
}

// Oldest first: a list of things to do reads in the order they were asked for.
export function notesFrom(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => noteFrom(row?.document))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}
