// feedbackModel.ts — the pure half of «Nota per Claude» in Mise 2: what a note looks like before it is saved.
//
// The limits mirror firestore.rules (`match /feedback/{id}`): text 1..2000, screen at most 40, appVersion null or at most 12. The rules are
// the real guard; this keeps an honest note from being refused for a reason the person could not have seen. Port of js/feedback-model.js
// (the same limits), with the screen taken from the address.

export const FEEDBACK_MAX = 2000;
export const SCREEN_MAX = 40;
export const VERSION_MAX = 12;

export type FeedbackNote = {
  readonly text: string;
  readonly screen: string;
  readonly appVersion: string | null;
};

// Where the note was written, as the developer can resolve it: the address without its first slash («recipes/<id>»), cut to 40.
// An empty address (the app's start) is «home».
export function screenFor(pathname: string): string {
  const path = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return (path === '' ? 'home' : path).slice(0, SCREEN_MAX);
}

// The note, or null when there is nothing to send.
export function feedbackNote(input: { text: string; pathname: string; appVersion: string | null }): FeedbackNote | null {
  // By code points: cutting at 2000 UTF-16 units could split an emoji in half.
  const text = Array.from(input.text.trim()).slice(0, FEEDBACK_MAX).join('').trim();
  if (text === '') return null;
  const version = input.appVersion;
  return {
    text,
    screen: screenFor(input.pathname),
    appVersion: typeof version === 'string' && version !== '' && version.length <= VERSION_MAX ? version : null,
  };
}
