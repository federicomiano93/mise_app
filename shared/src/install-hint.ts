// install-hint.ts — whether somebody who has JUST joined should be shown how to put the app on their phone's home screen.
//
// TypeScript port of js/install-hint.js for Mise 2 (staff slice 2). Behaviour is identical, input for input:
// install-hint.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports.
//
// ⚠️⚠️ WHY IT EXISTS. An invitation link lands somebody in the app inside a BROWSER TAB, and whoever arrives by invitation
// never sees the sign-in screen and its link to the guide. So the guide is offered ONCE, on the Home, after the join.
//
// ⚠️⚠️ AND THE ORDER IS A CONSTRAINT: join first, install second. The code travels in the address's fragment, and an installed
// app always starts from its own start_url with no fragment on it: «install it first» would lose the invitation.
//
// ⚠️ localStorage, NOT sessionStorage: joining ends with a reload, and the notice waits for the Home; an app closed in that gap
// must still be told. The key is the current app's own (`just-joined`) and is NOT in KEEP_PREFIXES: a venue's sign-out or
// switch wipes it, which is why the join writes it only AFTER the last clear before the venue opens (app/src/session/session.ts).

export const JUST_JOINED_KEY = 'just-joined';

// The two Storage methods this needs, so shared/ stays free of DOM types.
export interface HintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function read(storage: HintStorage): boolean {
  try { return storage.getItem(JUST_JOINED_KEY) === '1'; } catch { return false; }
}

function clear(storage: HintStorage): void {
  try { storage.removeItem(JUST_JOINED_KEY); } catch { /* private mode */ }
}

// Called the moment a join succeeds. Reports a refused storage rather than throwing into a join that just succeeded.
export function markJustJoined(storage: HintStorage): boolean {
  try { storage.setItem(JUST_JOINED_KEY, '1'); return true; } catch { return false; }
}

export interface InstallHint {
  readonly offer: boolean;
  // Spends the one notice. The caller calls it when it is about to SHOW the notice, never earlier.
  adopt(): void;
}

// ⚠️ THE SILENCES ARE THE DESIGN:
//   nobody just joined        → silent, and nothing is written
//   already an installed app  → silent, AND the flag is dropped (they have done what this would ask)
//   storage unreadable        → silent (a private window is not a broken app)
export function checkInstallHint({ storage, standalone }: { storage: HintStorage; standalone: boolean }): InstallHint {
  const silent: InstallHint = { offer: false, adopt() {} };
  if (!read(storage)) return silent;
  if (standalone) { clear(storage); return silent; }
  return { offer: true, adopt: () => clear(storage) };
}
