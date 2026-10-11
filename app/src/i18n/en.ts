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
  // The three button words below keep the current app's key names and texts (js/i18n.js).
  'ui.edit': 'Edit',
  'ui.note': 'Note',
  'ui.back': 'Back',
  'ui.save': 'Save',
  'ui.remove': 'Remove',
  'ui.discard': 'Discard',
  'day.tomorrow': 'Tomorrow',
  // A date spelled out, as «Wed 5 Aug» — built by hand from these words so it reads the same on
  // every device (Records). getDay() and getMonth() are the index: Sunday is 0.
  'day.spelledNoYear': '{weekday} {d} {month}',
  'day.weekdayShort.0': 'Sun',
  'day.weekdayShort.1': 'Mon',
  'day.weekdayShort.2': 'Tue',
  'day.weekdayShort.3': 'Wed',
  'day.weekdayShort.4': 'Thu',
  'day.weekdayShort.5': 'Fri',
  'day.weekdayShort.6': 'Sat',
  'day.monthShort.0': 'Jan',
  'day.monthShort.1': 'Feb',
  'day.monthShort.2': 'Mar',
  'day.monthShort.3': 'Apr',
  'day.monthShort.4': 'May',
  'day.monthShort.5': 'Jun',
  'day.monthShort.6': 'Jul',
  'day.monthShort.7': 'Aug',
  'day.monthShort.8': 'Sep',
  'day.monthShort.9': 'Oct',
  'day.monthShort.10': 'Nov',
  'day.monthShort.11': 'Dec',

  // Pastries. Every key that the current app also has carries ITS name and ITS text, copied
  // from js/i18n.js; the ones marked «new» exist only in Mise 2.
  // ⚠️ A weekday shown is its label (weekday.*), never its id: the ids are Firestore document
  // names and stay English everywhere. The short labels are entries of their own, never the
  // first three letters of the full name.
  'weekday.monday': 'Monday',
  'weekday.tuesday': 'Tuesday',
  'weekday.wednesday': 'Wednesday',
  'weekday.thursday': 'Thursday',
  'weekday.friday': 'Friday',
  'weekday.saturday': 'Saturday',
  'weekday.sunday': 'Sunday',
  'weekday.monday.short': 'Mon',
  'weekday.tuesday.short': 'Tue',
  'weekday.wednesday.short': 'Wed',
  'weekday.thursday.short': 'Thu',
  'weekday.friday.short': 'Fri',
  'weekday.saturday.short': 'Sat',
  'weekday.sunday.short': 'Sun',
  // new: the name of the row of days (a screen reader says it on reaching the first one).
  'past.daysLabel': 'Days',
  // new: under a day's name on the tablet's list. The count is the number of KINDS of pastry.
  'past.count': { one: '{n} pastry', other: '{n} pastries' },
  // new: a day with nothing on it, in the list of days (a tab says it in words as well).
  'past.nothingYet': 'Nothing yet',
  'past.tomorrowToProve': 'Tomorrow · to prove',
  'past.toProve': 'To prove',
  'past.editDay': 'Edit {day}',
  'past.nothingToProveFor': 'Nothing to prove for {day} yet.',
  'past.tapThePencilTo': 'Tap the pencil to add.',
  'past.newQuantityFor': 'New quantity for {name}',
  'past.confirmNewQuantityFor': 'Confirm the new quantity for {name}',
  'past.hint.typeANumber': 'type a number',
  'past.hint.sameAsNow': 'same as now',
  'past.hint.atLeastOne': 'must be at least 1',
  'past.hint.tooMany': 'too many',
  'past.thatRowHasChanged': 'That row has changed — check the list.',
  // new: «Cornetti: 24.» — what was set, said back. The quantity is passed as text so it is
  // never grouped («1,234»): the list shows it plain.
  'past.quantitySet': '{name}: {qty}.',
  'past.confirm': 'Confirm',
  'past.confirmDay': 'Confirm {day}?',
  'past.keepAsRecord': 'Keep this list as a record for {day}?',
  'past.nothingToProveRecord': '{day} has nothing to prove. Record that?',
  'past.tonightsRecordReplaced': 'Tonight’s record for {day} will be replaced.',
  'past.willShowAsDone': '{day} will show as done. You can still change it — it will ask first.',
  'past.dayRecorded': '{day} recorded.',
  'past.confirmedMark': 'Confirmed',
  'past.editDayQ': 'Edit {day}?',
  'past.alreadyRecordedTonight': '{day} is already recorded for tonight. Edit these quantities?',
  'past.records': 'Records',
  'past.couldNotSaveDay': 'Couldn’t save {day} — check your connection.',
  'past.couldNotRecord': 'Couldn’t record {day} — check your connection.',
  'past.couldnTRemoveThat': 'Couldn’t remove that record — check your connection.',
  'past.liveSyncInterruptedThis': 'Live sync interrupted — this list may be out of date.',
  'past.liveSyncInterruptedThese': 'Live sync interrupted — these records may be out of date.',

  // The editor.
  'past.toProveFor': 'To prove for {day}',
  'past.pastryPlaceholder': 'Pastry',
  'past.pastryName': 'Pastry name',
  'past.thisRow': 'this row',
  'past.addPastry': 'Add pastry',
  'past.removeThisPastry': 'Remove this pastry?',
  'past.removeRowFrom': 'Remove {name} from {day}?',
  'past.noteStays': 'Note — stays on {day} until you change it',
  'past.anythingWorthRememberingAbout': 'Anything worth remembering about this day…',
  // new: the small line under the editor's title once something has been typed (the design's
  // «Unsaved changes»).
  'past.unsavedChanges': 'Unsaved changes',
  // new: the names of the quantity box and of the bin were English on every venue. The two
  // «how many» labels are whole phrases, not a name slotted into one, so Italian can agree the
  // word with the noun («Quante paste»).
  'past.howManyOf': 'How many {name}',
  'past.howManyPastries': 'How many pastries',
  'past.removeRow': 'Remove {name}',
  // What stops a save. The quantity limit is passed as text, so it reads «9999», never «9,999».
  'past.onListTwice': '{name} is on this list twice.',
  'past.howMany': 'How many {name}?',
  'past.thatNameIsToo': 'That name is too long.',
  'past.mostItCanHold': '{n} is the most this can hold.',
  'past.thatIsMorePastries': 'That is more pastries than one day can hold.',
  'past.thatCannotBeSaved': 'That cannot be saved yet.',
  'past.saveDay': 'Save {day}?',
  'past.saveThese': { one: 'Save this pastry for {day}?', other: 'Save these {n} pastries for {day}?' },
  'past.saveEmpty': '{day} will have nothing to prove. Save that?',
  'past.daySaved': '{day} saved.',
  'past.discardChanges': 'Discard changes?',
  'past.unsavedFor': 'You have unsaved changes to {day}. Discard them?',

  // Records.
  'past.lastNDays': { one: 'Last day', other: 'Last {n} days' },
  'past.nothingWasProved': 'Nothing was proved.',
  'past.removeRecordFor': 'Remove the record for {day}, {date}',
  'past.removeThisRecord': 'Remove this record?',
  'past.removeRecordForQ': 'Remove the record for {day}, {date}? This cannot be undone.',
  'past.recordRemoved': 'Record removed.',
  'past.noRecordsYet': 'No records yet.',
  'past.tapConfirmAtThe': 'Tap Confirm at the bottom of a day to keep one.',
  'past.olderRecordsKept': {
    one: 'Older records are kept — this screen shows the last day.',
    other: 'Older records are kept — this screen shows the last {n} days.',
  },

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
