// pastries-dialog-stub.mjs — stands in for js/pastries/confirm-dialog.js (tests/helpers/load-pastries.mjs).
// Every question is recorded and answered with `answer` (yes by default).
export const asked = [];
export const settings = { answer: true };

export async function confirmDialog(options) {
  asked.push(options);
  return settings.answer;
}

export async function alertDialog(message) {
  asked.push({ message });
}
