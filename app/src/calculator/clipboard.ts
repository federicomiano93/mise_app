// Copying a text to the clipboard, raced against a clock.
//
// ⚠️ navigator.clipboard.writeText() CAN SIT THERE AND NEVER SETTLE — the page losing focus is enough — and a
// button awaiting it on its own would say «Copy recipe» for ever with no error anywhere. A port of
// `copyToClipboard` in js/share.js: false when the clock wins, when there is no clipboard, or when it refuses.
export const CLIPBOARD_WAIT_MS = 2000;

export async function copyToClipboard(text: string, waitMs: number = CLIPBOARD_WAIT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.clipboard.writeText(text).then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => { resolve(false); }, waitMs); }),
    ]);
  } catch {
    return false; // an old browser, a denied permission, an insecure origin
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
