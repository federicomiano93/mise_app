// English is the SOURCE of the messages: it defines which keys exist, and Italian (it.ts) must
// match it exactly — a missing or an extra key there is a TYPE error, and `npm run build`
// type-checks before it builds, so an untranslated message cannot reach a phone.
//
// A message is a string, or a PluralMessage when its wording depends on a count — and that
// count is passed as `n`: t(key, { n }), `{n}` in the text, as in the current app. Keys are
// flat and grouped by prefix (nav., section., placeholder. …); a `{name}` in a message is
// filled in by format() in i18n.ts.

export type PluralMessage = {
  readonly one: string;
  readonly other: string;
  readonly zero?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
};

export type Message = string | PluralMessage;

export const en = {
  'app.name': 'Mise',
  'page.title': '{title} · Mise',

  'nav.rail': 'All sections',
  'nav.tabs': 'Main sections',
  'nav.skip': 'Skip to content',

  'section.orders': 'Orders',
  'section.suppliers': 'Suppliers',
  'section.recipes': 'Recipes',
  'section.calculator': 'Calculator',
  'section.pastries': 'Pastries',
  'section.stocktake': 'Stocktake',
  'section.foodcost': 'Food cost',
  'section.settings': 'Settings',
  'section.more': 'More',

  'common.cancel': 'Cancel',

  // Signing in. Copied from the current app's js/i18n.js, key for key. «Mise» is the product's
  // name, not a phrase, so it is not here.
  'auth.signIn.sub': 'Sign in to open your location.',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.signIn': 'Sign in',
  'auth.forgot': 'Forgot your password?',
  'auth.enterEmail': 'Enter your email.',
  'auth.enterPassword': 'Enter your password.',
  'auth.signingIn': 'Signing in…',
  'auth.typeEmailFirst': 'Type your email here, then tap “Forgot your password?” again.',
  // Deliberately does not reveal whether the address has an account.
  'auth.resetSent': 'If {address} has an account, a reset link is on its way.',
  // ⚠️ FOUR FIREBASE CODES SHARE auth.err.badPair ON PURPOSE (session/authErrors.ts).
  'auth.err.badPair': 'That email and password do not match an account.',
  'auth.err.badEmail': 'That does not look like an email address.',
  'auth.err.disabled': 'This account has been turned off. Ask the owner to re-enable it.',
  'auth.err.tooMany': 'Too many attempts. Wait a minute and try again.',
  'auth.err.offline': 'No connection. The first sign-in on a device needs internet.',
  'auth.err.generic': 'Could not sign in. Please try again.',

  'auth.tryAgain': 'Try again',

  'session.loading': 'Loading…',
  'picker.title': 'Choose location',
  'picker.sub': 'You have access to more than one.',
  // ⚠️ The current app adds «If you were given a code, type it here.», pointing at its join-code
  // field. Mise 2 brings that field in step 3g; until then the screen says who can let you in.
  'noAccess.title': 'No location yet',
  'noAccess.body': 'This account is not linked to a location. Ask the owner of your venue to add you.',
  'help.couldNotCheckYour': 'Could not check your access',
  'help.thisUsuallyMeansNo': 'This usually means no connection. Check it and try again.',

  'auth.logOut': 'Log out',
  'auth.logOut.title': 'Log out?',
  'auth.logOut.message': 'You will need your email and password to get back in.',
  // Asked only when something typed on this phone is still waiting for signal: signing out or
  // switching venue clears the copy it is waiting in.
  'unsent.title': 'Not sent yet',
  'unsent.message': 'Some changes made on this phone have not reached the server yet — usually because there is no signal. If you go on now, they will be lost.',
  'unsent.leave': 'Go on anyway',
  'unsent.stay': 'Stay',

  'account.title': 'Account',
  'account.signedInAs': 'Signed in as {email}',
  'account.venue': 'Venue',
  'account.switchVenue': 'Switch venue',
  // The top bar's venue chip: its visible text is the venue's name, so the spoken name starts
  // with it (WCAG 2.5.3) and then says what the button does.
  'account.switchVenueChip': '{name}, switch venue',
  // A sign-out or a venue switch that did not happen (rare: it needs no server).
  'leave.failed': 'That did not work. Check the connection and try again.',
  'settings.more': 'The other settings arrive in the next steps of Mise 2.',

  'placeholder.title': 'This section will arrive in one of the next steps of Mise 2.',
  'placeholder.body': 'Until then, keep using the app you use today.',

  'notFound.title': 'Page not found',
  'notFound.body': 'This address doesn’t lead to any section.',
  // «The start» is the first section the person is shown, which is not always Orders.
  'notFound.action': 'Go to the start',

  'notAvailable.body': 'This section is not on for you at this venue.',
  'notAvailable.action': 'Go to the start',

  'status.online': 'Online',
  'status.offline': 'No connection',
  // The phone has no top bar to say it, so a notice at the top of the screen does.
  'offline.banner': 'No connection. What you change stays on this phone and is sent when the signal is back.',

  'part.failed.title': 'This part didn’t load.',
  'part.failed.body': 'The rest of the screen works.',
  'part.failed.action': 'Reload',

  'app.failed.title': 'Mise stopped working.',
  'app.failed.body': 'Reloading usually fixes it. Nothing you saved is lost.',
  'app.failed.action': 'Reload the app',
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;

// The shape every language must have: the same keys as English, a string where English has
// a string and a PluralMessage where English has one. This is what makes a missing key a
// compile error instead of a blank on a screen.
export type Messages = {
  readonly [K in MessageKey]: (typeof en)[K] extends string ? string : PluralMessage;
};
