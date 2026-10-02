// session-stub.mjs — stands in for js/firebase.js when a test executes the ingredient card: the
// card only asks it for the open venue (its country decides the carton and package words).
// The real module loads the Firebase SDK from a CDN, which node cannot, and must never be reached
// from a unit test anyway (CLAUDE.md «firestore-write-guard»).
export function currentSession() {
  return globalThis.__miseTestSession;
}
