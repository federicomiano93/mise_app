// feedback-model.js — the pure half of «Write to Claude»: what a note looks like
// before it is saved. Zero imports, so the tests run it without a browser.
//
// The limits mirror firestore.rules (locations/{lid}/feedback): text 1..2000, screen
// ≤ 40, appVersion null or ≤ 12. The rules are the real guard; this keeps an honest
// note from being refused for a reason the person could not have seen.

export const FEEDBACK_MAX = 2000;
const SCREEN_MAX = 40;
const VERSION_MAX = 12;

// Returns { text, screen?, appVersion } or null when there is nothing to send.
export function feedbackPayload({ text, screen, appVersion } = {}) {
  const body = typeof text === 'string' ? text.trim().slice(0, FEEDBACK_MAX).trim() : '';
  if (!body) return null;
  const payload = { text: body };
  if (typeof screen === 'string' && screen.trim() && screen.length <= SCREEN_MAX) {
    payload.screen = screen.trim();
  }
  payload.appVersion =
    typeof appVersion === 'string' && appVersion && appVersion.length <= VERSION_MAX
      ? appVersion
      : null;
  return payload;
}
