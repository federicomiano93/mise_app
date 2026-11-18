// This phone's «do not buzz me about order lists» (parity M7, js/push.js): what the Settings switch reads and remembers.
//
// ⚠️ THE CURRENT APP'S KEYS, ON THE SAME ORIGIN: until step 3g registers phones in Mise 2 only js/push.js writes the token, and either
// app may open next and must draw the same switch. The SERVER's copy (on the token document) is the one that decides who is buzzed;
// the local one is only what the screen draws, so a failed read answers «not muted»: the safe direction is a phone that rings.
//
// Not under KEEP_PREFIXES, as in the current app: a sign-out wipes them, and js/push.js registers the phone again.

export const PUSH_TOKEN_KEY = 'push-token';
// WHOSE registration the token above is: the uid js/push.js wrote it for (its TOKEN_UID_KEY). A shared phone can still
// carry the registration of the person before.
export const PUSH_TOKEN_OWNER_KEY = 'push-token-uid';
export const MUTE_KEY = 'push-mute-order-requests';

// This phone's alert token, or '' when it has none (never registered, or the storage is unavailable).
export function phoneToken(): string {
  try {
    return localStorage.getItem(PUSH_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

// The uid this phone's token was registered for, or '' (none, or the storage is unavailable).
export function phoneTokenOwner(): string {
  try {
    return localStorage.getItem(PUSH_TOKEN_OWNER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function phoneMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPhoneMute(mute: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, mute ? '1' : '0');
  } catch {
    // Private mode: the server's copy still decides.
  }
}
