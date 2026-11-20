// The three storage keys of this phone's push registration, shared by push/ (phonePush.ts, timerPush.ts) and orders/ (phoneMute.ts).
//
// ⚠️ THE CURRENT APP'S KEYS, ON THE SAME ORIGIN: both js/push.js and Mise 2 write the token, and either app may open next.
// Not under KEEP_PREFIXES: a sign-out wipes them, so the next person never inherits this one's registration.

export const PUSH_TOKEN_KEY = 'push-token';
// WHOSE registration the token above is: the uid js/push.js wrote it for (its TOKEN_UID_KEY). A shared phone can still
// carry the registration of the person before.
export const PUSH_TOKEN_OWNER_KEY = 'push-token-uid';
export const MUTE_KEY = 'push-mute-order-requests';
