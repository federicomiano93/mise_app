// pastries-dialog-stub.mjs — stands in for js/pastries/confirm-dialog.js (tests/helpers/load-pastries.mjs).
// Every question is recorded and answered with `answer` (yes by default). `answer` may also be a
// function of the question's options, for a flow that asks several different things — and for a
// test that has to act on a dialog's `node` (a field it carries) before the answer is given.
export const asked = [];
export const settings = { answer: true };

export async function confirmDialog(options) {
  asked.push(options);
  return typeof settings.answer === 'function' ? settings.answer(options) : settings.answer;
}

export async function alertDialog(message) {
  asked.push({ message });
}
