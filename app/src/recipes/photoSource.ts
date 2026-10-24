// photoSource.ts — reading a recipe from photographs, and the venue's switch for it (step 3d-9): the two Cloud Functions
// of js/catalogue/firebase-photo.js, `readRecipeFromPhotos` and `setRecipePhoto`, behind an injected call so a spec can
// fake them (photoSource.spec.ts). Nothing here touches Firestore: the photographs are sent to the function and thrown
// away (no Storage anywhere, parity item 19), and the switch is written by the server.
//
// ⚠️ THE VENUE IS THE ONE THIS SOURCE WAS MADE FOR, never one a screen passes in: the source is made per open venue
// (DataServices), as every other section's.

// ⚠️ THE CLIENT WAITS LONGER THAN THE FUNCTION'S OWN `timeoutSeconds` (functions/recipe-photo.js, 120 s), WITH A MARGIN: a
// phone that gives up first abandons a read that is still running and has already been paid for, and the phone's clock
// starts before the upload (up to 6 MB) and the cold start, the server's only when the request arrives. 150 s, NEW in Mise 2
// (the current app waits exactly 120 s). photoSource.spec.ts reads both numbers and pins server + 20 s.
export const PHOTO_CLIENT_TIMEOUT_MS = 150_000;
// ⚠️ setRecipePhoto has no timeoutSeconds of its own (functions/onboarding.js), so the platform's 60 s applies: the phone
// waits 70 s (the SDK's default, as the current app) — never less than the server, or the switch is changed by a call the
// phone has already called failed.
export const SWITCH_TIMEOUT_MS = 70_000;

export interface PhotoImage {
  readonly mediaType: string;
  // base64, without the `data:` prefix.
  readonly data: string;
}

export interface PhotoSource {
  // The reader's answer as the function returned it (the screen reads it through the shared photo model). REJECTS with
  // the SDK's error (`code`, `message`) when the call fails; offline it fails, it never waits.
  readRecipe(images: readonly PhotoImage[]): Promise<unknown>;
  // Turns the venue's reader on or off (owner/manager; the server checks). Resolves with what the function returned;
  // REJECTS when refused or unreachable. The caller then reads the venue again (session.refreshLocation()).
  setRecipePhoto(enabled: boolean): Promise<unknown>;
}

export type CallFunction = (name: string, data: unknown, timeoutMs: number) => Promise<unknown>;

export function createPhotoSource(call: CallFunction, locationId: string): PhotoSource {
  return {
    readRecipe: images => call('readRecipeFromPhotos', { locationId, images }, PHOTO_CLIENT_TIMEOUT_MS),
    setRecipePhoto: enabled => call('setRecipePhoto', { locationId, enabled }, SWITCH_TIMEOUT_MS),
  };
}
