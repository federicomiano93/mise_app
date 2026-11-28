// feedbackSource.ts — the one write of «Nota per Claude»: a new document in `locations/{lid}/feedback`, and nothing else.
//
// Exactly what firestore.rules (`match /feedback/{id}`) accepts: an auto id, the keys `bakery, uid, text, screen, appVersion, createdAt`,
// `uid` the signed-in account's, `createdAt` the SERVER's clock (serverTimestamp), and only in a venue whose document says
// `feedbackToClaude: true`. Nobody reads a note back from the app (the rules refuse every read); the developer's scripts do.
//
// ⚠️ THE CALLER DOES NOT WAIT FOR THE SERVER: offline, Firestore keeps the write and sends it by itself, so the promise stays pending.
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are fixed by its first use.

import { buildPath } from '@mise/shared/location-id';
import type { FirestoreKit } from '../session/firebaseBackend';
import type { FeedbackNote } from './feedbackModel';

export interface FeedbackSource {
  // Saves one note signed by `uid`. Settles when the server answers; rejects with the rules' refusal.
  send(uid: string, note: FeedbackNote): Promise<void>;
}

export function createFirestoreFeedbackSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
): FeedbackSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const path = buildPath(locationId, 'feedback');
  return {
    async send(uid, note) {
      const { fs, db } = await firestore();
      await fs.addDoc(fs.collection(db, path), {
        bakery: locationId,
        uid,
        text: note.text,
        screen: note.screen,
        appVersion: note.appVersion,
        createdAt: fs.serverTimestamp(),
      });
    },
  };
}
