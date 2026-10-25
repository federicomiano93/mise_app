// location-id.ts — what a location id may look like, and the Firestore paths built from one.
//
// TypeScript port of the PURE half of js/location.js. The other half (which venue is open on
// this page) is state, and in Mise 2 it belongs to the session (app/src/session/), so this file
// is not a whole-module port and parity.spec.ts does not pair it; location-id.spec.ts runs
// every test against both files instead.
//
// ⚠️ THE ID BUILDS EVERY PATH, so a bad one must THROW rather than build a path into somebody
// else's folder or into a collection named "undefined". js/sections.js locationsOf() drops
// invalid ids before they get here, so a stray space typed in the console becomes an honest
// "no location yet" instead of a crash.

export const DEFAULT_LOCATION_ID = 'bakery';

// Firestore document ids may contain far more than this; the app allows only what a hand-typed
// id in the console should ever be — no slashes (a path), no dots (`..`), no spaces.
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidLocationId(id: unknown): id is string {
  return typeof id === 'string' && VALID_ID.test(id);
}

export function buildPath(locationId: unknown, collectionName: unknown): string {
  if (!isValidLocationId(locationId)) {
    throw new Error(`Invalid location id: ${JSON.stringify(locationId)}`);
  }
  if (typeof collectionName !== 'string' || !collectionName || collectionName.includes('/')) {
    throw new Error(`Invalid collection name: ${JSON.stringify(collectionName)}`);
  }
  return `locations/${locationId}/${collectionName}`;
}

export function locationDocPath(locationId: unknown): string {
  if (!isValidLocationId(locationId)) {
    throw new Error(`Invalid location id: ${JSON.stringify(locationId)}`);
  }
  return `locations/${locationId}`;
}
