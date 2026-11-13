// joinFlow.ts — the invitation this window holds, and the join form (staff slice 1).
//
// Plain TypeScript with no React in it, like session.ts, so every rule below is a spec
// (joinFlow.spec.ts). JoinFlowContext.tsx hands it to the screens; joinLinkBoot.ts creates the one
// the page uses, BEFORE anything else runs.
//
// ⚠️⚠️ THE TOKEN IN A JOIN LINK IS A KEY TO A VENUE (docs/parity/staff-plan.md, «Security»). So:
//   · it is read ONCE from the address and taken OUT of the address bar and out of the history
//     entry at once (takeJoinLink), before the router, the telemetry or anything else can see it,
//     so it never reaches an error report, a usage line or the browser history;
//   · it is never written to the console, an error report or a usage line (nothing here logs);
//   · it is FORGOTTEN after joining, after Cancel («Not now», Back), and on sign-out (forget(), and
//     session.ts signOut removes the stored copy before its reload).
//
// ⚠️ WHERE IT LIVES BETWEEN THOSE MOMENTS: sessionStorage, under the current app's own key
// `pending-invite` (js/auth-gate.js). Memory is too short — the session reloads by itself (another
// person's offline copy wiped at sign-in, the 30-second copy check) and the invitation must survive
// that — and localStorage is too long (an invitation declined today would come back next month).
// sessionStorage survives a reload and dies with the window. The token is already in this window's
// address when it arrives, so this stores it no more widely than it already was. It is NOT a
// localStorage key, so KEEP_PREFIXES has nothing to say about it.

import { kindOfTyped, readJoinToken } from '@mise/shared/join-link';
import type { SentJoinForm } from '@mise/shared/join-hold';
import type { KeyValueStorage } from './backend';

export const PENDING_INVITE_KEY = 'pending-invite';

export interface JoinFlowState {
  // The invitation this window holds (a link token, validated), '' for none.
  readonly invited: string;
  // The join form is on screen: opened by «I have a join code», by «Add it», or by an invitation
  // opened on «No venue yet». Closed by Back, by Cancel, and when the venue opens.
  readonly open: boolean;
  // The form that has been sent (js/join-hold.js): busy while the server is asked, then kept so a
  // late session answer does not wipe the refusal it shows. null before the first send.
  readonly sent: SentJoinForm | null;
  // Bumped when a NEW invitation must get a fresh form (the old form, typed values and all, gives
  // way): the screen is keyed on it.
  readonly formKey: number;
  // The form was just left by Back or Cancel: the screen it returns to puts the focus on the button that opened it, so a
  // keyboard is never left on the page itself.
  readonly returned: boolean;
}

export interface JoinFlow {
  getSnapshot(): JoinFlowState;
  subscribe(listener: () => void): () => void;
  // A token read from a link. Anything that is not a well-formed link token is ignored.
  remember(token: string): void;
  // Drops the invitation from memory and from the window's storage. The form stays as it is.
  forget(): void;
  openForm(): void;
  // Back or Cancel: the invitation is forgotten and the form closes.
  cancel(): void;
  // The venue opened: nothing more to keep.
  finish(): void;
  // «Join» was tapped: the form is held on screen until the answer (js/join-hold.js).
  sending(): void;
  // The answer came back as a refusal: the form is kept with it.
  answered(): void;
}

// ⚠️ VALIDATED ON THE WAY OUT, exactly as readJoinToken validates the URL. What comes back from
// storage is no more trustworthy than what went into the address bar: another tab, an extension or
// a stale entry could have left anything there, and handing rubbish to redeemJoinCode spends one of
// five attempts an hour.
function storedInvite(storage: KeyValueStorage): string {
  try {
    const found = storage.getItem(PENDING_INVITE_KEY) ?? '';
    return kindOfTyped(found) === 'link' ? found : '';
  } catch {
    return '';
  }
}

export function createJoinFlow(storage: KeyValueStorage): JoinFlow {
  let state: JoinFlowState = Object.freeze({ invited: storedInvite(storage), open: false, sent: null, formKey: 0, returned: false });
  const listeners = new Set<() => void>();

  function set(next: Partial<JoinFlowState>): void {
    state = Object.freeze({ ...state, ...next });
    listeners.forEach(listener => { listener(); });
  }

  function store(token: string | null): void {
    try {
      if (token === null) storage.removeItem(PENDING_INVITE_KEY);
      else storage.setItem(PENDING_INVITE_KEY, token);
    } catch { /* private mode: the invitation lives as long as the page, which is the safe way to fail */ }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    remember(token) {
      if (kindOfTyped(token) !== 'link' || token !== token.trim()) return;
      store(token);
      if (token === state.invited) return;
      // A form still being checked is never replaced (js/join-hold.js): the new invitation waits,
      // and answered() gives it its own form once the check is over.
      const fresh = state.sent?.busy ? {} : { formKey: state.formKey + 1, sent: null };
      set({ invited: token, returned: false, ...fresh });
    },
    forget() {
      store(null);
      if (state.invited) set({ invited: '' });
    },
    openForm() {
      set({ open: true, sent: null, formKey: state.formKey + 1, returned: false });
    },
    cancel() {
      store(null);
      set({ invited: '', open: false, sent: null, returned: true });
    },
    finish() {
      store(null);
      set({ invited: '', open: false, sent: null, returned: false });
    },
    sending() {
      set({ sent: Object.freeze({ busy: true, invited: state.invited }) });
    },
    answered() {
      const sent = state.sent;
      // A NEW invitation opened while the code was being checked was held back by the check; now
      // that it is over, it gets its own form. Only a new one: the invitation remembered at the
      // tap must not take the screen back.
      if (sent && state.invited && state.invited !== (sent.invited ?? '')) {
        set({ sent: null, formKey: state.formKey + 1 });
        return;
      }
      set({ sent: Object.freeze({ busy: false, invited: sent?.invited ?? '' }) });
    },
  };
}

// What takeJoinLink needs of the window: the address, and the way to rewrite it without a visit.
export interface AddressWindow {
  readonly location: { readonly href: string; readonly pathname: string; readonly search: string; readonly hash: string };
  readonly history: { replaceState(data: unknown, unused: string, url?: string): void };
}

// Does this fragment carry a `join` field at all, well-formed or not?
function hasJoinField(hash: string): boolean {
  if (hash.length < 2) return false;
  try {
    return new URLSearchParams(hash.slice(1)).has('join');
  } catch {
    return false;
  }
}

// Reads a join link from the address and takes it OUT of the address bar and of this history entry,
// handing back the token ('' when there is none or it is malformed).
//
// ⚠️ A MALFORMED `#join=` IS TAKEN OUT TOO. It is not a token anybody can use, but it is still
// something a stranger put in the address, and left there the router would read `join=…` as a page
// and draw «Not found».
//
// `returnTo` is the fragment to put back (the screen the app was on, when a link is opened in a tab
// already running the app); '' at start-up, where the app opens at its start.
export function takeJoinLink(win: AddressWindow, returnTo = ''): string {
  if (!hasJoinField(win.location.hash)) return '';
  const token = readJoinToken(win.location.href);
  try {
    win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}${returnTo}`);
  } catch { /* a browser that refuses: nothing else can be done, and the token is still only in this window */ }
  return token;
}
