// i18n.js — the INTERFACE language: what the staff read on screen. PURE (no DOM,
// no Firestore), so every rule below is asserted in a unit test rather than read
// back out of rendered markup (P15).
//
// ⚠️⚠️ THIS IS NOT THE LABEL LANGUAGE, AND KEEPING THE TWO APART IS WHY THIS FILE
// AND js/market.js ARE SEPARATE FILES RATHER THAN ONE.
//
//   this file        the INTERFACE language   what the staff READ    a preference
//   js/market.js     the OUTPUT language      what a LABEL says      the LAW
//
// Federico is Italian and his bakeries are in England: he wants the app in
// Italian, and his allergen labels must stay in English because that food is sold
// in the United Kingdom. So an interface set to Italian must not move a single
// word on a label. That is not a promise made in a comment — nothing in this file
// is reachable from the label code, and tests/i18n-label-separation.test.mjs
// fails if anybody imports one into the other.
//
// ⚠️ THE SIGN-IN SCREEN CANNOT USE THIS, and must not try. Nobody is signed in
// yet, so no venue is open, so there is no setting to read — the same reason that
// screen says «Mise» where every other screen says the venue's name. It stays in
// English until somebody is inside.

export const LANGUAGES = Object.freeze(['en', 'it']);

export const DEFAULT_LANGUAGE = 'en';

// ── The words that are DATA, and must never pass through here ────────────────
//
// ⚠️⚠️ TRANSLATING ANY OF THESE BREAKS THE APP, SILENTLY AND IN A WAY NO SCREEN
// EXPLAINS. They are English words, they look exactly like labels, and they are
// identifiers:
//
//   the weekday names ARE Firestore document ids — `pastries/Monday`. Translate
//   them and all seven proving lists become unreachable, with the app cheerfully
//   showing seven empty days;
//   the section keys decide which parts of the app a venue has bought;
//   the role values decide who may do what — and a membership value the code does
//   not recognise is not a demotion, it is a LOCKOUT (learnt three times);
//   the allergen codes are what an ingredient's declaration is stored under. A
//   translated code is a declaration that stops matching, on the one feature in
//   this app that can put somebody in hospital;
//   the unit and country codes are stored on documents and compared by the rules.
//
// This list exists so that translating one turns a test RED and NAMES it — the
// technique from v1.24.1, where a rule that mattered more than a behaviour was
// pinned by its own test rather than left in a comment. A rule that lives only in
// a comment is a rule that comes back.
export const DATA_WORDS = Object.freeze([
  // Firestore document ids for the seven proving lists
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  // which parts of the app a venue has
  'orders', 'calculator', 'catalogue', 'pastries', 'foodcost',
  // who may do what — the membership VALUE itself
  'owner', 'manager', 'staff', 'head-chef',
  // stored on ingredients and products, and compared by firestore.rules
  'kg', 'l', 'pcs',
  // the country, which decides the LABEL language (js/market.js)
  'GB', 'IT',
  // the interface languages themselves
  'en', 'it',
]);

// ── The dictionaries ─────────────────────────────────────────────────────────
//
// One flat map per language, keyed by a dotted name that says where the phrase
// lives: `orders.supplier.delete`, not `deleteBtn`. Flat and dotted so a phrase
// can be found by grepping for the key exactly as it appears at the call site.
//
// ⚠️ A PHRASE IS ONE ENTRY WITH A HOLE IN IT, NEVER TWO HALVES GLUED TOGETHER.
// `'Delete ' + name` cannot be translated: Italian puts the words in a different
// order, and a translator handed two fragments cannot see the sentence. Write
// `'Delete {name}?'` and pass `{ name }`.
//
// ⚠️ AND A COUNT IS NOT AN `if`. English and Italian agree that there are two
// forms here, but they do not agree on which number takes which — so counted
// phrases carry `.one` and `.other` and are picked by Intl.PluralRules, the
// platform's own answer (P19), never by `n === 1 ? … : …` at the call site.
const DICTIONARIES = Object.freeze({
  en: Object.freeze({
    // ── Who can get in ──────────────────────────────────────────────────────
    // ⚠️ THE WORD AND THE STORED VALUE ARE DIFFERENT THINGS, and this block is
    // where that is easiest to get wrong. `role.staff` shows «Employee»; the
    // value in users/{uid} stays 'staff' whatever any language calls it.
    'role.owner': 'Owner',
    'role.manager': 'Manager',
    'role.headChef': 'Head chef',
    'role.staff': 'Employee',

    // ⚠️ THE SAME WORD INSIDE A SENTENCE, ASKED FOR RATHER THAN COMPUTED. The
    // screen used to write `Make ${label.toLowerCase()}`, which is two mistakes
    // at once: it glues a sentence out of fragments, and it TRANSFORMS a
    // translated word. Case is a property of a language, not an operation you
    // may perform on somebody else's — so the form that goes inside a phrase is
    // its own entry, and the translator decides what it looks like.
    'people.make': 'Make {role}',
    // ⚠️ NO ROLE IN THESE TWO. 'Add {role}' worked while there was one button;
    // with two, English needs an article Italian does not take, and the role is
    // already stated by the note above them and by the result screen below.
    'people.sendHow': 'How do you want to send it?',
    'people.add.link': 'Send a link',
    'people.add.digits': 'Read out a code',
    'role.owner.inSentence': 'owner',
    'role.manager.inSentence': 'manager',
    'role.headChef.inSentence': 'head chef',
    'role.staff.inSentence': 'employee',

    // ⚠️ THESE FOUR SENTENCES ARE THE ONLY PLACE ANYBODY IS EVER TOLD what a role
    // can do. Nothing else in the app explains it, so a translation that softens
    // one is a wrong decision about a real person's access, made confidently
    // because the screen said so. «Head chef» must keep saying out loud that it
    // is the manager level under another name, or four pills read as four levels.
    'role.means.owner': 'Everything, including adding people and setting their roles.',
    'role.means.manager': 'Runs this location: can delete suppliers, ingredients, recipes and products. Cannot add people.',
    'role.means.headChef': 'The same as Manager — it is only the job title that differs. Runs this location: can delete suppliers, ingredients, recipes and products. Cannot add people.',
    'role.means.staff': 'Does the daily work — quantities, doughs, orders. Cannot delete things or add people.',

    'people.confirm.owner': 'Make {name} an owner?',
    'people.confirm.manager': 'Make {name} a manager?',
    'people.confirm.headChef': 'Make {name} the head chef?',
    'people.confirm.staff': 'Make {name} an employee?',

    // ⚠️ THE PROMISE IN THE OLD COMMENT HERE, KEPT — AND THE DRIFT IT PREDICTED
    // HAD ALREADY HAPPENED. It said the button name was repeated rather than
    // composed only because auth-gate.js was not extracted yet, and that "when
    // they are, this becomes a hole". It is one now: the button has always read
    // "I have a JOIN code", so the quoted instruction was wrong in English, and
    // the Italian sentence quoted the English words at somebody whose screen says
    // «Ho un codice di accesso». Composed, it cannot drift again in either.
    'people.joinsAs': 'Joins as {role} · {expires} · they open the app, tap “{button}”, create their account and type it.',

    // ── The same invitation, sent as a link ─────────────────────────────────
    'people.link.intro': 'Send this link to them. It works once, and when they open it they choose their own email and password.',
    'people.link.joinsAs': 'Joins as {role} · {expires}',
    // ⚠️ IT NAMES THE VENUE. A message that says only "open this link" is what
    // every scam sent over WhatsApp looks like; the person has to be able to tell
    // before tapping that this is where they work.
    // ⚠️ IT NAMES THE ORDER, AND THE ORDER IS A CONSTRAINT RATHER THAN ADVICE. The
    // code travels in the URL fragment and an installed app always starts from its own
    // start_url with no fragment on it — so "install it first" would lose the
    // invitation. Open the link, join, and the app offers the guide on the other side.
    'people.link.message': 'Hi! Here is your way in to {venue}. Open this link and choose your own password; once you are in, the app will show you how to add it to your phone: {link}',
    'people.link.copied': 'The link is copied. Paste it into a message to them.',
    'people.link.manual': 'Copy this link and send it to them:\n\n{link}',

    // ── Signing in ──────────────────────────────────────────────────────────
    // ⚠️ «Misé» IS NOT HERE. It is the product's name, not a phrase — the same
    // reason a venue's name never passes through a dictionary either.
    'auth.signIn.sub': 'Sign in to open your location.',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.signIn': 'Sign in',
    'auth.forgot': 'Forgot your password?',
    'auth.iHaveACode': 'I have a join code',
    'auth.installGuide': 'How to install the app',
    'auth.enterEmail': 'Enter your email.',
    'auth.enterPassword': 'Enter your password.',
    'auth.signingIn': 'Signing in…',
    'auth.typeEmailFirst': 'Type your email above first, then tap this.',
    // Deliberately does not reveal whether the address has an account.
    'auth.resetSent': 'If {address} has an account, a reset link is on its way.',
    'auth.back': 'Back',
    'auth.tryAgain': 'Try again',
    'auth.otherAccount': 'Sign in with a different account',
    'auth.logOut': 'Log out',
    'auth.logOut.title': 'Log out?',
    'auth.logOut.message': 'You will need your email and password to get back in.',

    // ⚠️ FOUR FIREBASE CODES SHARE ONE SENTENCE ON PURPOSE. Saying which half was
    // wrong tells somebody guessing at the door that an email exists. Keeping one
    // key for the four is what keeps that true through a translation as well.
    'auth.err.badPair': 'That email and password do not match an account.',
    'auth.err.badEmail': 'That does not look like an email address.',
    'auth.err.disabled': 'This account has been turned off. Ask the owner to re-enable it.',
    'auth.err.tooMany': 'Too many attempts. Wait a minute and try again.',
    'auth.err.offline': 'No connection. The first sign-in on a device needs internet.',
    'auth.err.emailTaken': 'That email already has an account. Sign in with it instead.',
    'auth.err.weakPassword': 'Pick a longer password — at least 6 characters.',
    'auth.err.generic': 'Could not sign in. Please try again.',

    // ── Joining with a code ─────────────────────────────────────────────────
    // ⚠️ FOUR SITUATIONS, FOUR SENTENCES, NOT ONE HEDGED ONE. «Type the code you
    // were given» is a LIE to somebody who arrived by link — their code is
    // already in the box — and a sentence that is wrong about what is on screen
    // teaches people to stop reading the next one.
    'join.title.invited': 'You have been invited',
    'join.title.new': 'Join with a code',
    'join.title.have': 'Enter your code',
    'join.sub.prefillNew': 'Your code is already filled in. Add your name and choose a password.',
    'join.sub.prefill': 'Your code is already filled in. Add your name to finish.',
    'join.sub.new': 'Create your account, then type the code you were given.',
    'join.sub.have': 'Type the code you were given.',
    'join.firstName': 'Your first name',
    'join.lastName': 'Your surname',
    'join.email': 'Your email',
    'join.choosePassword': 'Choose a password (at least {n} characters)',
    'join.code': 'Code',
    'join.join': 'Join',
    'join.signInInstead': 'Sign in with that email',
    'join.signInAndAdd': 'Sign in, and we will add the business to your account.',
    'join.creating': 'Creating your account…',
    'join.checking': 'Checking…',
    'join.checkingCode': 'Checking your code…',
    'join.badCode': 'That code does not work. Ask for a new one.',
    // ⚠️ NOT A FAULT WITH THE CODE, AND IT MUST NOT SOUND LIKE ONE. This is what
    // an owner sees on opening an invitation to their own business — which is how
    // anybody checks that one works before sending it.
    'join.alreadyMember': 'You are already in this business. A code cannot change what you can do here.',
    'join.shapeHint': 'Enter your six-digit code, or open the link you were sent.',

    // How long an invitation has left. ⚠️ SELF-CONTAINED PHRASES, because the
    // three sentences that use them join them differently and English cannot
    // borrow Italian's verb: «scade fra 24 ore» is a clause, "24 hours left" is
    // a noun phrase, and neither survives being forced into the other's slot.
    // ⚠️ REAL PLURALS via Intl.PluralRules — never `n === 1 ? …`.
    'join.expires.expired': 'expired',
    'join.expires.minutes': { one: '{n} minute left', other: '{n} minutes left' },
    'join.expires.hours': { one: '{n} hour left', other: '{n} hours left' },
    'join.expires.days': { one: '{n} day left', other: '{n} days left' },

    // ── Above every venue ───────────────────────────────────────────────────
    'hub.where': 'Where would you like to go?',
    'hub.mine': 'My businesses',
    // ⚠️ A COUNT, NOT A TERNARY. It read `count === 1 ? … : …`, which is English's
    // rule written into the code — a language whose plural works differently
    // cannot be fixed by translating either half.
    'hub.mine.sub': { one: 'The place you run', other: 'The places you run' },
    'hub.customers': 'Customer businesses',
    'hub.customers.sub': 'The businesses using Misé',
    'hub.back': 'Back to Misé',

    'picker.title': 'Choose location',
    'picker.sub': 'You have access to more than one.',
    'noAccess.title': 'No location yet',
    'noAccess.body': 'This account is not linked to a location. If you were given a code, type it here.',

    'invite.title': 'You opened an invitation',
    'invite.message': 'Add this business to {who}?',
    'invite.ok': 'Add it',
    'invite.cancel': 'Not now',

    // ── Who can get in ──────────────────────────────────────────────────────
    'people.title': 'Who can get in',
    'people.rename': 'Rename',
    'people.remove': 'Remove',
    'people.cancel': 'Cancel',
    'people.done': 'Done',
    'people.empty': 'Nobody else yet.',
    'people.firstName': 'First name',
    'people.surname': 'Surname',
    'people.noEmail': 'no email',
    'people.readOut': 'Read this out to them:',
    // ⚠️ «you never choose it for them» EARNS ITS PLACE. It is the first thing
    // Federico assumed on reading this screen — that the owner hands out an email
    // and a password. An owner who knows somebody's password makes the roster
    // meaningless (nothing that account does can be pinned to that person) and
    // becomes the password desk for ever. The screen says so rather than relying
    // on the join form to make it obvious later.
    'people.invite.intro': 'Add someone who works here. They install the app and create their own account, with their own email and password — you never choose it for them.',
    'people.remove.title': 'Remove this person?',
    'people.remove.message': '{name} ({email}) will lose access to this location immediately. Everything they have entered stays.',
    'people.err.read': 'Could not read who works here. Check your connection.',
    'people.err.name': 'Could not save that name. Check your connection.',
    'people.err.change': 'Could not change that. Check your connection and try again.',
    'people.err.remove': 'Could not remove them. Check your connection and try again.',
    'people.err.code': 'Could not make a code. Check your connection and try again.',

    // ── The venue's Home strip ──────────────────────────────────────────────
    'home.switch': 'Switch location',
    'home.switch.title': 'Switch location?',
    'home.switch.ok': 'Switch',
    'home.switch.cleared': 'Anything typed but not saved on this device is cleared.',
    'home.switch.toOne': 'Open {other} instead of {here}?',
    'home.switch.toMany': 'Choose a different location?',

    // ── The sections a venue has ────────────────────────────────────────────
    // ⚠️ THE WORD ONLY. `calculator`, `orders`, `catalogue`, `pastries` and
    // `foodcost` are stored on the venue document and decide what somebody
    // bought; they are in DATA_WORDS and can never be a key here.
    'section.calculator': 'Calculator',
    'section.orders': 'Orders',
    // ⚠️ NOT A SECTION NAME. It is a PAGE inside the `orders` section (the records
    // that used to sit behind the gear), so it is deliberately absent from
    // js/sections.js SECTIONS — a name added there switches itself on for every
    // venue that already exists.
    'section.suppliers': 'Suppliers',
    // ⚠️ THE LONG NAME AND THE SHORT ONE ARE TWO KEYS ON PURPOSE. This one names the
    // page everywhere somebody is CHOOSING what to open (the Home card, the screen's
    // own title, the help sheet) — because «Suppliers» alone never told anybody the
    // 67 ingredients were in there. The short one above stays on the Orders bottom
    // bar, where three buttons share a 320px phone and this label would wrap it.
    'section.suppliersAndIngredients': 'Suppliers & ingredients',
    'section.catalogue': 'Recipe catalogue',
    'section.pastries': 'Pastries',
    'section.foodcost': 'Food cost',
    'section.calculator.sub': 'Dough scaling for the day’s orders',
    'section.orders.sub': 'Suppliers, ingredients and the WhatsApp order',
    'section.catalogue.sub': 'Recipes, scaling and guided mixing',
    'section.pastries.sub': 'The seven weekday proving lists',
    'section.foodcost.sub': 'Prices, margins and labels',

    // ── What each page calls itself in the browser tab ───────────────────────
    // ⚠️ THE INSTALLED APP'S NAME IS NOT HERE, and deliberately. That comes from
    // manifest.json, which a phone reads once WHEN THE APP IS INSTALLED and never
    // again — it cannot be per-language, and changing it costs a re-install by hand
    // on every phone (v1.56.1, v1.58.1). These are the page titles, which follow the
    // reader like everything else drawn on screen.
    'title.calculator': 'Dough calculator — Misé',
    'title.catalogue': 'Recipe catalogue — Misé',
    'title.foodcost': 'Food cost — Misé',
    'title.orders': 'Orders — Misé',
    'title.pastries': 'Pastries — Misé',
    'title.suppliers': 'Suppliers & ingredients — Misé',

    // ── What a screen reader says, which nothing on screen shows ─────────────
    // ⚠️ INVISIBLE, AND THEREFORE THE LAST THING ANYBODY NOTICES. Every icon button
    // in this app carries an aria-label and every one of them was English: somebody
    // using VoiceOver in Italian heard «Back», «Home», «Main sections» on every
    // screen. No screenshot can show this and no measurement can find it.
    'aria.mainSections': 'Main sections',
    'aria.ordersSections': 'Orders sections',
    'aria.orderView': 'Order view',
    'aria.dayOfWeek': 'Day of the week',
    'aria.allMyBusinesses': 'All my businesses',
    'aria.editThisDay': 'Edit this day',
    'aria.editRecipe': 'Edit recipe',
    'aria.whichIngredients': 'Which ingredients to show',
    'aria.whichSuppliers': 'Which suppliers to show',
    'aria.ingredientsFrom': 'Ingredients from {supplier}',

    // ── The install guide ────────────────────────────────────────────────────
    // ⚠️ THE WHOLE PAGE WAS ENGLISH — every word of it — because it is the one page
    // reached BEFORE signing in, so no venue is open and nothing was setting a
    // language. It follows the PHONE (navigator.language), which is the only fact
    // available here and is also the right one: these steps name buttons in the
    // phone's OWN menus, and a phone set to Italian shows «Condividi», not «Share».
    'ig.pageTitle': 'Install Misé',
    'ig.installTheApp': 'Install the app',
    'ig.whichDevice': 'Which device are you using?',
    'ig.device.ios': 'iPhone / iPad',
    'ig.device.android': 'Android',
    'ig.device.desktop': 'Computer',
    'ig.yourDevice': 'your device',
    'ig.changeDevice': '← Change device',
    'ig.qrAlt': 'QR code to open the Misé app',
    'ig.qrCaption': 'Or scan this with your phone camera to open the app',
    'ig.safari.title': 'Open this page in Safari to install.',
    'ig.safari.body': 'On iPhone the app can only be added to the Home Screen from Safari — other browsers (like Chrome) cannot install it.',
    'ig.safari.how': 'Tap the ••• menu and choose “Open in Safari”, or copy the link and paste it in Safari.',
    'ig.copyLink': 'Copy link',
    'ig.ios.1': 'Open the link in Safari (it must be Safari).',
    'ig.ios.2': 'Tap the Share button (the square with an up arrow).',
    'ig.ios.3': 'Scroll down and tap “Add to Home Screen”.',
    'ig.ios.4': 'Tap “Add” — the app icon appears on your home screen.',
    'ig.android.1': 'Open the link in Chrome.',
    'ig.android.2': 'Tap the “Install app” button if it appears, or the ⋮ menu (top right).',
    'ig.android.3': 'Tap “Install app” / “Add to Home screen”.',
    'ig.android.4': 'Confirm — the app icon appears.',
    'ig.desktop.1': 'Open the link in Chrome or Edge.',
    'ig.desktop.2': 'Click the install icon in the address bar (a small screen with a ⊕), or the menu → “Install Misé”.',
    'ig.desktop.3': 'Confirm — it opens in its own window and gets a shortcut.',
    'ig.note': 'You only do this once per device. After that, just tap the app icon — like any other app.',

    // ── The app's own customers ─────────────────────────────────────────────
    'bz.title': 'Customer businesses',
    'bz.new': 'New business',
    'bz.hint': 'Your own venues are not here — they are behind “My businesses”.',
    'bz.empty': 'No businesses yet. “New business” above creates one.',
    'bz.noSections': 'No sections',
    'bz.status.open': 'Somebody has opened this',
    'bz.status.stranded': 'Nobody has opened this yet',
    'bz.created': 'Created {day} {month} {year}',
    'bz.createdRecently': 'Created recently',
    // ⚠️ THE IN-SENTENCE FORMS ARE THEIR OWN ENTRIES, not a lower-cased copy. The
    // screen used to write .replace(/^Created/, 'created'), which is English
    // grammar in the code: it does nothing in a language whose word starts
    // differently, and leaves Italian capitalised mid-line.
    'bz.created.inSentence': 'created {day} {month} {year}',
    'bz.createdRecently.inSentence': 'created recently',
    'bz.rowState': '{status} · {created}',
    'bz.newLink': 'Make a new link',
    'bz.newLink.title': 'Make a new link?',
    'bz.newLink.message': 'A new link for {name}. Any link sent before stops working, so whoever holds one cannot use it.',
    'bz.making': 'Making…',
    'bz.delete': 'Delete',
    'bz.delete.title': 'Delete this business?',
    'bz.delete.message': '{name} will be removed, along with the link that opens it. Nobody has opened it, so nothing else is lost — but this cannot be undone.',
    'bz.link.copied': 'The new link for {name} is copied. Paste it into a message to them.',
    'bz.link.once': 'It works once and has {expires}.',
    'bz.link.manual': 'Copy this link and send it to {name}:',
    'bz.err.newLink': 'Could not make a new link. Try again.',
    'bz.err.delete': 'Could not delete this business. Try again.',
    'bz.err.load': 'Could not load the businesses. Check your connection.',

    // ── Creating a business ─────────────────────────────────────────────────
    'nc.title.self': 'Add a business',
    'nc.title.customer': 'New customer',
    'nc.nameLabel': 'The business name',
    'nc.namePlaceholder': 'Panificio Rossi',
    'nc.create': 'Create',
    // ⚠️ THESE TWO WERE WRITTEN OUT AS FINISHED WORDS in the country list, one of
    // them in Italian — so an English app offered a country whose sub-line read
    // «Le etichette sono prodotte in italiano.» The list beside it held KEYS, and
    // two lists drawn by the same code holding two different things is how a
    // lookup gets added to one and forgotten on the other.
    'nc.country.labels.GB': 'Labels are printed in English.',
    'nc.country.labels.IT': 'Labels are printed in Italian.',
    'nc.link.message': 'Here is your link to set up {name}: {link}',
    'nc.country': 'Which country does it sell in?',
    'nc.sections.self': 'Which sections it uses',
    'nc.sections.customer': 'What they are buying',
    'nc.explain.self': 'Creates the business in YOUR account, as owner. It opens straight away — no link, nothing to send.',
    'nc.explain.customer': 'Creates the business and a link that makes whoever opens it its owner. They choose their own email and password. You do not go in.',
    'nc.leave.title': 'Leave without sending the link?',
    'nc.leave.message': '{name} has been created, but their link is shown only here and cannot be shown again. Without it nobody can open their app.',
    'nc.leave.ok': 'Leave anyway',
    'nc.leave.stay': 'Stay',
    'nc.err.noName': 'Give the business a name.',
    'nc.err.longName': 'That name is longer than {n} characters.',
    'nc.err.noCountry': 'Choose the country this business sells in — it decides the language of its labels.',
    'nc.err.noSection': 'Choose at least one section — otherwise their app opens empty.',


    // ── The days, and the difference between a WORD and an IDENTIFIER ───────
    // ⚠️ The LONG weekday names are NOT here and must never be. They are stored on
    // every supplier (orderDays/deliveryDays) and are the document ids of the seven
    // proving lists — they are on DATA_WORDS above. Only the short forms, which
    // never leave a screen, are words.
    'day.weekdayShort.0': 'Sun', 'day.weekdayShort.1': 'Mon', 'day.weekdayShort.2': 'Tue',
    'day.weekdayShort.3': 'Wed', 'day.weekdayShort.4': 'Thu', 'day.weekdayShort.5': 'Fri',
    'day.weekdayShort.6': 'Sat',
    // ⚠️ THE LONG FORMS ARE PRESENTATION, LIKE THE SHORT ONES ABOVE — never the data.
    // WEEKDAY_LONG in js/orders/day.js holds the same seven words as STORED VALUES
    // (a supplier's orderDays, a proving list's document id) and must stay English:
    // translating those would make a Monday supplier never match a Monday. These are
    // only ever printed, and are needed where a short form would read badly inside a
    // sentence («consegna il mar» vs «consegna il martedì»).
    'day.weekdayLong.0': 'Sunday', 'day.weekdayLong.1': 'Monday', 'day.weekdayLong.2': 'Tuesday',
    'day.weekdayLong.3': 'Wednesday', 'day.weekdayLong.4': 'Thursday', 'day.weekdayLong.5': 'Friday',
    'day.weekdayLong.6': 'Saturday',
    'day.monthShort.0': 'Jan', 'day.monthShort.1': 'Feb', 'day.monthShort.2': 'Mar',
    'day.monthShort.3': 'Apr', 'day.monthShort.4': 'May', 'day.monthShort.5': 'Jun',
    'day.monthShort.6': 'Jul', 'day.monthShort.7': 'Aug', 'day.monthShort.8': 'Sep',
    'day.monthShort.9': 'Oct', 'day.monthShort.10': 'Nov', 'day.monthShort.11': 'Dec',
    // ⚠️ THE ORDER OF THE PIECES IS THE PHRASE. A language that puts the month
    // first says so here, instead of needing code that knows about it.
    'day.spelled': '{weekday} {d} {month} {year}',
    'day.today': 'Today',
    'day.yesterday': 'Yesterday',
    'day.tomorrow': 'Tomorrow',
    // ⚠️ ASKED FOR, NEVER COMPUTED WITH toLowerCase(). Whether a word loses its
    // capital mid-sentence is the translator's business, not the code's.
    'day.today.inSentence': 'today',
    'day.yesterday.inSentence': 'yesterday',
    'day.tomorrow.inSentence': 'tomorrow',
    'day.inNDays': { one: 'In {n} day', other: 'In {n} days' },
    'day.nDaysAgo': { one: '{n} day ago', other: '{n} days ago' },
    'day.inNDays.inSentence': { one: 'in {n} day', other: 'in {n} days' },
    'day.nDaysAgo.inSentence': { one: '{n} day ago', other: '{n} days ago' },
    // The Log badge when the dough was made on one day FOR another.
    'day.madeFor': '{made} for {target}',
    // ⚠️ WHOLE PHRASES: English needs 'on' before a date and nothing before
    // 'today'; Italian needs 'il'. Gluing a preposition in code decides that for
    // every language at once.
    'day.on': 'on {day}',
    'day.for': 'for {day}',

    // ── Sentences that name a DAY, kept whole ────────────────────────────────
    // ⚠️ WHOLE SENTENCES, not a day word glued into English. Once 'Today' could be
    // «Oggi», every one of these read as «Placed oggi» — a translated word inside
    // an untranslated sentence, which is worse than either language alone.
    'orders.sendDay': 'Send {day}',
    'orders.notPlacedFor': '{supplier} — order not placed',
    // ⚠️ ONE SENTENCE, NOT TWO NESTED. It was `t('orders.typedWhen', { items: t(
    // 'orders.itemsCount', { n }) })` — a count phrase dropped into a sentence whose
    // PARTICIPLE has to agree with it. English does not notice; Italian read «1 voce
    // scritte» on the Orders screen, which is simply wrong. Seen in a screenshot after
    // every check had passed.
    'orders.typedWhen': {
      one: '{n} item typed {when}',
      other: '{n} items typed {when}',
    },
    'orders.placedWhen': 'Placed {when}',
    'orders.updateOrderFor': 'Update {supplier}’s order {day}?',
    'orders.deleteOrderFor': 'Delete {supplier}’s order {day}?\n\nIt is removed from History for good and cannot be recovered. The suggested order quantities learn from these records, so they will change.',
    'co.alreadySentFor': 'You have already sent an order for {day}. Sending again replaces it.',
    'co.ordersClosedFor': 'Orders for {day} have closed. Please choose another day.',
    'co.sendEmptyFor': 'Send an order with nothing in it for {day}?',
    'co.sendOrderFor': 'Send this order for {day}?',
    'co.send': 'Send',
    'co.clientAndDay': '{client} — {day}.',

    // ── The Leavening box, and the choices that explain themselves ───────────
    'calc.leavening': 'Leavening',
    'calc.leaveningNone': 'Nothing rises in this recipe',
    'calc.unnamedIngredient': 'Unnamed ingredient',
    'calc.leaveningHint': 'Which ingredient makes the dough rise. Only this one is scaled by the percentage below.',
    'calc.leaveningStartAt': 'Start at',
    // ⚠️ The two hints below are not decoration: they are what makes keeping this
    // field honest instead of confusing. With the knob on it is a STARTING point
    // shared by every phone; with it off it is the only number there is.
    'calc.leaveningPctHintKnob': 'The percentage every phone starts from. Each phone can then move its own knob without changing this.',
    'calc.leaveningPctHintFixed': 'The percentage this recipe always uses. With the knob hidden, this is the only place it can be set.',
    'calc.leaveningKnobHint': 'Lets whoever is mixing raise or lower the percentage on the day, on their own phone.',
    'calc.howItCalculates': 'How it calculates',
    'calc.logicHint.orders': 'The amount of dough is decided by what the clients ordered.',
    'calc.logicHint.total': 'You type how many kilos of dough to make.',
    'calc.logicHint.both': 'What the clients ordered, plus an extra amount you type.',

    // ── 'I am on holiday' ────────────────────────────────────────────────────
    'away.title': 'I am on holiday',
    'away.untilLabel': 'Away until, and including',
    'away.set': 'Set',
    'away.onUntil': 'On holiday until {day}',
    // ⚠️ IT SAYS WHAT BEING AWAY DOES AND WHAT IT DOES NOT. Without this line
    // somebody reasonably assumes the work is being handled by somebody else —
    // the one belief this feature must never create.
    'away.whatItDoes': 'Your phone stops ringing. The order lists still arrive and are still waiting for you when you come back — nothing is passed to anybody else.',
    'away.backTitle': 'Back already?',
    'away.backMessage': 'Your holiday runs to {day}. Ending it now turns your notifications back on.',
    'away.back': 'I am back',
    'away.badDate': 'That date cannot be used. Pick a day from today onwards, within a year.',
    'away.saveFailed': 'Not saved — check the connection and try again.',
    // ⚠️ THE WARNING THAT MAKES THE WHOLE FEATURE SAFE.
    'away.nobodyTitle': 'Nobody will be told',
    // ⚠️ A REAL PLURAL. 'Federico, Giulia is away' was on the screen — two people
    // and a singular verb. Intl decides the form; the code never counts.
    'away.nobodyMessage': {
      one: '{names} is away, so no phone will ring for this list. It still appears in Orders and on the Home, and waits there.',
      other: '{names} are away, so no phone will ring for this list. It still appears in Orders and on the Home, and waits there.',
    },
    'away.nobodyMessagePlain': 'Everybody who runs this place is away, so no phone will ring for this list. It still appears in Orders and on the Home, and waits there.',
    'away.sendAnyway': 'Send anyway',
    'calc.recipeSource': 'Where the ingredients come from',
    'calc.sourceOwn': 'This recipe has its own',
    'calc.sourceOwnHint': 'The ingredients are typed here. Nothing else uses them.',
    'calc.sourceLinkedHint': 'The ingredients come from the Recipe catalogue. Correct them there and every tab using this recipe is corrected too.',
    'calc.editedInCatalogue': 'Edited in the Recipe catalogue, not here — so there is only ever one version.',
    'calc.sourceMissing': 'This recipe cannot be read from the catalogue right now, so nothing can be calculated. Check it still exists.',
    'calc.sourceEmpty': 'That catalogue recipe has no ingredients yet.',
    'calc.sourceUnweighable': 'This recipe cannot be used here yet: “{row}” has no weight. The calculator scales everything by weight, so give it one in the catalogue.',
    'calc.sourceLinkFailed': 'Could not link that recipe — check the connection and try again.',
    // ── Orders ──────────────────────────────────────────────────────────────
    // ⚠️ THE WHATSAPP MESSAGE A SUPPLIER RECEIVES IS NOT HERE.
    // js/orders/order-text.js is pinned character for character by its own test,
    // because that text is what somebody actually gets sent — changing a comma
    // there is a decision, not a translation. Deliberately left out of this pass.
    'orders.deletedIngredient': 'Deleted ingredient',
    'orders.setAQuantityTo': 'Set a quantity to 0 to remove that item from the order.',
    'orders.deleteThisOrder': 'Delete this order',
    'orders.editOrder': 'Edit order',
    'orders.noItemsRecorded': 'No items recorded.',
    'orders.thisOrderWouldHave': 'This order would have no items left. Use “Delete this order” if it should not be there at all.',
    'orders.nothingLeftToSave': 'Nothing left to save',
    'orders.saveChanges': 'Save changes',
    'orders.noSupplier': 'No supplier',
    'orders.unknownSupplier': 'Unknown supplier',
    'orders.noPastOrdersYet': 'No past orders yet.',
    'orders.sendAll': 'Send all',
    'orders.sendOnWhatsapp': 'Send on WhatsApp',
    'orders.wholeWeekAllSuppliers': 'Whole week — all suppliers',
    'orders.searchAnIngredient': 'Search an ingredient…',
    'orders.noIngredientsYetAdd': 'No ingredients yet — add them in Settings.',
    'orders.nothingInThisOrder': 'Nothing in this order matches your search.',
    'orders.noIngredientMatchesYour': 'No ingredient matches your search.',
    'orders.orderScreen': 'Order screen',
    'orders.showStock': 'Show stock',
    'orders.showTheStockBox': 'Show the Stock box on order rows',
    'orders.turnThisOffIf': 'Turn this off if you do not count what is left before ordering. Suggested quantities keep working: with no stock entered they become your usual order amount.',
    'orders.daysOfHistory': 'Days of history',
    'orders.daysOfPastOrders': 'Days of past orders shown in History',
    'orders.olderOrdersAreNever': 'Older orders are never deleted — they stay one tap away under “Show older orders”, and suggested quantities keep learning from all of them.',
    'orders.addSupplier': '+ Add supplier',
    'orders.searchASupplier': 'Search a supplier…',
    'orders.noSuppliersYet': 'No suppliers yet.',
    'orders.noSupplierMatchesYour': 'No supplier matches your search.',
    'orders.addIngredient': '+ Add ingredient',
    'orders.noIngredientsYet': 'No ingredients yet.',
    'orders.noPrice': 'No price',
    'orders.notSaved': 'Not saved',
    'orders.editSupplier': 'Edit supplier',
    'orders.newSupplier': 'New supplier',
    'orders.deliveryDaysWhenThey': 'Delivery days — when they deliver',
    'orders.orderDaysWhenYou': 'Order days — when you place the order',
    'orders.phoneWhatsappDigitsOnly': 'Phone (WhatsApp, digits only)',
    'orders.noPrice2': 'None',
    'orders.weightOfOnePiece': 'Weight of one piece (kg)',
    'orders.neededOnlyToUse': 'Needed only to use this in a recipe written in grams — one egg is about 0.055, a vanilla pod about 0.0035.',
    'orders.howItIsBought': 'How it is bought',
    'orders.loading': 'Loading…',
    'orders.noPriceRecordedYet': 'No price recorded yet.',
    'orders.priceHistory': 'Price history',
    'orders.showThem': 'Show them',
    // ⚠️ 'orders.cerealsContainingGluten' WAS RETIRED ON 23 Aug 2026 AND MUST NOT COME
    // BACK. It named an allergen category — a food word — from the INTERFACE
    // dictionary, so an Italian screen printed «CEREALI CONTENENTI GLUTINE» above rows
    // reading «Wheat», «Rye». The heading now comes from allergenGroupName() in
    // js/market.js, chosen by the venue's country like the label it has to match.
    // A key with this name existing here at all is the wire that lets somebody
    // re-translate an allergen heading by preference; a test forbids it.
    // ⚠️ 'orders.theRest' STAYS: «the other twelve categories» names no food.
    'orders.theRest': 'The rest',
    'orders.noNutritionYet': 'Nothing yet',
    'orders.nutritionComplete': 'Complete',
    // ⚠️ orders.allergensAndNutrition («Allergens and nutrition») was retired here: the
    // two are separate folding sections now, each named by its own heading, so one
    // label covering both would name neither.
    'orders.declaredShort': 'declared',
    'orders.copyThisFromThe': 'Copy this from the supplier’s specification, not from memory. “Traces” is what the supplier declares — it cannot know about your own kitchen.',
    'orders.iHaveCheckedThe': 'I have checked the supplier’s specification',
    // ── The pack's own ingredient list ──────────────────────────────────────
    'orders.pack.label': 'The ingredient list printed on the pack',
    'orders.pack.help': 'Type or paste it exactly as it is printed. The app looks for allergen words and ticks the boxes below for you — you still check them and confirm.',
    'orders.pack.placeholder': 'e.g. Wheat flour, water, butter (milk), salt, malted barley flour. May contain traces of nuts.',

    // ── Photographing the packet instead of typing it ────────────────────────
    // ⚠️ ITS OWN WORDS, NOT THE CATALOGUE'S. The same code means «no recipe in that
    // photograph» there and «no ingredient list on that packet» here, and sharing the
    // sentences would make one of the two wrong.
    'orders.pack.photo.fill': 'Photograph the packet',
    'orders.pack.photo.title': 'Ingredients from a photo',
    'orders.pack.photo.lead': 'Photograph the ingredient list printed on the packet and the app will type it out for you.',
    'orders.pack.photo.take': 'Take a photo',
    'orders.pack.photo.addAnother': 'Add another photo',
    'orders.pack.photo.remove': 'Remove this photo',
    'orders.pack.photo.thumbAlt': 'The photo you took',
    'orders.pack.photo.read': 'Read the packet',
    'orders.pack.photo.reading': 'Reading…',
    'orders.pack.photo.working': 'Reading the packet… this takes a few seconds.',
    // ⚠️ IT SAYS WHAT THE APP WILL AND WILL NOT DO. Reading a pack only ticks boxes;
    // the product still reads «not yet checked» until a person confirms it, and this
    // is the one place to say so before anybody relies on it.
    'orders.pack.photo.note': 'Check it against the packet before you save. The app will suggest allergen ticks from this text, but nothing is declared until you tick the box that says you have checked it.',
    'orders.pack.photo.replaceTitle': 'Replace what is written?',
    'orders.pack.photo.replaceBody': 'There is already an ingredient list here. Two lists together would be read as one product, so the photo replaces it. Nothing is saved until you press Save.',
    'orders.pack.photo.replaceOk': 'Replace it',
    'orders.pack.photo.keepMine': 'Keep what I wrote',
    'orders.pack.photo.truncated': 'That list is very long — only the first 4000 characters were kept. Check the end against the packet.',
    'orders.pack.photo.err.offline': 'No connection. The photo has not been sent — try again when you are back online.',
    'orders.pack.photo.err.notAllowed': 'You cannot change products in this venue.',
    'orders.pack.photo.err.signedOut': 'Sign in again and try once more.',
    'orders.pack.photo.err.photoOff': 'Reading a packet from a photo is switched off for this venue.',
    'orders.pack.photo.err.personLimit': 'You have read a lot of photos today. Try again later, or type this one in by hand.',
    'orders.pack.photo.err.venueLimit': 'This venue has read a lot of photos today. Try again later, or type this one in by hand.',
    'orders.pack.photo.err.noImages': 'Take a photo first.',
    'orders.pack.photo.err.tooMany': 'Up to 5 photos at a time.',
    'orders.pack.photo.err.tooLarge': 'Those photos are too big. Take them again a little closer.',
    'orders.pack.photo.err.badImage': 'That photo could not be prepared. Take it again.',
    'orders.pack.photo.err.badFormat': 'The app cannot read that photo’s format. Take it with the camera instead of picking it from your library.',
    'orders.pack.photo.err.nothingFound': 'No ingredient list was found in these photos. Try a straighter, closer shot of the printed list.',
    'orders.pack.photo.err.refused': 'The reader would not read this photo. If it really is an ingredient list, take the photo again.',
    'orders.pack.photo.err.tooLong': 'That list is too long to read in one go. Photograph it in two parts.',
    'orders.pack.photo.err.tooSlow': 'Reading took too long and was stopped. Try again with fewer photos.',
    'orders.pack.photo.err.failed': 'The photo could not be read. Try again.',
    // ⚠️ RECOGNISING NOTHING MUST BE SAID OUT LOUD. Silence here reads as "this pack
    // contains nothing", which is the single worst thing this feature could say.
    'orders.pack.recognisedNothing': 'It recognised no allergen words in this text. That does NOT mean there are none — read the pack yourself and tick what it says.',
    'orders.pack.questionWhich': '“{word}” could be {options} — the pack does not say which. Tick it yourself if you know.',
    'orders.pack.questionVague': '“{word}” could hide an allergen. Ask the supplier what is in it.',
    'orders.pack.questionCategory': 'The pack says “{word}” — a whole family. The law needs the exact one (which nut? which cereal?), so nothing was ticked. Ask the supplier which.',
    'orders.pack.stillYours': 'This only ticks boxes. Nothing is declared until you tick “I have checked the supplier’s specification” and save.',
    'orders.per100G': 'Per 100 g',
    'orders.eGGalbani': 'e.g. Galbani',
    'orders.eGCasseBox': 'e.g. casse, box',
    'orders.noSupplier2': '— No supplier —',
    'orders.editIngredient': 'Edit ingredient',
    'orders.newIngredient': 'New ingredient',
    'orders.orderUnit': 'Order unit',
    'orders.orderToPlaceToday': 'Order to place today',
    'orders.ordersToPlaceToday': 'Orders to place today',
    'orders.thisDeviceDoesNot': 'This device does not support notifications.',
    // ⚠️ THIS SENTENCE DESCRIBES THE ALERTS, SO IT HAS TO AGREE WITH THEM. It said
    // "a UK bank holiday" until 24 Aug 2026 — left behind when the alerts themselves
    // stopped naming a country, and found by sweeping the LIVE site for the words
    // rather than by any test. On an Italian venue it explained a feature the app
    // does not have.
    'orders.getAnAlertWhen': 'Get an alert when an order is due (on a supplier’s order day), when a public holiday is coming up, or when a holiday clashes with a supplier delivery day. Note: alerts only show while the app is open.',
    'orders.notificationsAreOnFor': ' Notifications are on for this device.',
    'orders.notificationsAreBlockedTurn': 'Notifications are blocked. Turn them on for this app in your browser/site settings, then reload.',
    'orders.enableNotifications': ' Enable notifications',
    'orders.noSuppliersYet2': 'No suppliers yet',
    'orders.addYourSuppliersAnd': 'Add your suppliers and ingredients from the settings panel (gear icon, top right).',
    'orders.nothingToSendThat': 'Nothing to send — that order has no items.',
    'orders.nothingToSendFor': 'Nothing to send for that day.',
    'orders.orderUpdated': 'Order updated ✓',
    'orders.couldNotUpdateThe': 'Could not update the order — check your network and try again.',
    'orders.orderDeleted': 'Order deleted',
    'orders.couldNotDeleteThe': 'Could not delete the order — check your network and try again.',
    'orders.orderSent': 'Order sent',
    'orders.markAsPlaced': 'Mark as placed',
    'orders.nothingLeftToRecord': 'Nothing left to record — those rows are already placed or empty.',
    'orders.tryAgain': 'Try again.',
    // ⚠️ ADDED 23 Aug 2026. Every one of these was written straight into the code, so
    // the Orders screen — the one somebody works on all day — answered in English on
    // an Italian venue. None of the four i18n suites looks at a template literal
    // handed to setStatus() or built into a confirm message.
    'orders.notRecordedRowsStillThere': '{names} — NOT recorded, the rows are still there.',
    'orders.andSaved': '{names} saved.',
    'orders.orderSavedToHistory': '{names} — order saved to history ✓',
    'orders.savedButNotCleared': '{name} — order saved to History, but the rows could not be cleared. Reload the page; do NOT record it again.',
    'orders.quantitiesClearedFor': 'Quantities cleared for {n} suppliers ✓',
    'orders.checkExtraDigit': 'Check it is not an extra digit.',
    'orders.liveConnectionLost': 'Lost the live connection for {what}. What you see may be out of date — reload the page.',
    // ⚠️ A REAL PLURAL. It was `${days} day${days === 1 ? '' : 's'}` — English's rule
    // written into the code, which cannot be translated by moving either half.
    'orders.noOrdersInTheLast': {
      one: 'No orders in the last day.',
      other: 'No orders in the last {n} days.',
    },
    'orders.weekOf': 'Week of {day}',
    'orders.orderPlaced': 'Order placed',
    'orders.noQuantitiesTypedYet': 'No quantities typed yet. Add them first.',
    'orders.recordTheseOrders': 'Record these orders',
    'orders.nothingToRecordFor': 'Nothing to record for this supplier — add quantities first.',
    'orders.youReOfflineReconnect': 'You’re offline — reconnect to record this order.',
    'orders.couldNotSaveThe': 'Could not save the order — check your network and try again.',
    'orders.clearQuantities': 'Clear quantities',
    'orders.youReOfflineReconnect2': 'You’re offline — reconnect to clear these quantities.',
    'orders.quantitiesCleared': 'Quantities cleared ✓',
    'orders.couldNotClearThem': 'Could not clear them — reload the page to see what is really saved.',
    'orders.nothingTypedYet': 'Nothing typed yet.',
    'orders.addToIt': 'Add to it',

    // ⚠️ THE CONFIRMATION SCREEN (js/orders/place-confirm.js). What is recorded is
    // what the person placing the order confirms — not what the shared order happens
    // to say at the instant the button is tapped.
    'orders.confirm.aboutToRecord': 'This is what will be recorded:',
    'orders.confirm.addTitle': 'Add to the order',

    // ⚠️ NOTHING ADDED TO THE SHARED ORDER STAYS UNKNOWN TO WHOEVER BUYS IT.
    // js/orders/untold-changes.js. One rule, said to the two people who can act.
    'orders.untold.changed': {
      one: '{supplier}: the order changed since it was last sent — 1 addition',
      other: '{supplier}: the order changed since it was last sent — {n} additions',
    },
    'orders.untold.resend': 'Send the list again',
    'orders.alert.close': 'I have read this',
    'orders.alert.reopen': 'Show the notices again',
    'orders.settings.openHistory': 'Past orders',
    'orders.untold.alreadyTitle': 'This was already ordered',
    'orders.untold.alreadyLine': '{name} — {ordered} ordered, {live} now in the order',
    'orders.untold.callSupplier': 'If more is really needed, ring the supplier — the app cannot undo a phone call.',
    'orders.untold.asked': 'asked: {n}',
    'orders.untold.ordered': 'ordered: {n}',
    'orders.confirm.asked': 'asked: {n}',
    'orders.confirm.usually': 'usually about {n}',
    'orders.confirm.addsToExisting': 'An order for {supplier} is already recorded {when} — these amounts will be ADDED to it.',
    'orders.confirm.sendFirst': 'Send the order to the supplier first — recording it clears the rows.',
    'orders.confirm.allZero': 'Every quantity is 0, so there is nothing to record. Go back to change them, or leave this screen.',
    'orders.confirm.noneRecorded': 'Nothing was recorded for {names} — every quantity was 0.',
    'orders.couldNotUpdateThe2': 'Could not update the order’s day — check your network and try again.',
    'orders.couldNotDiscardThe': 'Could not discard the order — check your network and try again.',
    'orders.couldNotSaveThe2': 'Could not save the order — check your network. Keep this page open.',
    'orders.sendOrder': 'Send order',
    'orders.noItemsInThis': 'No items in this order yet. Add quantities first.',
    'orders.todaySOrdersAre': 'Today’s orders are all placed',
    'orders.orderToday': 'Order today',
    'orders.itSTodayS': 'It’s today’s',
    'orders.unnamedProduct': 'Unnamed product',
    'orders.messageFormat': 'Message format',
    'orders.bySupplier': 'By supplier',
    'orders.oneList': 'One list',
    'orders.selectAllSuppliers': 'Select all suppliers',
    'orders.nothingIsBeingOrdered': 'Nothing is being ordered yet.',

    // ⚠️ WAS WRITTEN BY HAND, IN ENGLISH, IN TWO COPIES (supplier-picker.js and
    // history.js) that had already drifted into two different plurals. One
    // definition now, and Intl decides the form.
    'orders.itemsCount': { one: '{n} item', other: '{n} items' },
    'orders.whatsappMessage': 'WhatsApp message',

    // ── The Fornitori screen: the records, on a page of their own ────────────
    // ⚠️ NOT "prices". An employee is refused ingredient-prices by the rules and sees
    // none, and a card must not advertise what it will not show.
    // ⚠️ AND NOT "products" either, which the title's own «ingredients» already says:
    // measured, the longer phrase took the Home card to a second sub-line and 130px
    // against every other card's 104px. Two words carry the whole point — the contact
    // details and the allergen declarations are what is NOT obvious from the title.
    'ui.contactsAndAllergens': 'Contacts & allergens',
    'orders.productsCount': { one: '{n} product', other: '{n} products' },
    'orders.whatTheySell': 'What they sell',
    'orders.deliveryShort': 'delivery',
    'orders.orderShort': 'order',
    // ⚠️ A WORD, NEVER A COLOUR ALONE. «Nobody has looked» and «checked, contains
    // none of the 14» are the same empty list; only the stamp separates them.
    'orders.notDeclaredShort': 'not declared',
    'orders.registry.loadFailed': 'Could not load the suppliers. Check your connection and try again.',
    'orders.registry.whichList': 'Which list to show',
    // ⚠️ The NUMBER keeps its decimal point in both languages: these boxes are
    // <input type="number">, which refuses a comma. Only «e.g.» is translated.
    'orders.eg.packWeight': 'e.g. 2.27kg',
    'orders.eg.ratePerKg': 'e.g. 7.20 (one kilo)',
    'orders.exVatNote': 'Prices are net of VAT.',
    'orders.eg.ratePerLitre': 'e.g. 6.00 (one litre)',
    'orders.eg.ratePerPiece': 'e.g. 0.035 (one piece)',
    'orders.eg.pieceWeight': 'e.g. 0.055',
    'orders.ingredientsCount': { one: '{n} ingredient', other: '{n} ingredients' },

    // The record forms. ⚠️ These labels were literals passed as an ARGUMENT —
    // `field('Name', input)` — which is the one shape tests/no-hardcoded-english
    // could not see, so the whole ingredient form stayed English on an Italian
    // phone while four i18n suites passed. The scan now knows that shape.
    'orders.field.name': 'Name',
    'orders.field.category': 'Category',
    'orders.field.email': 'Email',
    'orders.field.supplier': 'Supplier',
    'orders.field.brand': 'Brand',
    'orders.field.weight': 'Weight',
    'ui.activate': 'Activate',
    'orders.deactivateConfirm': 'Deactivate “{name}”? It will be hidden from the order screen. You can reactivate it later.',
    'orders.deleteConfirm': 'Permanently delete “{name}”? This cannot be undone.',
    // One sentence per verb, not one sentence with a verb dropped into it: the
    // grammar around it differs between the two languages.
    'orders.failed.save': 'Could not save “{name}”. Check your network and try again.',
    'orders.failed.delete': 'Could not delete “{name}”. Check your network and try again.',
    'orders.failed.deactivate': 'Could not deactivate “{name}”. Check your network and try again.',
    'orders.failed.activate': 'Could not reactivate “{name}”. Check your network and try again.',
    'orders.failed.load': 'Could not load the price history for “{name}”. Check your network and try again.',
    'orders.pricePerKg': 'Price per kg ({currency})',
    'orders.pricePerLitre': 'Price per litre ({currency})',
    'orders.pricePerPiece': 'Price per piece ({currency})',
    'orders.priceGeneric': 'Price ({currency})',
    // The two "start again" dialogs. Surfaced by widening the scan to `message:` —
    // okLabel and cancelLabel were already covered, so these two asked their question
    // in English and offered their answers in Italian.
    'orders.nSuppliers': { one: '{n} supplier', other: '{n} suppliers' },
    'orders.clearConfirm': 'Clear everything typed for {who}?\n\nThe stock readings stay. Orders already recorded in History are not touched.',
    'orders.discardTitle': 'Discard {name}’s order',
    'orders.discardConfirm': 'Delete the quantities typed for {name}? They are not saved anywhere and cannot be recovered.',

    // ── An order list one person sends to another ────────────────────────────
    'orders.request.someone': 'Someone',
    'orders.request.sendToManager': 'Send to the manager',
    'orders.request.sending': 'Sending…',
    'orders.request.sent': 'List sent ✓',
    'orders.request.sendFailed': 'The list was NOT sent — it is still here. Check the connection and try again.',
    'orders.request.title': 'Order lists',
    'orders.request.open': 'Order lists',
    'orders.deliveries.tab': 'Incoming',
    'orders.deliveries.owed': { one: '1 order from before this week — did it arrive?',
                                other: '{n} orders from before this week — did they arrive?' },
    'orders.weekStart.title': 'The working week',
    'orders.weekStart.hint': 'Which day the week starts on. It decides what “this week” means on Incoming.',
    // ── How an order leaves the app ─────────────────────────────────────────
    'orders.send.howTitle': 'How should this order go?',
    'orders.send.route.manager': 'To whoever runs the place, in the app',
    'orders.send.route.whatsapp': 'WhatsApp — I choose the chat',
    'orders.send.route.whatsappSupplier': 'WhatsApp straight to the supplier',
    'orders.send.route.email': 'Email to the supplier',
    'orders.send.onePerSupplier': { one: 'one message', other: 'one message each — {n} chats' },
    'orders.send.noContact': { one: 'no contact saved for {names}',
                               other: 'no contact saved for {names}' },
    'orders.send.noRouteAvailable': 'There is no way to send this order. Ask whoever runs the place to switch one on in Settings.',
    'orders.send.emailSubject': 'Order from {name}',
    // Settings
    'orders.send.settingsTitle': 'How orders may be sent',
    'orders.send.settingsHint': 'What the people working here can use. You always keep all four.',
    'orders.send.preferred': 'Offered first',
    'orders.send.mustKeepOne': 'At least one way of sending has to stay on, or an order could never leave the app.',
    'orders.send.emailOpensApp': 'Email opens your mail app with the order ready — it does not send it by itself.',
    // ── The delivery half of an order's life ────────────────────────────────
    'orders.deliveries.late': 'Late',
    'orders.deliveries.dueToday': 'Due today',
    'orders.deliveries.coming': 'Coming',
    'orders.deliveries.noneYet': 'No orders placed yet.',
    'orders.deliveries.allArrived': 'Everything ordered has arrived.',
    'orders.deliveries.unknownSupplier': 'Deleted supplier',
    'orders.deliveries.expectedOn': 'Expected {day}',
    'orders.deliveries.noExpectedDay': 'No delivery days set for this supplier',
    // ⚠️ A PLURAL ENTRY. Written as one string it printed "1 items" on the very
    // first screenshot — measuring never sees this, looking does.
    'orders.deliveries.orderedOn': { one: 'Ordered {day} · {n} item',
                                     other: 'Ordered {day} · {n} items' },
    'orders.deliveries.arrivedTitle': 'Has it arrived from {supplier}?',
    'orders.deliveries.arrivedMessage': 'The order placed on {day}.',
    'orders.deliveries.allArrivedBtn': 'Everything arrived',
    'orders.deliveries.somethingMissing': 'Something is missing',
    'orders.deliveries.whatArrived': 'What arrived?',
    'orders.deliveries.untickHint': 'Untick anything that did NOT arrive.',
    'orders.deliveries.saveArrival': 'Save',
    'orders.deliveries.couldNotSave': 'Not saved. Check the connection and try again.',
    'orders.reorder.count': { one: '1 ingredient never arrived — still to re-order',
                              other: '{n} ingredients never arrived — still to re-order' },
    'orders.reorder.title': 'Still to re-order',
    'orders.reorder.message': 'These were ordered and never arrived:',
    'orders.reorder.putBack': 'Put back in the order',
    'orders.reorder.someSkipped': { one: '1 row already had a quantity and was left alone.',
                                    other: '{n} rows already had a quantity and were left alone.' },
    'orders.request.waiting': {
      one: '{n} order list to place',
      other: '{n} order lists to place',
    },
    'orders.request.from': 'From {who}',
    'orders.request.progress': '{done} of {total}',
    'orders.request.allOrdered': 'All ordered',
    'orders.request.none': 'Nobody has sent an order list yet.',
    // ⚠️ IT SENT SOMEBODY LOOKING FOR A BUTTON THAT HAS NOT EXISTED SINCE v1.55.0. The
    // header carries a send ARROW offering four roads; the WhatsApp button it names was
    // replaced the day the arrow was chosen, and this sentence was not.
    'orders.request.noneHint': 'Type an order, tap the Send arrow at the top, then “Send to the manager”.',
    'orders.request.noneWaiting': 'Every list sent has been ordered.',
    'orders.request.noneInWindow': {
      one: 'No lists in the last day',
      other: 'No lists in the last {n} days',
    },
    'orders.request.showOlder': {
      one: 'Show older lists ({n})',
      other: 'Show older lists ({n})',
    },
    'orders.request.nowInList': 'now in the list: {n}',
    'orders.request.changedSince': 'These amounts have changed in the shared order since this list was sent.',
    'orders.request.finish': 'Finish',
    'orders.request.finishTitle': 'Finish this list?',
    'orders.request.finishMessage': {
      one: 'One line has not been ticked. Finishing ticks it too.',
      other: '{n} lines have not been ticked. Finishing ticks them too.',
    },
    // ⚠️ AN INSTRUCTION, NOT A STATEMENT. 'Order placed — X' under a supplier
    // whose lines are all ticked reads as a receipt saying it already happened.
    'orders.request.markPlacedFor': 'Mark as placed — {supplier}',
    'orders.request.oneTitle': 'Order list',
    'orders.request.noteLabel': 'Note',
    'orders.request.delete': 'Delete this list',
    'orders.request.deleteTitle': 'Delete this list?',
    'orders.request.deleteMessage': 'It disappears for everybody. Anything already ordered stays in History.',
    'orders.request.deleteFailed': 'Not deleted — the list is still here.',
    'orders.request.tickFailed': 'The tick was NOT saved — check the connection.',
    'orders.request.sentToManagers': 'Everybody who runs this place will be told.',

    // ── Catalogue, Food Cost, Pastries, Calculator ─────────────────────
    'cat.everyRecipeCanBe': 'Every recipe can be labelled.',
    'cat.linkTheseRowsFirst': 'Link these rows first',
    'cat.aRecipeRowHas': 'A recipe row has to point at an ingredient before anything can be known about it. Link them from the recipe’s own screen — the pencil, then the row.',
    'cat.thenDeclareThese': 'Then declare these',
    'cat.declareTheseFirst': 'Declare these first',
    'cat.eachOneIsHolding': 'Each one is holding up this many recipes. Fill them in from Orders → Ingredients.',
    'cat.noRecipesYet': 'No recipes yet.',
    'cat.noneOfThe14': 'None of the 14',
    'cat.nothingInItYet': 'Nothing in it yet',
    'cat.noName': '(no name)',
    'cat.fromTheSuppliersSpecifications': 'From the suppliers’ specifications. It does not cover what your own kitchen may add — shared benches, shared equipment, flour in the air.',
    'cat.noCostYetLink': 'No cost yet — link the ingredients to price this recipe.',
    'cat.fromTheSuppliersSpecifications2': 'From the suppliers’ specifications. It does not cover what your own kitchen may add.',
    'cat.makeALabel': 'Make a label',
    'cat.writeTheMixingSteps': 'Write the mixing steps',
    'cat.aStepAtA': 'A step at a time, with the amounts from this recipe, a timer and the mixer speed.',
    'cat.startAgainFromThe': 'Start again from the beginning',
    'cat.guidedMixing': 'Guided mixing',
    'cat.viewRecipeFullScreen': 'View recipe full screen',
    'cat.exitFullScreen': 'Exit full screen',
    'cat.totalDoughWeightIn': 'Total dough weight in grams',
    'cat.clearBackToBase': 'Clear — back to base recipe',
    'cat.thatIsAVery': 'That is a very large batch',
    'cat.calculateRecipe': 'Calculate recipe?',
    'cat.totalDoughWeight': 'Total dough weight',
    'cat.importIntoCalculator': 'Import into Calculator',
    'cat.deleteRecipe': 'Delete recipe',
    'cat.makesACopyYou': 'Makes a copy you can tweak just for the Calculator — the catalogue recipe stays untouched.',
    'cat.calculate': 'Calculate',
    'cat.recipe': 'Recipe',
    'cat.cost': 'Cost',
    'cat.costOver': 'over {yield}',
    'cat.costOverLoss': 'over {yield} finished ({pct}% lost from {from})',
    'cat.editTheSteps': 'Edit the steps',
    'cat.nSteps': { one: '{n} step', other: '{n} steps' },
    'cat.ofTimers': '{time} of timers',
    'cat.notInAnyStep': 'Not in any step: {list}',
    'cat.notInAnyStepYet': 'Not in any step yet: {list}',
    'cat.stepN': 'Step {n}',
    'cat.timer': 'Timer',
    'cat.allergens': 'Allergens',
    'cat.label': 'Label',
    'cat.nothingToImport': 'This recipe has no weight-based ingredients, so there’s nothing to import.',
    'cat.searchAnIngredient': 'Search an ingredient…',
    'cat.sheet.declaredCount': '{n} of {total} recipes fully declared',
    // ⚠️ A PLURAL ENTRY. This line was built by hand in allergen-sheet.js —
    // English grammar written into the code, which no translation could reach —
    // and it printed under an Italian screen for as long as the sheet existed.
    'cat.sheet.blockedCount': {
      one: '{n} cannot be labelled yet.',
      other: '{n} cannot be labelled yet.',
    },
    // ⚠️ THE ROW PILLS ARE THEIR OWN KEYS AND MUST STAY SO. cat.alg.declared /
    // cat.alg.notDeclared read "dichiarati" / "non dichiarati" in Italian, which is
    // correct where they sit — on the recipe card, describing the ALLERGENS. Here
    // the subject is the RECIPE, so Italian needs "dichiarata" / "non dichiarata".
    // Reusing the other pair would print the wrong gender and number on every row.
    'cat.sheet.rowDeclared': 'fully declared',
    'cat.sheet.rowNotDeclared': 'not declared',
    'cat.sheet.theLawHere': 'What the law requires here',
    'cat.sheet.theSpecificOnes': 'The cereals and nuts the law makes you name one by one',
    'cat.sheet.namesFollowCountry':
      'These are the words the law uses {country}. They stay in that language whatever language the app is set to.',
    'cat.sheet.noCountry':
      'Nobody has said which country this business sells in, so the app cannot say which allergens the law requires here. The owner sets it when the business is created.',
    'cat.andMore': '…and {n} more',
    'cat.nRows': { one: '{n} row', other: '{n} rows' },
    'cat.nRecipes': { one: '{n} recipe', other: '{n} recipes' },
    'cat.moveStepUp': 'Move step {n} up',
    'cat.moveStepDown': 'Move step {n} down',
    'cat.total': 'Total',
    'cat.ingredient': 'Ingredient',
    'cat.ingredients': 'Ingredients',
    // The headings on the recipe screen's cards. ⚠️ They name a part of the SCREEN, not
    // a food, so they follow the interface language like every other instruction.
    'cat.section.batch': 'Batch weight',
    'cat.section.procedure': 'Procedure',
    // ⚠️ THE CARD'S TITLE AND ITS BUTTONS ARE INTERFACE TEXT — they tell somebody what
    // to tap. The DECLARATION inside it is not: every food word there comes from
    // js/market.js in the language of the venue's COUNTRY, because that is the law.
    'cat.decl.title': 'Ingredient declaration',
    'cat.decl.blocked': 'Not ready yet — some ingredients are still to be declared. The allergen card above says which.',
    'cat.decl.caveat': 'A draft for you to check. The app knows what it was told: it cannot know about a last-minute substitution or a supplier who changed their recipe.',
    // ⚠️ ONE WORD, not label.copy's «Copy the text». Three buttons share a row on a
    // phone and the longer phrase wrapped to two lines while the other two did not —
    // seen in a screenshot, the same kind of fix as v1.71.0's «Come si fa».
    'cat.decl.copy': 'Copy',
    'cat.amount': 'Amount',
    'cat.unit': 'Unit',
    'cat.removeIngredient': 'Remove ingredient',
    'cat.addIngredient': '+ Add ingredient',
    'cat.notWeighed': {
      one: '{n} ingredient is not weighed (pieces / to taste) — not in the total',
      other: '{n} ingredients are not weighed (pieces / to taste) — not in the total',
    },
    'cat.recipeName': 'Recipe name',
    'cat.ingredientName': 'Ingredient name',
    'cat.linkToAnIngredient': '+ Link to an ingredient',
    'cat.aRecipeThatNo': '→ a recipe that no longer exists',
    'cat.anIngredientThatNo': '→ an ingredient that no longer exists',
    'cat.pleaseEnterARecipe': 'Please enter a recipe name.',
    'cat.enterAnAmountFor': 'Enter an amount for at least one ingredient.',
    'cat.addAtLeastOne': 'Add at least one ingredient with a name.',
    'cat.saveRecipe': 'Save recipe?',
    'cat.saveTheseChanges': 'Save these changes?',
    'cat.recipeSaved': 'Recipe saved.',
    'cat.recipeAdded': 'Recipe added.',
    'cat.discardChanges': 'Discard changes?',
    'cat.youHaveUnsavedChanges': 'You have unsaved changes. Discard them?',
    // ⚠️ THE FIELD STOPPED ASKING FOR A PERCENTAGE. cat.weightLostWhileCooking,
    // …WhileCooking2 and cat.leaveAt0If were retired with it: a percentage is a number
    // nobody has — it has to be worked out from two weighings — which is why the box
    // sat at 0 on every recipe and made every baked product look cheaper than it is.
    'cat.rawDoughWeight': 'Raw dough',
    'cat.cookedDoughWeight': 'Cooked dough',
    'cat.lossIs': 'Weight lost in the oven: {pct}%',
    'cat.lossNotYet': 'Weight lost in the oven: weigh the baked dough to work it out',
    // ⚠️ ONLY EVER SHOWN FOR A PERCENTAGE ABOVE ZERO. A stored 0 means nobody has said,
    // and gets cat.lossNotYet above — see storedLossText() in catalogue-editor.js.
    'cat.lossStored': 'Weight lost in the oven: {pct}% — weigh the dough to work it out again',
    'cat.lossCookedHeavier': 'The cooked dough cannot weigh more than the raw dough.',
    'cat.lossCapped': 'Stored as {max}% — a full loss would make the cost per kilo infinite.',
    'cat.searchARecipe': 'Search a recipe…',
    'cat.searchARecipeBy': 'Search a recipe by name',
    'cat.noRecipeMatchesYour': 'No recipe matches your search.',
    'cat.noRecipesYetTap': 'No recipes yet. Tap + to add one.',
    // ── Reading a recipe from a photograph ─────────────────────────────────
    // ⚠️ Every sentence here is chosen so that a REFUSAL never reads as a
    // connection problem. Only cat.photo.err.offline mentions the connection, and
    // only because in that one case there genuinely is not one.
    'cat.photo.entry': 'Read a recipe from a photo',
    'cat.photo.fill': 'Fill this in from a photo',
    'cat.photo.replaceTitle': 'Start from a photo?',
    'cat.photo.replaceBody': 'What you have typed here will be replaced by what the photo says.',
    'cat.photo.replaceOk': 'Use a photo',
    'cat.photo.setting': 'Read recipes from a photo',
    'cat.photo.settingNote': 'When it is on, a new recipe can be filled in from a photograph. Each photo costs a few pence of the reading service.',
    'cat.photo.on': 'On',
    'cat.photo.off': 'Off',
    'cat.photo.turnOnTitle': 'Switch this on?',
    'cat.photo.turnOnBody': 'The app will read a photographed recipe for you. Each photo costs a few pence of the reading service — about 200 recipes for a couple of pounds. You can switch it off again whenever you like.',
    'cat.photo.turnOn': 'Switch on',
    'cat.photo.turnOffTitle': 'Switch this off?',
    'cat.photo.turnOffBody': 'Nobody in this venue will be able to read a recipe from a photo. Recipes already saved are untouched.',
    'cat.photo.turnOff': 'Switch off',
    'cat.photo.nowOn': 'Reading from a photo is on.',
    'cat.photo.nowOff': 'Reading from a photo is off.',
    'cat.photo.err.photoOff': 'Reading from a photo is switched off for this venue.',
    'cat.photo.title': 'Recipe from a photo',
    'cat.photo.lead': 'Photograph the recipe and the app will fill it in for you. You check it and save it yourself — nothing is saved until you do.',
    'cat.photo.take': 'Take a photo',
    'cat.photo.addAnother': 'Add another photo',
    'cat.photo.remove': 'Remove this photo',
    'cat.photo.thumbAlt': 'The photo you took',
    'cat.photo.read': 'Read the recipe',
    'cat.photo.reading': 'Reading…',
    'cat.photo.working': 'Reading the recipe… this takes a few seconds.',
    'cat.photo.note': 'Check every amount before you save. A photo can be read wrongly, and a wrong number looks just like a right one.',
    'cat.photo.capped': 'That is a very long list — only the first 300 lines were kept.',
    'cat.photo.err.offline': 'No connection. The photo has not been sent — try again when you are back online.',
    'cat.photo.err.notAllowed': 'You cannot add recipes in this venue.',
    'cat.photo.err.signedOut': 'Sign in again and try once more.',
    'cat.photo.err.personLimit': 'You have read a lot of photos today. Try again later, or type this one in by hand.',
    'cat.photo.err.venueLimit': 'This venue has read a lot of photos today. Try again later, or type this one in by hand.',
    'cat.photo.err.noImages': 'Take a photo first.',
    'cat.photo.err.tooMany': 'Up to 5 photos at a time.',
    'cat.photo.err.tooLarge': 'Those photos are too big. Take them again a little closer.',
    'cat.photo.err.badImage': 'That photo could not be prepared. Take it again.',
    'cat.photo.err.badFormat': 'The app cannot read that photo’s format. Take it with the camera instead of picking it from your library.',
    'cat.photo.err.nothingFound': 'No recipe was found in these photos. Try a straighter, closer shot with the whole list of ingredients in frame.',
    'cat.photo.err.refused': 'The reader would not read this photo. If it really is a recipe, take the photo again.',
    'cat.photo.err.tooLong': 'That list is too long to read in one go. Photograph it in two parts.',
    'cat.photo.err.tooSlow': 'Reading took too long and was stopped. Try again with fewer photos.',
    'cat.photo.err.failed': 'The photo could not be read. Try again.',
    // ── The allergen card on a recipe ──────────────────────────────────────
    // ⚠️ These were plain English literals in catalogue-detail.js and in the frozen
    // ALLERGEN_REASON_TEXT, so the card printed in English on a fully Italian screen.
    'cat.alg.title': 'Allergens',
    'cat.alg.notDeclared': 'not declared',
    'cat.alg.declared': 'fully declared',
    // ⚠️ A PLURAL ENTRY, because the code used to decide "ingredient is" vs
    // "ingredients are" itself — grammar no translation could reach.
    'cat.alg.notDeclaredCount': {
      one: '{n} ingredient is not declared — no label can be made',
      other: '{n} ingredients are not declared — no label can be made',
    },
    'cat.alg.andMore': { one: '…and {n} more', other: '…and {n} more' },
    'cat.alg.soFar': 'So far, from the rows that are declared: {list}. This is NOT the full list.',
    'cat.alg.mayContain': 'May contain: {list}',
    'cat.alg.reason.notLinked': 'not linked to an ingredient',
    'cat.alg.reason.missingIngredient': 'linked to an ingredient that no longer exists',
    'cat.alg.reason.notDeclared': 'the linked ingredient has no allergen information yet',
    'cat.alg.reason.missingRecipe': 'linked to a recipe that no longer exists',
    'cat.alg.reason.subIncomplete': 'the linked recipe is not fully declared',
    'cat.alg.reason.cycle': 'this recipe contains itself',
    'cat.alg.reason.tooDeep': 'nested too many recipes deep',
    'cat.allergenSheet': 'Allergen sheet',
    'cat.recipeCatalogue': 'Recipe catalogue',
    'cat.editRecipe': 'Edit recipe',
    'cat.newRecipe': 'New recipe',
    'cat.mixingSteps': 'Mixing steps',
    'cat.carryOnMixing': 'Carry on mixing?',
    'cat.carryOn': 'Carry on',
    'cat.notNow': 'Not now',
    'cat.thatMixIsNo': 'That mix is no longer available — start it again.',
    'cat.itWasImportedInto': ' It was imported into the Calculator — that copy will stay; remove it separately in the Calculator if you want it gone.',
    'cat.deleteRecipe2': 'Delete recipe?',
    'cat.recipeDeleted': 'Recipe deleted.',
    'cat.importIntoCalculator2': 'Import into Calculator?',
    'cat.importFailedCheckYour': 'Import failed — check your connection and try again.',
    'cat.liveSyncInterruptedRecipes': 'Live sync interrupted — recipes may be out of date.',
    'cat.batchWarning': 'That is {weight} of dough. Check the amount before calculating.',
    'cat.batchWarningVsRecipe': 'That is {weight} of dough — {times}× the recipe as written ({base}). Check the amount before calculating.',
    'cat.couldnTDeleteThe': 'Couldn’t delete the recipe — check your connection.',
    'cat.addTheFirstStep': 'Add the first step. Each one can carry ingredients, a timer, and a mixer speed.',
    'cat.everyIngredientIsIn': 'Every ingredient is in a step.',
    'cat.whoeverFollowsThisWill': 'Whoever follows this will not be told to add them. It is fine if that is on purpose.',
    'cat.whatToDoE': 'What to do — e.g. Add the flour and the water',
    'cat.ingredientsToAdd': 'Ingredients to add',
    'cat.mixerSpeed': 'Mixer speed',
    'cat.removeThisStep': 'Remove this step?',
    'cat.noStepsYet': 'No steps yet',
    'cat.eGFinalDough': 'e.g. Final dough temperature 24-26 degrees',
    'cat.closingMessageShownWhen': 'Closing message, shown when the dough is finished',
    'cat.whenTheDoughIs': 'When the dough is finished',
    'cat.shownOnItsOwn': 'Shown on its own at the end of the mix. Leave it empty for no message.',
    'cat.saveTheProcedure': 'Save the procedure?',
    'cat.procedureSaved': 'Procedure saved.',
    'cat.theStepsYouHave': 'The steps you have written have not been saved.',
    'cat.addStep': '+ Add step',
    'cat.noLongerInThe': 'No longer in the recipe',
    'cat.timeIsUpJust': 'Time is up — just now.',
    // ⚠️ ADDED 23 Aug 2026 — the Catalogue's last English, and six of these were
    // plurals built by hand out of a ternary, which is English's rule written into
    // the code. Intl chooses the form now, in whatever language the phrase came from.
    'cat.progress': 'Step {i} of {n}',
    // ⚠️ TWO FORMS, NOT ONE FORM AND .toLowerCase(). Three call sites lower-cased the
    // sentence above to drop it into the middle of another one. That is reshaping a
    // translated word — it happens to work for Italian and is the kind of thing that
    // silently stops working for the next language. Same reasoning, and the same
    // answer, as orders.per100G beside its lower-case twin in js/market.js.
    'cat.progress.inline': 'step {i} of {n}',
    'cat.resumeGuidedMix': 'Resume the guided mix — {progress}',
    'cat.calculateFor': 'Calculate {recipe} for {amount}?',
    'cat.copyIntoCalculator': 'Copy “{name}” into the Calculator? You can then tweak it there without changing the catalogue.',
    'cat.partWayThrough': 'You were part-way through “{name}” — {progress}.',
    'cat.deleteRecipeQ': 'Delete “{name}”? This cannot be undone.',
    'cat.thisRecipe': 'this recipe',
    'cat.recipeWord': 'recipe',
    'cat.nonScalableNote': {
      one: 'Note: {list} uses a unit the Calculator can’t scale (it works in grams only) and won’t be imported.',
      other: 'Note: {list} use a unit the Calculator can’t scale (it works in grams only) and won’t be imported.',
    },
    'cat.updatedInCalculator': '“{name}” updated in the Calculator.',
    'cat.addedToCalculator': '“{name}” added to the Calculator.',
    'cat.couldNotSaveRecipe': 'Couldn’t save “{name}” — check your connection.',
    'cat.stepWillBeRemoved': 'Step {n} will be removed from the procedure.',
    'cat.procedureCanHold': 'A procedure can hold {n} steps.',
    'cat.stepsAndTimers': {
      one: '{n} step · {duration} of timers',
      other: '{n} steps · {duration} of timers',
    },
    'cat.saveStepsFor': {
      one: 'Save {n} step for “{name}”?',
      other: 'Save {n} steps for “{name}”?',
    },
    'cat.noProcedureFor': '“{name}” will have no guided procedure.',
    'cat.timeWasUpMinutes': {
      one: 'Time was up 1 minute ago.',
      other: 'Time was up {n} minutes ago.',
    },
    'cat.timeWasUpHours': {
      one: 'Time was up over an hour ago.',
      other: 'Time was up over {n} hours ago.',
    },
    'cat.youAreOn': 'You are on {progress}. It will be waiting where you left it.',
    'cat.notPricedYet': {
      one: '{n} ingredient is not priced yet — this cost is partial',
      other: '{n} ingredients are not priced yet — this cost is partial',
    },
    'cat.timeIsUp': 'Time is up.',
    'cat.startTheTimer': 'Start the timer',
    'cat.skipTheTimer': 'Skip the timer',
    'cat.running': 'Running…',
    'cat.1Min': '+1 min',
    'cat.doneEarly': 'Done early',
    'cat.doneFinish': 'Done — finish',
    'cat.doughFinished': 'Dough finished',
    'cat.notInAnyStep': 'Not in any step — check these went in:',
    'cat.backToTheRecipe': 'Back to the recipe',
    'cat.itWillAlsoSend': 'It will also send a notification if you leave the app.',
    'cat.alsoTellMeIf': 'Also tell me if I leave the app',
    'cat.otherwiseKeepThisScreen': 'Otherwise keep this screen open — the alarm cannot ring from a closed app.',
    'cat.keepThisScreenOpen': 'Keep this screen open — the alarm cannot ring if you leave the app.',
    'cat.keepThisScreenOpen2': 'Keep this screen open and awake — the alarm cannot ring if you leave the app.',
    'cat.leaveTheGuidedMix': 'Leave the guided mix?',
    'cat.searchAnIngredient': 'Search an ingredient',
    'cat.noPriceYet': 'No price yet',
    'cat.nothingMatchesYourSearch': 'Nothing matches your search.',
    'cat.noIngredientsYetAdd': 'No ingredients yet — add them in Orders, under Settings.',
    'cat.linkTo': 'Link to',
    'cat.removeTheLink': 'Remove the link',
    'cat.nothingInThisRecipe': 'Nothing in this recipe is declared yet',
    'cat.unknownIngredient': 'Unknown ingredient',
    'cat.notWeighedPiecesSpoons': 'not weighed (pieces / spoons / to taste)',
    'cat.partOfThisRecipe': 'Part of this recipe is not priced yet',
    'fc.onTarget': 'On target',
    'fc.slightlyOverTarget': 'Slightly over target',
    'fc.overTarget': 'Over target',
    'fc.notCostedYet': 'Not costed yet',
    'fc.foodCost': 'Food cost',
    'fc.partOfThisProduct': 'Part of this product is not priced yet, so the real food cost is higher than this.',
    'fc.productName': 'Product name',
    'fc.chooseARecipe': '— Choose a recipe —',
    'fc.chooseAnItem': '— Choose an item —',
    'fc.removeRecipe': 'Remove recipe',
    'fc.removePackagingItem': 'Remove packaging item',
    'fc.thisRecipeNoLonger': 'This recipe no longer exists',
    'fc.thisRecipeIsNot': 'This recipe is not priced yet',
    'fc.thisItemNoLonger': 'This item no longer exists',
    'fc.pricedByWeightSet': 'Priced by weight — set it up as a per-piece price in Orders to count it here',
    'fc.choose': '— Choose —',
    'fc.byThePiece': 'By the piece',
    'fc.byWeightPerKg': 'By weight (per kg)',
    'fc.howManyPiecesCome': 'How many pieces come out of one batch',
    'fc.piecesPerBatch': 'Pieces per batch',
    'fc.howManyFinishedPieces': 'How many finished pieces one batch of the recipes above makes.',
    'fc.sellingPriceIncludingVat': 'Selling price including VAT',
    'fc.name': 'Name',
    'fc.packaging': 'Packaging',
    'fc.sold': 'Sold',
    'fc.sellingPriceVat': 'Selling price, including VAT ({currency})',
    'fc.anotherRate': 'Another rate…',
    'fc.anotherVatRateAs': 'Another VAT rate, as a percentage',
    'fc.foodCostTargetAs': 'Food cost target, as a percentage',
    'fc.pleaseEnterAProduct': 'Please enter a product name.',
    'fc.saveProduct': 'Save product?',
    'fc.saveTheseChanges': 'Save these changes?',
    'fc.productSaved': 'Product saved.',
    'fc.productAdded': 'Product added.',
    'fc.deleteProduct': 'Delete product?',
    'fc.productDeleted': 'Product deleted.',
    'fc.discardChanges': 'Discard changes?',
    'fc.youHaveUnsavedChanges': 'You have unsaved changes. Discard them?',
    'fc.marginHistory': 'Margin history',
    'fc.madeOf': 'Made of',
    'fc.addRecipe': '+ Add recipe',
    'fc.addPackaging': '+ Add packaging',
    'fc.boxesBagsRibbonAnything': 'Boxes, bags, ribbon — anything bought by the piece. It adds cost but no weight.',
    'fc.howItIsSold': 'How it is sold',
    'fc.thePriceOnThe': 'The price on the label. The app takes the VAT off before working out the food cost.',
    'fc.vatRate': 'VAT rate',
    'fc.foodCostTarget': 'Food cost target (%)',
    'fc.theShareOfThe': 'The share of the net price you want the ingredients to be. Leave empty for no target.',
    'fc.deleteProduct2': 'Delete product',
    'fc.slightlyOver': 'Slightly over',
    'fc.addProduct': '+ Add product',
    'fc.noProductsYetAdd': 'No products yet. Add one to see what it costs and what it earns.',
    'fc.noTargetSet': 'No target set',
    'fc.untitledProduct': 'Untitled product',
    'fc.productsAndMargins': 'Products and margins',
    'fc.newProduct': 'New product',
    'fc.loading': 'Loading…',
    'fc.couldNotLoadThe': 'Could not load the history — check your connection and try again.',
    'fc.nothingRecordedYetA': 'Nothing recorded yet. A point is added whenever the price or the recipe changes.',
    'fc.aPointIsRecorded': 'A point is recorded when the price or the recipe changes — not when ingredient prices drift, so a flat line here does not mean the margin held.',
    'fc.liveSyncInterruptedProducts': 'Live sync interrupted — products may be out of date.',
    'fc.addAtLeastOne': 'Add at least one recipe to this product',
    'fc.chooseWhetherThisIs': 'Choose whether this is sold by the piece or by weight',
    'fc.sayHowManyPieces': 'Say how many pieces come out of one batch',
    'fc.chooseTheVatRate': 'Choose the VAT rate',
    'fc.enterTheSellingPrice': 'Enter the selling price',
    'fc.theRecipesInThis': 'The recipes in this product are not priced yet',
    'fc.theRecipesInThis2': 'The recipes in this product have no weight yet',
    'fc.couldnTDeleteThe': 'Couldn’t delete the product — check your connection.',
    'past.tapThePencilTo': 'Tap the pencil to add.',
    'past.thatRowHasChanged': 'That row has changed — check the list.',
    'past.thatNameIsToo': 'That name is too long.',
    'past.thatIsMorePastries': 'That is more pastries than one day can hold.',
    'past.thatCannotBeSaved': 'That cannot be saved yet.',
    'past.pastryName': 'Pastry name',
    'past.removeThisPastry': 'Remove this pastry?',
    'past.discardChanges': 'Discard changes?',
    'past.addPastry': 'Add pastry',
    'past.anythingWorthRememberingAbout': 'Anything worth remembering about this day…',
    'past.couldnTRemoveThat': 'Couldn’t remove that record — check your connection.',
    'past.nothingWasProved': 'Nothing was proved.',
    'past.removeThisRecord': 'Remove this record?',
    'past.recordRemoved': 'Record removed.',
    'past.noRecordsYet': 'No records yet.',
    'past.tapConfirmAtThe': 'Tap Confirm at the bottom of a day to keep one.',
    'past.tomorrowToProve': 'Tomorrow · to prove',
    'past.toProve': 'To prove',
    'past.liveSyncInterruptedThese': 'Live sync interrupted — these records may be out of date.',
    'past.liveSyncInterruptedThis': 'Live sync interrupted — this list may be out of date.',
    'calc.fieldsClearedThisIs': 'Fields cleared — this is a new day.',
    'calc.resetAllFields': 'Reset all fields?',
    'calc.numberOfCrates': 'Number of crates',
    'calc.copied': 'Copied ✓',
    'calc.copyRecipe': 'Copy recipe',
    'calc.fromOrders': 'From orders',
    'calc.fromATotal': 'From a total',
    'calc.bothOrdersTotal': 'Both (orders + total)',
    'calc.discardThisNewRecipe': 'Discard this new recipe? You have not added anything to it.',
    'calc.pleaseGiveEveryRecipe': 'Please give every recipe a name and at least one named ingredient before saving.',
    'calc.saveTheseChanges': 'Save these changes?',
    'calc.couldNotSaveCheck': 'Could not save. Check your connection and try again.',
    'calc.yourRecipesTheBase': 'Your recipes — the base of the calculator. Tap one to edit it, or add a new one. Up to ',
    'calc.canShowAsCalculator': ' can show as calculator tabs.',
    'calc.shown': '  ·  shown',
    'calc.hidden': '  ·  hidden',
    'calc.unnamedRecipe': 'Unnamed recipe',
    'calc.deleteRecipe': 'Delete recipe',
    'calc.addRecipe': '+ Add recipe',
    'calc.thisRecipeIsUsed': 'This recipe is used by ',
    'calc.deleteThe': 'Delete the ',
    'calc.recipe': ' recipe?',
    'calc.editRecipe': 'Edit recipe',
    'calc.recipeName': 'Recipe name',
    'calc.calcLogic': 'Calc logic',
    'calc.howItCalculates': 'How it calculates',
    'calc.addIngredient': '+ Add ingredient',
    'calc.showTheAdjustKnob': 'Show the adjust knob in the tab',
    'calc.recipesCanShowAs': ' recipes can show as tabs at once. Hide another first.',
    'calc.showAsACalculator': 'Show as a calculator tab (max ',
    'calc.removeIngredient': 'Remove ingredient',
    'calc.thisIsTheLeavening': 'This is the leavening (yeast/starter)',
    'calc.editTheseQuantitiesThe': 'Edit these quantities? The recipe updates only after you save it again.',
    'calc.noLogsToShow': 'No logs to show right now — check the Log settings (visibility and duration).',
    'calc.noLogsYetCalculate': 'No logs yet. Calculate and confirm a dough to save it here.',
    'calc.addLog': '+ Add log',
    'calc.edited': ' (edited)',
    'calc.versionHistory': 'Version history',
    'calc.deleteLog': 'Delete log',
    'calc.editThisLog': 'Edit this log?',
    'calc.deleteThis': 'Delete this ',
    'calc.logThisCannotBe': ' log? This cannot be undone.',
    'calc.empty': '(empty)',
    'calc.occasionalClient': 'Occasional client',
    'calc.occasional': '  ·  occasional',
    'calc.extraDough': 'Extra dough: ',
    'calc.noProductsEntered': 'No products entered.',
    'calc.totalDough': 'Total dough',
    'calc.calculatedBy': 'Calculated by: ',
    'calc.nameOptional': 'Name (optional)',
    'calc.calculatedBy2': 'Calculated by',
    'calc.productsQuantitiesOnly': 'Products — quantities only',
    'calc.noProductsInThis': 'No products in this category.',
    'calc.saveChanges': 'Save changes',
    'calc.saveTheseChangesAs': 'Save these changes as a new version?',
    'calc.restoredFromV': 'Restored from v',
    'calc.logNotFound': 'Log not found.',
    'calc.editHistory': ' — edit history',
    'calc.current': ' · current',
    'calc.allVersions': ' All versions',
    'calc.restoreThisVersion': 'Restore this version',
    'calc.restoreThisVersionIt': 'Restore this version? It is added on top as the new current version — the history is kept.',
    'calc.noRecipesYetAdd': 'No recipes yet. Add one in Settings → Recipes.',
    'calc.pickARecipeTo': 'Pick a recipe to enter quantities.',
    'calc.whenIsThisDough': 'When is this dough for?',
    'calc.totalDoughG': 'Total dough (g)',
    'calc.noProductsForThis': 'No products for this recipe.',
    'calc.saveLog': 'Save log',
    'calc.saveThisLog': 'Save this log?',
    'calc.forEachRecipeChoose': 'For each recipe: choose whether its logs appear in the Log list and how long they stay. ',
    'calc.logsAreAlwaysKept': 'Logs are always kept in the database — this only controls the in-app list.',
    'calc.noProducts': 'No products',
    'calc.keepLogsVisible': 'Keep logs visible',
    'calc.keepVisibleFor': 'Keep visible for',
    'calc.logDurationFor': 'Log duration for ',
    'calc.saveTheseLogSettings': 'Save these log settings?',
    'calc.setEveryQuantityIn': 'Set every quantity in this order back to 0?',
    'calc.clearAll': 'Clear all',
    'calc.noWhatsappListsOr': 'No WhatsApp lists or clients yet. Add one in Settings → WhatsApp.',
    'calc.thisListHasNo': 'This list has no clients yet. Add some in Settings → WhatsApp.',
    'calc.sendOrder': 'Send order',
    // ⚠️ ADDED 23 Aug 2026 — the client-ordering screens, written straight into the
    // code. Four of them built an English plural by hand, which is English's rule
    // written into a ternary and cannot be translated by moving either half.
    'calc.co.ordersChanged': {
      one: '{n} order has CHANGED since you used it',
      other: '{n} orders have CHANGED since you used them',
    },
    'calc.co.ordersReceived': {
      one: '{n} order received from your clients',
      other: '{n} orders received from your clients',
    },
    'calc.co.justNow': 'just now',
    'calc.co.minAgo': '{n} min ago',
    'calc.co.hoursAgo': { one: '{n} hour ago', other: '{n} hours ago' },
    'calc.co.showOlder': 'Show older orders (before the last {n} days)',
    'calc.co.arrivedLate': 'This arrived after {cutoff}, the deadline for that day. You can still use it — but it came in late.',
    'calc.co.clientGone': '{client} is no longer in your address book, so there are no fields to fill in.',
    'calc.co.thisClient': 'This client',
    'calc.co.allLocked': {
      one: '{names} has already been confirmed, so the quantities are locked. Tap Edit on the tab first, then put the order in.',
      other: '{names} have already been confirmed, so the quantities are locked. Tap Edit on the tab first, then put the order in.',
    },
    'calc.co.someLocked': {
      one: '{names} is confirmed and will be left alone.',
      other: '{names} are confirmed and will be left alone.',
    },
    'calc.co.putOrderIn': 'Put {client}’s order in the calculator?',
    'calc.co.closeOrdersAt': 'Close orders at {time} the day before? Every client sees this straight away.',
    'calc.prefill.window.both': 'yesterday or today',
    'calc.prefill.window.today': 'today',
    'calc.prefill.window.yesterday': 'yesterday',
    'calc.prefill.nothingLogged': 'Nothing logged for these clients {when} — type the quantities.',
    'calc.prefill.filled': {
      one: 'One quantity filled in from what you logged {when} — check it before sending.',
      other: '{n} quantities filled in from what you logged {when} — check them before sending.',
    },
    'calc.shareText': 'Hello {client}, you can send your order to {from} here: {link}',
    'calc.us': 'us',
    'calc.linkCopiedFor': 'The ordering link for {client} is copied. Paste it into a message.',
    'calc.copyThisLinkFor': 'Copy this link and send it to {client}:\n\n{link}',
    'calc.clientCanSendOrders': '{client} can send orders straight into the app. Anyone with the link can order as this client, so send it to them and no one else.',
    'calc.replaceLinkWarning': '{client}’s current link will stop working immediately, including on a phone that is using it right now. Use “Copy link” instead if you only want to send it again.',
    'calc.stopClientOrdering': 'Stop {client} sending orders through the app? Their link will stop working. Orders they have already sent are kept.',
    'calc.alreadyInMessage': '“{name}” is already in this message.',
    'calc.untitledList': 'Untitled list',
    'calc.unnamedClient': 'Unnamed client',
    'calc.noOrdersToShare': 'No orders to share',
    'calc.sendTo': 'Send to',
    'calc.allClientsTogether': 'All clients together',
    'calc.orOneClient': 'Or one client',
    'calc.extraDough2': 'Extra dough',
    'calc.extraDoughUnit': 'Extra dough unit',
    'calc.resetAllFields2': 'Reset all fields',
    'calc.loading': 'Loading…',
    'calc.fetchingTheRecipesSaved': 'Fetching the recipes saved for this venue.',
    'calc.noRecipesYet': 'No recipes yet',
    'calc.addARecipe': 'Add a recipe',
    'calc.noRecipeIsShown': 'No recipe is shown here',
    'calc.chooseWhichToShow': 'Choose which to show',
    'calc.discardThisNewClient': 'Discard this new client? You have not added anything to it.',
    'calc.pleaseGiveEveryClient': 'Please give every client and every product a name before saving.',
    'calc.addClient': '+ Add client',
    'calc.editClient': 'Edit client',
    'calc.clientName': 'Client name',
    'calc.deleteClient': 'Delete client',
    'calc.deleteThisClientAnd': 'Delete this client and its products?',
    'calc.productsOrdered': 'Products ordered',
    'calc.addProduct': '+ Add product',
    'calc.orderingLink': 'Ordering link',
    'calc.saveYourChangesFirst': 'Save your changes first — the link shows this client the products as they are saved.',
    'calc.createALinkAnd': 'Create a link and send it to this client. They will see only their own products, and can order without a password.',
    'calc.thisClientCannotOrder': 'This client cannot order through the app yet. The owner or a manager can set that up.',
    'calc.copyLink': 'Copy link',
    'calc.replaceWithANew': 'Replace with a new link',
    'calc.createOrderingLink': '+ Create ordering link',
    'calc.replaceThisLink': 'Replace this link?',
    'calc.couldNotCreateThe': 'Could not create the link. Check your connection and try again.',
    'calc.turnOffOrdering': 'Turn off ordering',
    'calc.turnOff': 'Turn off',
    'calc.couldNotTurnIt': 'Could not turn it off. Check your connection and try again.',
    'calc.productName': 'Product name',
    'calc.weightInGrams': 'Weight in grams',
    'calc.quantityType': 'Quantity type',
    'calc.crateBox': 'Crate box',
    'calc.piecesPerCrate': 'Pieces per crate',
    'calc.removeProduct': 'Remove product',
    'calc.pickWhichProductsEach': 'Pick which products each recipe’s divisor box splits into crates. Nothing is split until you tick it. Tap Save to apply.',
    'calc.noProductsInThis3': 'No products in this tab yet.',
    'calc.untickAll': 'Untick all',
    'calc.discardUnsavedChanges': 'Discard unsaved changes?',
    'calc.pleaseNameThisClient': 'Please name this client before saving.',
    'calc.pleaseNameThisList': 'Please name this list before saving.',
    'calc.whatsappLists': 'WhatsApp lists',
    'calc.deleteList': 'Delete list',
    'calc.addList': '+ Add list',
    'calc.fillTheOrderFrom': 'Fill the order from',
    'calc.deleteThisList': 'Delete this list?',
    'calc.deleteThisClient': 'Delete this client?',
    'calc.editList': 'Edit list',
    'calc.listName': 'List name',
    'calc.clientsInThisList': 'Clients in this list',
    'calc.addAClientThen': 'Add a client, then add the products to send for it.',
    'calc.unknownClient': 'Unknown client',
    'calc.nothingToSendYet': 'Nothing to send yet — tap to add',
    'calc.removeClientFromList': 'Remove client from list',
    'calc.removeThisClientFrom': 'Remove this client from the list?',
    'calc.addClient2': 'Add client',
    'calc.noClientsYetAdd': 'No clients yet. Add them in Settings → Clients first.',
    'calc.allClientsAreAlready': 'All clients are already in this list.',
    'calc.pickAClientTo': 'Pick a client to add. Next you add the products to send for it.',
    'calc.productsToSend': 'Products to send',
    'calc.noProductsYetAdd': 'No products yet. Add products from the address book.',
    'calc.addedByHand': 'Added by hand',
    'calc.eGLoavesOf': 'e.g. Loaves of bread',
    'calc.extraLine': 'Extra line ',
    'calc.removeLine': 'Remove line',
    'calc.addToTheMessage': 'Add to the message',
    'calc.itsProducts': 'Its products',
    'calc.otherProducts': 'Other products',
    'calc.everythingInTheAddress': 'Everything in the address book is already added.',
    'calc.noProductsInThe': 'No products in the address book yet.',
    'calc.addALineBy': 'Add a line by hand',
    'calc.addThisLine': 'Add this line',
    'calc.notInTheAddress': 'Not in the address book?',
    'calc.youHaveUnsavedChanges': 'You have unsaved changes. Leave without saving? Your changes will be lost.',
    'calc.stillComing': 'Still coming',
    'calc.couldNotLoadThe': 'Could not load the past orders. Check your connection and try again.',
    'calc.wentIntoTheCalculator': 'Went into the calculator',
    'calc.neverPutIntoThe': 'Never put into the calculator',
    'calc.theClientSentThis': 'The client sent this day empty — they asked for nothing.',
    'calc.note': 'Note: ',
    'calc.thisClientChangedTheir': 'This client changed their order AFTER you put it in the calculator. The numbers below are the new ones.',
    'calc.nothingThisDayThe': 'Nothing this day — the client sent an empty order.',
    'calc.aLineAboveIs': 'A line above is for a product this client no longer has, so it cannot go into the calculator. Add it back, or handle it yourself.',
    'calc.putTheNewOrder': 'Put the NEW order in',
    'calc.putInTheCalculator': 'Put in the calculator again',
    'calc.putInTheCalculator2': 'Put in the calculator',
    'calc.noneOfThisClient': 'None of this client’s products are on a calculator tab at the moment, so there is nothing to fill in.',
    'calc.theseAlreadyHaveA': 'These already have a different number typed in:',
    'calc.thisWillReplaceWhat': 'This will replace what is typed',
    'calc.putItIn': 'Put it in',
    'calc.ordersCloseAt': 'Orders close at',
    'calc.thatIsNotA': 'That is not a time. Use the clock, or leave it empty for no deadline.',
    'calc.removeTheDeadlineClients': 'Remove the deadline? Clients will be able to order for any day, including today.',
    'calc.notSavedCheckYour': 'Not saved. Check your connection and try again.',


    // ⚠️ WHOLE SENTENCES, PUT BACK TOGETHER. The automatic pass gave each half of
    // these its own entry, because the source had already split them across two
    // string literals. That is the one thing this programme forbids: Italian
    // orders the words differently, so no arrangement of two fixed halves can be
    // right in both languages, and a translator handed «Up to » cannot see the
    // sentence at all.
    'calc.savedLocallyOnly': 'Saved on this phone only. The app could not reach the settings stored online, so it has not sent the change — this protects the clients and recipes already saved there. Check your connection and reload the page.',
    'calc.savedNotSent': 'Saved on this phone, but not sent to the other phones yet — check your connection.',
    'calc.empty.noRecipes.sub': 'The Calculator works out how much dough to make from what your clients have ordered. Add your first recipe — its ingredients and their amounts — and it becomes a tab up here.',
    'calc.empty.noneShown.sub': 'You have recipes, but none of them is set to appear as a tab. Choose which ones to show, up to four.',
    'calc.empty.noProducts.sub': 'No products in this tab yet. Add your clients, and the products they buy, in Settings.',
    'calc.noClientsYet': 'No clients yet. A client is somebody you bake for: add one, then list the products they order and how much each weighs.',
    'calc.prefillWindow.help': 'Which days of saved logs the order form offers quantities from. Most days an order is made over two days — some products the day before, some the same morning — so “Yesterday and today” is the usual choice.',
    'calc.byHand.help': 'For things this client buys that you do not calculate here — bread cut from another client’s batch, for example. They appear in the message and never in a dough total, and the order form always leaves them empty for you to fill in.',
    'calc.otherProducts.help': 'Products of other clients. Adding one here only puts it in this message — it does not change the address book.',
    'calc.typeItHere.help': 'Type it here. It goes in the message only — never into a dough calculation — and the order form leaves it empty for you to fill in.',
    'calc.clientOrders.empty': 'Nothing for today or the days ahead. Orders a client has already been delivered are under History.',
    'calc.clientOrders.notRecorded': 'The numbers are in the calculator, but the app could not record that you used this order. It will keep showing as new, and it will NOT warn you if the client changes it. Check your connection.',
    'calc.cutoff.help': 'An order for a day can be sent, and changed, until this time on the day before. Clients see this time on their own screen.',
    'calc.cutoff.empty': 'Leave it empty for no deadline. With a deadline, clients can order for tomorrow onwards but never for the current day, because its deadline has already passed.',


    // ── The seven weekdays ─────────────────────────────────────────────────
    // ⚠️⚠️ THE WORD ONLY. `Monday`…`Sunday` are Firestore document ids
    // (pastries/Monday) and are in DATA_WORDS — translating one makes that whole
    // proving list unreachable. These are what a SCREEN says, looked up BY the id.
    // ⚠️ The short form is its own entry, never the first three letters of the
    // long one: Italian abbreviates «mercoledì» as «mer», not «mer» by accident,
    // and slicing a translated word is the reshaping this project forbids.
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

    'past.confirm': 'Confirm',
    'past.records': 'Records',
    'past.thisRow': 'this row',
    // ⚠️ ADDED 23 Aug 2026. Six of these named a WEEKDAY straight out of the data —
    // `Edit ${day}?` — which is the document id, not a word for a person. Every one
    // goes through weekdayLabel() now, exactly as the rest of this screen already did.
    'past.newQuantityFor': 'New quantity for {name}',
    'past.confirmNewQuantityFor': 'Confirm the new quantity for {name}',
    'past.hint.typeANumber': 'type a number',
    'past.hint.sameAsNow': 'same as now',
    'past.hint.atLeastOne': 'must be at least 1',
    'past.hint.tooMany': 'too many',
    'past.onListTwice': '{name} is on this list twice.',
    'past.howMany': 'How many {name}?',
    'past.mostItCanHold': '{n} is the most this can hold.',
    'past.pastryPlaceholder': 'Pastry',
    'past.couldNotRecord': 'Couldn’t record {day} — check your connection.',
    'past.removeRecordFor': 'Remove the record for {day}, {date}',
    'past.removeRecordForQ': 'Remove the record for {day}, {date}? This cannot be undone.',
    'past.editDayQ': 'Edit {day}?',
    'past.alreadyRecordedTonight': '{day} is already recorded for tonight. Edit these quantities?',
    'past.keepAsRecord': 'Keep this list as a record for {day}?',
    'past.nothingToProveRecord': '{day} has nothing to prove. Record that?',
    'past.tonightsRecordReplaced': 'Tonight’s record for {day} will be replaced.',
    'past.willShowAsDone': '{day} will show as done. You can still change it — it will ask first.',
    'past.couldNotSaveDay': 'Couldn’t save {day} — check your connection.',
    'fc.perKg': 'per kg',
    'fc.perPiece': 'per piece',
    'fc.answerBasis': '{cost} to make {unit}  ·  {net} net  ·  {margin} margin',
    'fc.deleteProductQ': 'Delete “{name}”? This cannot be undone, and its margin history goes with it.',
    'fc.thisProduct': 'this product',
    'fc.productWord': 'product',
    'fc.histDetail': '{cost} cost  ·  {price} at {vat}% VAT',
    'fc.couldNotSaveProduct': 'Couldn’t save “{name}” — check your connection.',
    'nc.sellsIn': 'Sells in: {where}.',
    'nc.linkWorksOnce': 'The link works once and has {expiry}.',
    'nc.sectionsLine': 'Sections: {list}.',
    'nc.readyAndYours': '{name} is ready, and it is yours.',
    'nc.ready': '{name} is ready.',
    'nc.openMyBusinesses': 'Open my businesses',
    'nc.linkCopiedFor': 'The link for {name} is copied. Paste it into a message to them.',
    'nc.copyThisLinkFor': 'Copy this link and send it to {name}:\n\n{link}',
    'co.cutoffNote': 'Orders for a day close at {time} the day before. You can change your order until then.',
    'co.cutoffClosed': 'Orders for a day close at {time} the day before. Please try again later.',
    'help.noOrdersInLastDays': 'No orders in the last {n} days. Older ones are still kept — nothing is ever deleted.',
    'help.passwordTooShort': 'Make it at least {n} characters — length is what keeps it safe.',
    'aria.whatIs': 'What is {screen}?',
    'past.nothingToProveFor': 'Nothing to prove for {day} yet.',
    'past.removeRowFrom': 'Remove {name} from {day}?',
    'past.saveDay': 'Save {day}?',
    'past.saveThese': { one: 'Save this pastry for {day}?', other: 'Save these {n} pastries for {day}?' },
    'past.saveEmpty': '{day} will have nothing to prove. Save that?',
    'past.daySaved': '{day} saved.',
    'past.unsavedFor': 'You have unsaved changes to {day}. Discard them?',
    'past.noteFor': 'Note for {day}',
    'past.toProveFor': 'To prove for {day}',
    'past.noteStays': 'Note — stays on {day} until you change it',
    'past.confirmDay': 'Confirm {day}?',


    // ── Words written straight into the HTML (js/i18n-dom.js) ─────────────
    'ui.home': "Home",
    // Generic words a screen needs whatever feature it belongs to. They live in
    // `ui.` rather than in a feature namespace because four features already want
    // them, and a fifth copy is a fifth thing to translate.
    'ui.back': 'Back',
    // ⚠️ ONE WORD FOR ONE ACTION. The app had TWO — `ui.send` said «Manda» in Italian
    // and `orders.send.button` said «Invia», for the same button on different screens.
    // «Manda» is the one that stays: it is what the app says in twelve other places
    // («Manda l'ordine», «Manda al manager», «Manda su WhatsApp»), and «Invia» was the
    // single outlier. orders.send.button is retired rather than left as a second name.
    'ui.send': 'Send',
    // ── "How do you want to send it?" — the sheet behind every send arrow ──────
    // ⚠️ `send.` AND NOT `orders.send.`: this is asked from the Catalogue, the
    // Calculator and «Who can get in» too, and a key named after the one feature that
    // happened to need it first is the next reader's trap.
    // ⚠️ SIX KEYS RETIRED ON 24 Aug 2026, and every one of them named WhatsApp or
    // a button that no longer exists: cat.decl.whatsapp / .email / .mailNote,
    // help.sendOnWhatsapp, calc.sendOnWhatsapp, calc.shareViaWhatsapp. The screens
    // they belonged to now carry ONE send arrow and ask which road behind it, so a
    // key that names a destination is a key that would put the old promise back.
    'send.how': 'How do you want to send it?',
    'send.whatsapp': 'WhatsApp — I choose the chat',
    'send.email': 'Email',
    'send.emailOpensApp': 'It opens your mail app with the text ready — it does not send it.',
    // ⚠️ THE JOINER IS A WORD TOO. `names.join(' and ')` and listNames() both wrote
    // English grammar into the code, in three places.
    'ui.listPair': '{a} and {b}',
    'aria.recipe': 'Recipe',
    'ui.cancel': 'Cancel',
    'ui.delete': 'Delete',
    // ⚠️ THE BUTTON WORDS THE DIALOGS USE. They were written straight into 30-odd
    // `okLabel:` props — a shape no i18n test in this project looked at — so on an
    // Italian phone the dialog asked its question in Italian and offered its answer
    // in English. Found by opening the screen in Italian, exactly as
    // tests/no-hardcoded-english.test.mjs predicted a third shape would be.
    'ui.discard': 'Discard',
    'ui.edit': 'Edit',
    'ui.clear': 'Clear',
    'ui.reset': 'Reset',
    'ui.restore': 'Restore',
    'ui.replace': 'Replace',
    'ui.deactivate': 'Deactivate',
    'ui.import': 'Import',
    'ui.calculate': 'Calculate',
    'ui.leave': 'Leave',
    // Their own keys rather than reusing people.remove / nc.create: those belong to
    // one screen each, and a later reword there would silently change a dialog
    // somewhere else.
    'ui.remove': 'Remove',
    'ui.create': 'Create',
    'ui.whatsNew': 'What’s new',
    // ⚠️ SAID ONCE, TO SOMEBODY WHO HAS JUST BEEN LET IN, AND TO NOBODY ELSE. It
    // opens with «You are in» on purpose: they have finished the thing they were
    // sent to do, and this is an offer, not another step. The three reasons are the
    // three they can actually feel — full screen, one tap, and it still works when
    // the signal does not.
    'install.hint.title': 'Add the app to your phone',
    'install.hint.body': 'You are in — but the app is running inside your browser. Add it to your home screen and it opens like any other app: full screen, one tap, and it keeps working when the signal does not.',
    'install.hint.ok': 'Show me how',
    'install.hint.later': 'Not now',

    'install.stale.title': 'Re-install this app',
    // ⚠️ SAYS WHAT TO DO, NOT WHAT IS WRONG. «Your manifest is out of date» means nothing
    // to a baker; the three steps do. And it says outright that nothing is lost, because
    // the word "uninstall" next to an app somebody depends on is alarming on its own.
    'install.stale.body': 'This app was added to your home screen a while ago, and part of how it behaves is fixed at that moment — an update cannot change it.\n\nTo bring it up to date:\n1. Hold the app’s icon and choose Uninstall\n2. Open the address in your browser again\n3. Menu ⋮ → Install app\n\nNothing is lost: your work is saved online, not inside the app. And if the install will not go through, carry on using it from the browser — it works just the same.',
    // ⚠️ `Confirm` IS THE BUTTON THE BAKERY PRESSES EVERY DAY — the one that turns a
    // set of client quantities into a dough. It sat in English on an Italian phone,
    // and no test saw it because it is el()'s third argument, not a `text:` prop.
    'ui.confirm': 'Confirm',
    'ui.active': 'Active',
    'ui.paused': 'Paused',
    'ui.lists': 'Lists',
    'ui.recipe': 'Recipe',
    'ui.note': 'Note',
    'ui.ingredients': 'Ingredients',
    // ⚠️ This one was not even a key — PRICE_UNIT_LABELS carried the bare words
    // 'by the piece' beside two t() calls, so two thirds of the same list translated
    // and the third did not.
    'price.byPiece': 'by piece',
    // ⚠️ Eight of these nine sat in COST_REASON_TEXT as bare English beside ONE t()
    // call — the same list, one line translated and eight not. Each names one thing
    // to go and do, so they read as the end of «this row could not be costed: …».
    'cat.cost.noAmount': 'no amount',
    'cat.cost.notLinked': 'not linked to an ingredient',
    'cat.cost.missingIngredient': 'linked to an ingredient that no longer exists',
    'cat.cost.missingRecipe': 'linked to a recipe that no longer exists',
    'cat.cost.noPrice': 'the linked ingredient has no price yet',
    'cat.cost.subNotCostable': 'the linked recipe has no cost yet',
    'cat.cost.cycle': 'this recipe contains itself',
    'cat.cost.tooDeep': 'nested too many recipes deep',
    // Read at the mixer, at a glance: the word and the number are one label.
    'cat.guided.speedN': 'Speed {n}',
    // The allergen status line on an ingredient. Whole sentences: what follows
    // «Checked» is a date in one language and a phrase in another.
    'orders.allergen.notCheckedYet': 'Not checked yet — this ingredient blocks any label it is used in. {note}',
    'orders.allergen.checkedOn': 'Checked {date} — {what}. {note}',
    'orders.allergen.checkedNoDate': 'Checked — {what}. {note}',
    'orders.allergen.containsNone': 'contains none of the 14',
    // ⚠️ THE TWO COLUMNS AND THEIR TOOLTIPS ARE INTERFACE TEXT, AND {name} IS NOT.
    // The allergen's NAME comes from js/market.js in the venue's country's language,
    // because it has to match the printed label; these four words only tell the person
    // what they are ticking, so they follow the screen. Both halves meet inside one
    // string on purpose: an Italian employee in an English bakery reads «Contiene
    // Wheat», and that is right — the instruction is hers, the food word is the label's.
    // ⚠️ All four were hardcoded English until 23 Aug 2026, on a screen that has spoken
    // Italian since v1.57.0. No i18n suite saw them: they were string literals.
    'orders.allergen.has': 'has',
    'orders.allergen.traces': 'traces',
    'orders.allergen.containsTip': 'Contains {name}',
    'orders.allergen.tracesTip': 'May contain traces of {name}',
    // ⚠️ THE THREE NUTRITION STATES ARE CHIPS NOW, NOT SENTENCES. They used to be
    // tacked onto the end of the ALLERGEN status line («Checked 2026-08-21 — Milk.
    // Nutrition: 3 of 13 still empty.»); nutrition has its own folding section since
    // v1.67.0, so they sit on its header and have to be short enough to.
    'orders.nutritionStillEmpty': '{n} of {total} empty',
    'past.olderRecordsKept': {
      one: 'Older records are kept — this screen shows the last day.',
      other: 'Older records are kept — this screen shows the last {n} days.',
    },
    'ui.doughScaling': "Dough scaling",
    'ui.recipesKgScaling': "Recipes & kg scaling",
    // ⚠️ RENAMED FROM ui.suppliersWeeklyOrder, key and all: the records LEFT Orders in
    // v1.65.0, so a subtitle still advertising «Suppliers» sent people to the wrong
    // card — and sat directly above a card whose title now starts with that word.
    'ui.thisWeeksOrder': "This week’s order",
    'ui.toProveForTomorrow': "To prove for tomorrow",
    'ui.productsMargins': "Products & margins",
    'ui.doughScalingFromOrders': "Dough scaling from orders",
    'ui.recipes': "Recipes",
    'ui.settings': "Settings",
    'ui.clients': "Clients",
    'ui.clientsAndTheProducts': "Clients and the products each one orders",
    'ui.addEditOrDelete': "Add, edit or delete recipes; pick which show as tabs",
    'ui.whatsapp': "WhatsApp",
    'ui.buildOrderListsPick': "Build order lists: pick clients and the products to send",
    'ui.showOrHideThe': "Show or hide the extra-dough box in each recipe",
    'ui.clientOrdering': "Client ordering",
    'ui.whenOrdersSentFrom': "When orders sent from a client’s own link close",
    'ui.divisor': "Divisor",
    'ui.chooseWhichProductsThe': "Choose which products the divisor box splits, per recipe",
    'ui.log': "Log",
    'ui.chooseWhichRecipesLogs': "Choose which recipes’ logs to show, and how long they stay",
    'ui.showTheExtraDough': "Show the “Extra dough” box in each recipe tab. Tap Save to apply your changes.",
    'ui.save': "Save",
    'ui.ordersReceived': "Orders received",
    'ui.marketOrder': "Market order",
    'ui.chooseAList': "Choose a list",
    'ui.saveThisDoughFor': "Save this dough for:",
    'ui.today': "Today",
    'ui.tomorrow': "Tomorrow",
    'ui.editLog': "Edit log",
    'ui.addLog': "Add log",
    'ui.editHistory': "Edit history",
    'ui.supplierOrders': "Supplier orders",
    'ui.order': "Order",
    // Field labels on every order row, and two headings. Their own keys on purpose:
    // the «Order» TAB names a screen, this names a box above a number.
    'orders.field.order': 'Order',
    'orders.tab.suppliers': 'Suppliers',
    'orders.tab.ingredients': 'Ingredients',
    'orders.tab.general': 'General',
    'orders.days': 'days',
    // The two filter buttons above every list, and the two hints under a quantity box.
    // ⚠️ THE COUNT IS INSIDE THE PHRASE, not glued on after it: a language is free to
    // put it somewhere else, or to need a different word around it.
    'orders.filter.all': 'All ({n})',
    'orders.filter.ordering': 'Ordering ({n})',
    'orders.suggestedN': 'Suggested: {n}',
    'orders.muchMoreThanUsual': 'Much more than usual (about {n})',
    // ⚠️ WHOLE SENTENCES, not fragments. The day and the date sit inside them because
    // Italian needs «il» before a weekday and English needs «on» — a rule that cannot
    // live in code that glues pieces together.
    // ⚠️⚠️ THE SENTENCE NAMES NO COUNTRY, and that is Federico's decision of 24 Aug
    // 2026, not a shortening. It used to say "UK bank holiday" — which was the
    // defect showing through the words on an Italian venue — and the fix is not to
    // say "Italian holiday" instead: the person reading it is standing in the
    // country in question and does not need telling which one it is. Which days
    // appear is decided by the venue's country in js/orders/holidays.js; the
    // sentence only says one is coming. ⚠️ The key was renamed with the words: a key
    // still called bankHoliday would be the next person's reason to put Britain back.
    'orders.alert.holidayTomorrow': 'Public holiday tomorrow ({date}). Plan your orders ahead.',
    'orders.alert.holidayInDays': {
      one: 'Public holiday in {n} day ({date}). Plan your orders ahead.',
      other: 'Public holiday in {n} days ({date}). Plan your orders ahead.',
    },
    'orders.alert.deliveryClash': 'Heads up: {supplier} delivers on {day}, but {date} is a public holiday — check the delivery.',
    'orders.mute.orderRequests': 'Do not buzz this phone about order lists',
    'orders.mute.stillShown': 'The list still appears in the app — this only silences the alert.',
    'orders.field.stock': 'Stock',
    'orders.section.alerts': 'Alerts',
    'orders.section.price': 'Price',
    'orders.section.orderScreen': 'The order screen',
    'orders.section.howSent': 'How orders may be sent',
    // ── An ingredient's record, in four sections ────────────────────────────
    'orders.section.productData': 'Product details',
    'orders.section.allergens': 'Allergens',
    'orders.section.packList': 'Ingredient list',
    'orders.pack.filledIn': 'filled in',
    'orders.pack.toFillIn': 'to fill in',
    // ⚠️⚠️ IT SAYS THE VERIFICATION IS GONE, BECAUSE IT IS. The app changed {n} box on
    // an ingredient somebody had signed off, so the old date no longer describes what
    // is ticked — the tick that says «I checked this» is cleared and must be given
    // again. An earlier wording said only «verify it again» while the code quietly
    // kept the stamp: a warning the code does not enforce is worse than none here.
    'orders.pack.proposedAfterCheck': {
      one: 'The verification has lapsed: the app changed {n} box from the ingredient list. Check the allergens and tick «I have checked…» again.',
      other: 'The verification has lapsed: the app changed {n} boxes from the ingredient list. Check the allergens and tick «I have checked…» again.',
    },
    // The same lapse, once the app has withdrawn its own ticks again — there is no
    // number left to name, and the verification stays gone until somebody confirms.
    'orders.pack.checkVoided': 'The verification has lapsed: the app changed the boxes from the ingredient list. Check the allergens and tick «I have checked…» again.',
    'orders.pack.proposedTicks': {
      one: 'The app has ticked {n} box from the ingredient list. Open Allergens and check it.',
      other: 'The app has ticked {n} boxes from the ingredient list. Open Allergens and check them.',
    },
    'orders.section.nutrition': 'Nutrition',
    // ── …and the two switches that decide whether the last two exist ────────
    'orders.settings.ingredientCard': 'The ingredient card',
    'orders.settings.cardNote': 'What every product’s record asks for. It applies to the whole venue, not just this phone, and takes effect on the next screen you open.',
    'orders.settings.showAllergens': 'Track allergens',
    'orders.settings.showAllergensNote': 'Off: no allergen boxes on a product, no allergen card on a recipe, no allergen sheet — and no labels, because a food label without its allergen line is worse than none. Nothing already declared is deleted.',
    'orders.settings.showNutrition': 'Track nutrition',
    'orders.settings.showNutritionNote': 'The per-100 g figures on a product, and the nutrition half of a label. Nothing already typed is deleted.',
    // ⚠️ THE ONLY SWITCH ON THIS PAGE THAT SPENDS MONEY, and the note has to say so
    // before it is thrown, not afterwards on an invoice.
    'orders.settings.packPhoto': 'Read a packet from a photo',
    'orders.settings.packPhotoNote': 'Photograph the ingredient list on a packet and have it typed out for you. Each photo costs a few pence of the reading service. Off unless you switch it on.',
    'orders.settings.packPhotoOnTitle': 'Switch photo reading on?',
    'orders.settings.packPhotoOnBody': 'The app will read a photographed packet for you. Each photo costs a few pence of the reading service — about 200 packets for a couple of pounds. You can switch it off again whenever you like.',
    'orders.settings.packPhotoTurnOn': 'Switch it on',
    'orders.settings.offTitle': 'Turn allergens off?',
    'orders.settings.offBody': 'The allergen boxes, the allergen card on every recipe, the allergen sheet and the labels all disappear for everybody in this venue. Nothing is deleted — switching it back on brings every declaration back exactly as it is.',
    'orders.settings.turnOff': 'Turn off',
    'ui.history': "History",
    // ⚠️ ui.allIngredients («All ingredients») was retired here: both view switches now
    // reuse the plain ui.ingredients that already existed. Federico, on the screen:
    // «tutti gli ingredienti chiamalo semplicemente ingredienti».
    'ui.orderPlaced': "Order placed…",
    'ui.clearQuantities': "Clear quantities…",
    'ui.youReOfflineReconnect': "You’re offline — reconnect to load and save orders.",


    // ── Help, release notes, sign-up rules, updates, notifications ────────
    'help.eachCardOpensOne': 'Each card opens one part of the day: what to bake, what to buy, what it costs.',
    'help.yourWorkIsSaved': 'Your work is saved as you go — on this phone and online, so another phone sees it too.',
    'help.everyScreenHasA': 'Every screen has a ? like this one. It explains that screen in a few lines.',
    'help.aNumberOnA': 'A number on a card means something there is waiting for you.',
    'help.typeHowManyPieces': 'Type how many pieces each client has asked for. The app works out the total dough and every ingredient.',
    'help.confirmSavesTheSheet': 'Confirm saves the sheet to the Log and locks the fields until you tap Edit.',
    'help.theFieldsEmptyThemselves': 'The fields empty themselves on a new work day — which starts at 4am, not at midnight.',
    'help.ordersReceived': 'Orders received',
    'help.ordersYourClientsTyped': 'Orders your clients typed themselves, from their own link.',
    'help.putInTheCalculator': '“Put in the calculator” fills that client’s quantity boxes for you. Nothing moves until you tap it.',
    'help.ifAClientChanges': 'If a client changes an order AFTER you have used it, this screen turns red and says so.',
    'help.ordersForDaysAlready': 'Orders for days already gone are not shown here — this screen is what is still coming.',
    'help.recipeCatalogue': 'Recipe catalogue',
    'help.everyRecipeYouHave': 'Every recipe you have, searchable. Open one and scale it to any total weight in kg.',
    'help.guidedMixingWalksA': 'Guided mixing walks a recipe step by step with timers — keep that screen open, or the alarm cannot ring.',
    'help.linkARowTo': 'Link a row to an ingredient and the recipe can tell you what a kilo of it costs.',
    'help.ifOnlySomeRows': 'If only some rows are linked, the cost shown is of THOSE rows — not of the whole recipe.',
    'help.whatToBuySupplier': 'What to buy, supplier by supplier. Order is how many you need; Stock is what you still have.',
    'help.orderPlacedRecordsIt': '“Order placed” records it and clears the row, so the screen always shows what is left to do.',
    'help.suggestedAmountsComeFrom': 'Suggested amounts come from your last 8 orders of that item, so they mean nothing until you have placed a few.',
    'help.suppliersEverythingYouBuy': 'Everything you buy and who you buy it from. Tap a supplier for its details and every product it sells; tap a product to open its record.',
    'help.suppliersAllergensLiveHere': 'Allergens belong to the PRODUCT, not to the recipe — so declaring milk on your butter answers for every recipe that uses that butter.',
    'help.suppliersPasteThePack': 'Paste the ingredient list printed on the pack and the app ticks the allergen boxes for you. It only ever suggests: the product stays undeclared until you tick “I have checked this” yourself.',
    'help.suppliersTurnThemOff': 'Settings, at the bottom, decides whether this venue uses allergens and nutrition at all. Turning allergens off hides them everywhere — the recipes and the labels too — and deletes nothing.',
    // The three sections of one ingredient's record. What is true of the FEATURE is
    // explained here; what is true of THIS product stays on the screen.
    'help.packWhenItCannotTell': 'When the pack does not say which one — «nuts», «cereals», «lecithin» — nothing is ticked and the screen says so under the box. Ask the supplier which.',
    'help.allergensNameTheSpecific': 'Name the specific cereal and the specific nut: the law wants «wheat», not «cereals», and «hazelnut» is no use to somebody who can eat almonds.',
    'help.allergensUntilYouTick': 'Until «I have checked the supplier spec» is ticked and saved, this ingredient blocks every label it is used in. That is the safety rule working, not a fault.',
    'help.nutritionComesFromThePack': 'The seven values per 100 g, copied from the table printed on the pack.',
    'help.nutritionZeroIsAnAnswer': '0 is a real value and an empty box is not: leave it empty when the pack does not say, rather than typing a zero.',
    'help.nutritionItIsWhatThe': 'It is what the supplier declared, not a calculation — so a label can be checked against the pack it came from.',
    'help.foodCost': 'Food cost',
    'help.whatAProductCosts': 'What a product costs to make, and what it earns.',
    'help.typeTheSellingPrice': 'Type the selling price as it is on the label, WITH VAT. The app works the cost out on the price without VAT.',
    'help.itIsOnlyRight': 'It is only right if the ingredients have prices. An unpriced one is left out, and the answer comes out too low.',
    'help.whatToPutOut': 'What to put out to prove, as one standing list per weekday.',
    'help.confirmKeepsARecord': 'Confirm keeps a record of the night and locks the list until 4am.',
    'help.unlikeTheCalculatorA': 'Unlike the Calculator, a new day does NOT empty it: the list is what you normally do on that weekday.',
    // ⚠️ A ONE-OFF ANNOUNCEMENT, NOT A FEATURE. Every app installed before 22 Aug 2026
    // carries a wrapper built from an older manifest, and js/install-version.js CANNOT
    // see that: there is no API anywhere that exposes the manifest an installed app was
    // built from (measured, not assumed — getInstalledRelatedApps returns related NATIVE
    // apps, never the web app itself). It can only compare against what it recorded
    // itself, so it is blind to every install that predates it. A release note is the
    // only channel that reaches those devices.
    'help.reinstallOnce': 'If you use Misé from your home screen, delete it and add it again once — part of an installed app is fixed when you add it, and no update can reach it.',
    'help.reinstallNothingLost': 'Nothing is lost: your work is saved online, not inside the app.',
    'help.reinstallFromNowOn': 'If the install will not go through, carry on from the browser — it works just the same. From now on the app tells you by itself whenever this is needed.',
    'help.acceptIsNowCalled': 'Accept is now called Confirm — the same word the Calculator uses for the same thing.',
    'help.aConfirmedListShows': 'A confirmed list shows as done, and its numbers stop opening, so nothing changes by accident.',
    'help.toChangeItAnyway': 'To change it anyway, tap Edit or any row and it asks first. Every list reopens on its own at 4am.',
    'help.tapAPastryTo': 'Tap a pastry to change its number: type the new one and tap the green tick.',
    'help.theNoteAtThe': 'The note at the bottom of a day stays there until you change it — writing it is under the pencil.',
    'help.tapAcceptWhenA': 'Tap Accept when a list is done. It is kept under Records at the bottom, for 15 days.',
    'help.aNewCardOn': 'A new card on the Home: the pastries to put to prove, one list per day of the week.',
    'help.itOpensOnThe': 'It opens on the day you are proving FOR, so at night you already have tomorrow.',
    'help.tapAnyDayAlong': 'Tap any day along the top to see or fill in that list; the pencil edits the one on screen.',
    'help.tapTheListIcon': 'Tap the list icon beside a supplier to see everything you buy from them.',
    'help.itIsAList': 'It is a list to look at: no boxes, so nothing can be typed into an order by accident.',
    'help.tappingTheRestOf': 'Tapping the rest of the row still opens the order, as before.',
    'help.startAnOrderAgain': 'Start an order again: “Clear quantities” inside a supplier, or at the bottom of the Order tab to pick several.',
    'help.whatYouCountedOn': 'What you counted on the shelves stays — only the amounts to order are cleared.',
    'help.ordersAlreadyRecordedIn': 'Orders already recorded in History are never touched.',
    'help.typeAQuantityFar': 'Type a quantity far above what you usually order and the row says so, in red.',
    'help.recordingThatOrderAsks': 'Recording that order asks you to confirm, listing what looks like an extra digit.',
    'help.itStaysQuietOn': 'It stays quiet on an ingredient ordered fewer than four times: there is no usual amount yet.',
    'help.historyOpensOnThe': 'History opens on the last 15 days, so this week’s orders are the ones on screen.',
    'help.nothingHasBeenDeleted': 'Nothing has been deleted: tap “Show older orders” at the bottom of the list.',
    'help.changeHowFarBack': 'Change how far back it opens in Settings → General.',
    'help.signIn': 'Sign in',
    'help.theAppNowAsks': 'The app now asks for an email and a password. You stay signed in — it is not every day.',
    'help.forgotItTapForgot': 'Forgot it? Tap “Forgot your password?” on the sign-in screen and check your email.',
    'help.theHomeScreenShows': 'The Home screen shows which location you are working on, above the cards.',
    'help.eachLocationSeesOnly': 'Each location sees only its own suppliers, ingredients, orders and recipes.',
    'help.findAnIngredientBy': 'Find an ingredient by name: tap “All ingredients”. No need to know its supplier.',
    'help.ingredientsWithNoSupplier': 'Ingredients with no supplier (supermarket, cash & carry) can now be added and ordered.',
    'help.sendTheOrderAs': 'Send the order as one flat shopping list, or split by supplier as before.',
    'help.theBarAtThe': 'The bar at the bottom shows what is in the order — tap it to review just those items.',
    'help.enterYourSurname': 'Enter your surname.',
    'help.enterYourFirstName': 'Enter your first name.',
    'help.thatSurnameNeedsLetters': 'That surname needs letters in it.',
    'help.thatFirstNameNeeds': 'That first name needs letters in it.',
    'help.chooseAPassword': 'Choose a password.',
    'help.thatOneIsGuessed': 'That one is guessed first. Pick something only you would think of.',
    'help.thatIsOneCharacter': 'That is one character repeated. Pick something only you would think of.',
    'help.doNotUseYour': 'Do not use your email address as your password.',
    'help.updating': 'Updating…',
    'help.newVersionAvailableTap': 'New version available — tap to update',
    'help.updateTheAppTo': 'Update the app to carry on',
    'help.theUpdateDidNot': 'The update did not go through. Trying again is worth it — everyone needs to be on the same version. Anything you have typed is already saved.',
    'help.aNewVersionIs': 'A new version is ready and takes a moment to install. Anything you have typed is already saved.',
    'help.tryAgain': 'Try again',
    'help.updateNow': 'Update now',
    'help.continueWithoutUpdating': 'Continue without updating',
    'help.notificationsAreOnFor': 'Notifications are on for this phone.',
    'help.getToldWhenA': 'Get told when a timer finishes or a client sends an order, even with the app closed.',
    'help.notificationsAreBlockedFor': 'Notifications are blocked for this app. Turn them back on in your phone settings, then reload.',
    'help.addThisAppTo': 'Add this app to your Home screen first — on iPhone, notifications only work from the installed app, not from Safari.',
    'help.notificationsAreNotSet': 'Notifications are not set up for this app yet.',
    'help.thisPhoneCannotShow': 'This phone cannot show notifications.',
    'help.installApp': 'Install app',
    'help.addToYourHome': 'Add to your home screen: tap the Share button, then “Add to Home Screen”.',
    'help.linkCopiedNowPaste': 'Link copied — now paste it in Safari',
    'help.copyFailedLongPress': 'Copy failed — long-press the address bar to copy',
    'help.gotIt': 'Got it',
    'help.yesterdayAndToday': 'Yesterday and today',
    'help.yesterdayOnly': 'Yesterday only',
    'help.todayOnly': 'Today only',
    'help.marketOrder': 'Market order',
    'help.noClientHasSent': 'No client has sent an order yet. When one does, it will be here afterwards.',
    'help.addABusiness': '+ Add a business',
    'help.couldNotCheckYour': 'Could not check your access',
    'help.thisUsuallyMeansNo': 'This usually means no connection. Check it and try again.',
    'help.unitedKingdom': 'United Kingdom',
    'help.italyLabelsInItalian': 'Italy — labels in Italian',
    'help.theUnitedKingdomLabels': 'the United Kingdom — labels in English',
    'help.createThisBusiness': 'Create this business?',
    'help.createThisCustomer': 'Create this customer?',
    'help.itWillBeCreated': 'It will be created in YOUR account, as owner.',
    'help.whoeverOpensTheLink': 'Whoever opens the link becomes its owner.',
    'help.creating': 'Creating…',
    'help.youAreItsOwner': 'You are its owner. It will be in your list of businesses.',
    'help.itIsNotStored': ' It is not stored anywhere and cannot be shown again.',
    'help.copyTheLink': 'Copy the link',
    'nc.country.help': 'This decides the language its allergen labels are printed in, and it cannot be worked out later. The law asks for a label in the language of the country where the food is sold.',


    // ── Choosing what the staff read ───────────────────────────────────────
    'lang.title': 'App language',
    'lang.intro': 'The language everybody who works here reads on screen.',
    'lang.use': 'Use this',
    'lang.inUse': 'In use',
    'lang.saving': 'Saving…',
    'lang.err.save': 'Could not change the language. Check your connection and try again.',
    // ⚠️ THE SENTENCE THE WHOLE PROGRAMME EXISTS FOR. It is shown every time,
    // beside the choice, and it names the country so it can be checked.
    'lang.labels': 'Allergen labels are not affected: they are printed in {language}, because this business sells {country}. The law asks for a label in the language of the country where the food is sold.',
    'lang.labels.noCountry': 'This business has no country set, so it cannot print an allergen label at all. The country decides the label’s language, and it is not something the app may guess.',


    // ⚠️ THE NAME OF A LANGUAGE INSIDE A SENTENCE IS INTERFACE TEXT. The choice
    // list names each language in ITSELF («Italiano»), because that is the word
    // somebody is looking for. A sentence about the labels is read in the
    // language on screen, so there it is «inglese», not «English».
    'language.en.inSentence': 'English',
    'language.it.inSentence': 'Italian',
    // ⚠️ AND SO IS A COUNTRY'S NAME. js/market.js used to carry its own English
    // copy (countryName); it was deleted on 23 Aug 2026 once its last caller moved
    // here, because a name nobody translates is a name that reaches a screen.
    'country.GB': 'the United Kingdom',
    'country.IT': 'Italy',
    // ⚠️ THE WHOLE PREPOSITIONAL PHRASE, ONE PER COUNTRY. Italian takes the
    // article for one and not the other — «nel Regno Unito» but «in Italia» —
    // so a sentence with a hole for the country alone cannot be right for both.
    // The same shape as the role articles («an owner» / «the head chef»): where
    // languages differ in STRUCTURE, each case gets its own phrase.
    'country.GB.in': 'in the United Kingdom',
    'country.IT.in': 'in Italy',


    // ── The screen AROUND the label ────────────────────────────────────────
    // ⚠️ THESE ARE THE CHROME, NEVER THE LABEL. What the label itself says comes
    // from js/market.js, keyed by the venue's country. Anything here is read by
    // whoever is holding the phone; anything there is read by a customer with an
    // allergy, in the country the food is sold in.
    'label.whatItShows': 'What the label shows',
    'label.blocked': 'No label can be made',
    'label.blocked.noWeights': 'This recipe has no ingredients with a weight.',
    'label.blocked.allergensOff': 'This venue does not track allergens, so the app cannot make a label. Turn allergens back on in Suppliers & ingredients → Settings.',
    'label.blocked.notDeclared': {
      one: '{n} ingredient is not declared. The recipe screen lists them.',
      other: '{n} ingredients are not declared. The recipe screen lists them.',
    },
    'label.onFinishedWeight': 'Worked out on the finished weight — {pct}% is lost in baking.',
    'label.noNutrition': 'No nutrition table: at least one ingredient has no values per 100 g yet. The allergens above are still complete.',
    'label.caveat.title': 'Check this before it goes on food',
    'label.caveat.body': 'It is built from what the suppliers declared and from the recipe as written. It cannot know about your own kitchen — shared benches, shared equipment — or about a substitution made this morning.',
    'label.copy': 'Copy the text',
    'label.copied': 'Copied',
    'label.copyFailed': 'Could not copy — select the text above instead',
    // ⚠️ THE THREE BUTTONS ABOVE THE LABEL. They are interface — they say what to
    // tap, not what is in the food — so they follow the screen. They lived in a
    // module-level SHOW_LABELS constant in js/catalogue/label-view.js, which is the
    // v1.57.0 shape exactly: resolved once, before any venue is open. The constant
    // now carries these KEYS and the lookup happens when the switch is painted.
    'label.shows.allergens': 'Allergens',
    'label.shows.nutrition': 'Nutrition',
    'label.shows.both': 'Both',
    // What the card is headed when the recipe has no name yet.
    'label.untitled': 'Recipe',
    // ⚠️ MOVED OUT OF js/market.js ON 23 Aug 2026, WHERE THEY WERE FIXED ENGLISH.
    // All three are addressed to the person MAKING the label, never to the customer
    // reading it, so they follow the interface — and market.js may not import this
    // dictionary at all, which is why they had to move rather than be wrapped.
    //
    // ⚠️ {country} IS THE WHOLE PREPOSITIONAL PHRASE (`country.GB.in`), not the bare
    // name: Italian takes the article for one and not the other. Same shape as
    // `lang.labels`, which says the same thing on the language screen.
    'label.languageNote': 'This label is produced in {language} because this business sells {country}.',
    'label.ingredientNamesNote': 'The ingredient names are the ones you typed — the app does not translate them.',
    'label.blocked.noCountry': 'No label can be made yet: nobody has said which country this business sells in, and that decides the language the label must be printed in. The owner can set it when the business is created.',
    'label.print': 'Print',
    'label.print.viaSystem': 'Print dialog',
    'label.print.zplCopy': 'Copy the printer code',
    'label.print.zplCopied': 'Copied — paste it onto the printer on the shop computer',
    'label.settings.printer': 'Printer',
    'label.settings.printer.os': 'Any printer (print dialog)',
    'label.settings.printer.zpl': 'Zebra (its own language)',
    'label.settings.printerNote': 'A Zebra sets the text with its own type, which is much sharper on small labels. On a Zebra the allergens are printed in CAPITALS, because that kind of printer has no bold — the preview shows it the same way.',
    'label.settings.dpi': 'Printer resolution',
    'label.settings.dpiNote': 'It is printed on the sticker on the back of the printer. With the wrong number the label comes out the wrong size even though everything else is right.',
    'label.preview.actualSize': 'Actual size — {w} × {h} mm',
    'label.preview.scaled': '{w} × {h} mm — shown smaller to fit this screen',
    'label.print.tooBig': 'This label does not fit on {w} × {h} mm at a size the law allows it to be read at. Use bigger labels, or shorten the ingredient names. Nothing is ever shortened to make it fit.',
    'label.print.noRoad': 'This device cannot reach a printer. Open this label on a computer that has the printer installed, or copy the text below.',
    'label.settings.title': 'Label printing',
    'label.settings.size': 'Label size',
    'label.settings.custom': 'Custom size',
    'label.settings.width': 'Width (mm)',
    'label.settings.height': 'Height (mm)',
    'label.settings.showDate': 'Leave room for a date',
    'label.settings.showDateNote': 'Adds a line at the bottom of the label. The date itself is typed when you print, because it belongs to the batch and not to the recipe.',
    'label.settings.setup': 'Before the first print, set the label size in the printer’s own driver, and in the print window set margins to none and scale to 100% — not “fit to page”. It only has to be done once, and until it is done the first label will come out the wrong size.',
    'label.settings.saveFailed': 'Could not save — the change has been put back',


    // ── The CLIENT's own ordering page ─────────────────────────────────────
    // ⚠️ IT FOLLOWS THE COUNTRY, NOT THE INTERFACE SETTING — see order-main.js.
    // ⚠️ THE BROWSER TAB AND THE STATE BEFORE THE LINK IS READ. The two sentences
    // below are the only words on order.html written into the markup; everything
    // else the client sees is built by order-main.js. They stayed English for every
    // client of every venue until 23 Aug 2026.
    'co.pageTitle': 'Send your order',
    'co.openTheLinkSent': 'Open the ordering link the bakery sent you.',
    'co.youCanChangeYour': 'You can change your order until the bakery starts making it.',
    'co.thisLinkIsIncomplete': 'This link is incomplete',
    'co.askTheBakeryTo': 'Ask the bakery to send you your ordering link again.',
    'co.thisLinkIsNot': 'This link is not valid',
    'co.thisLinkNoLonger': 'This link no longer works',
    'co.itMayHaveBeen': 'It may have been replaced by a newer one. Ask the bakery for your current link.',
    'co.openYourOrderingLink': 'Open your ordering link',
    'co.useTheLinkThe': 'Use the link the bakery sent you. Once you have opened it once, this page will ',
    'co.rememberYouOnThis': 'remember you on this device.',
    'co.loading': 'Loading…',
    'co.fetchingYourProducts': 'Fetching your products.',
    'co.thisLinkIsNot2': 'This link is not set up yet',
    'co.askTheBakeryTo2': 'Ask the bakery to send you a new ordering link.',
    'co.couldNotLoadYour': 'Could not load your products',
    'co.thisUsuallyMeansNo': 'This usually means no connection. Check it and try again.',
    'co.yourOrder': 'Your order',
    'co.orderingIsClosedFor': 'Ordering is closed for now',
    'co.sending': 'Sending…',
    'co.thisOrderHasChanged': 'This order has changed since you opened it. Reloading…',
    'co.notSentCheckYour': 'Not sent — check your connection and try again.',
    'co.orderSent': 'Order sent',
    'co.changeThisOrder': 'Change this order',
    'co.deliveryDay': 'Delivery day',
    'co.yourProductListIs': 'Your product list is empty. Ask the bakery to add what you order.',
    'co.howMany': 'How many',
    'co.anythingTheBakeryShould': 'Anything the bakery should know (optional)',
    'co.sendOrder': 'Send order',
    'co.theLinkDidNot': 'The link did not say which bakery this is.',
    'co.deletedProduct': 'Deleted product',
    'co.thisClientCannotHave': 'This client cannot have an ordering link until it has been saved.',
    'co.nothingThatDay': 'You have told the bakery you need nothing that day.',
    // ⚠️ REAL PLURALS, one phrase per case. What this replaced was a count, a
    // ternary plural and a second ternary for the deadline, all in one template.
    'co.sent.withCutoff': {
      one: '{n} item. You can change it until {time} the day before.',
      other: '{n} items. You can change it until {time} the day before.',
    },
    'co.sent.noCutoff': {
      one: '{n} item. You can still change it.',
      other: '{n} items. You can still change it.',
    },


    'people.noNameYet': '(no name yet)',
    'people.you': ' · you',
    'people.noEmailParen': '(no email)',
    'price.byWeight': 'by kg',
    'price.byVolume': 'by litre',
    'price.none': 'No price yet',
    'price.needPieceWeight': 'Add the weight of one piece to use this in a recipe',

    'common.loading': 'Loading…',
  }),
  it: Object.freeze({
    'role.owner': 'Titolare',
    'role.manager': 'Responsabile',
    'role.headChef': 'Chef di cucina',
    'role.staff': 'Dipendente',

    // 📌 Italian puts the word where Italian puts it, which is the entire reason
    // a phrase is one entry with a hole and not two halves joined at the call
    // site. «Rendi responsabile», not «Fai responsabile».
    'people.make': 'Rendi {role}',
    'people.sendHow': 'Come vuoi mandarlo?',
    'people.add.link': 'Manda un link',
    'people.add.digits': 'Detta un codice',
    'role.owner.inSentence': 'titolare',
    'role.manager.inSentence': 'responsabile',
    'role.headChef.inSentence': 'chef di cucina',
    'role.staff.inSentence': 'dipendente',

    'role.means.owner': 'Tutto, compreso aggiungere persone e decidere che ruolo hanno.',
    'role.means.manager': 'Gestisce questo locale: può cancellare fornitori, ingredienti, ricette e prodotti. Non può aggiungere persone.',
    'role.means.headChef': 'Identico a Responsabile — cambia solo il nome del ruolo. Gestisce questo locale: può cancellare fornitori, ingredienti, ricette e prodotti. Non può aggiungere persone.',
    'role.means.staff': 'Fa il lavoro di ogni giorno — quantità, impasti, ordini. Non può cancellare niente né aggiungere persone.',

    // 📌 Italian takes no article here, which is exactly why these are four whole
    // sentences and not one template with a hole for «an» / «a» / «the».
    'people.confirm.owner': 'Rendere {name} titolare?',
    'people.confirm.manager': 'Rendere {name} responsabile?',
    'people.confirm.headChef': 'Rendere {name} chef di cucina?',
    'people.confirm.staff': 'Rendere {name} dipendente?',

    'people.joinsAs': 'Entra come {role} · {expires} · apre l’app, tocca “{button}”, crea il suo account e digita il codice.',

    'people.link.intro': 'Manda questo link alla persona. Funziona una volta sola, e quando lo apre sceglie da sé la sua email e la sua password.',
    'people.link.joinsAs': 'Entra come {role} · {expires}',
    'people.link.message': 'Ciao! Ecco il tuo accesso a {venue}. Apri questo link e scegli la tua password; una volta dentro, l’app ti spiega come aggiungerla al telefono: {link}',
    'people.link.copied': 'Link copiato. Incollalo in un messaggio per la persona.',
    'people.link.manual': 'Copia questo link e mandalo alla persona:\n\n{link}',

    'auth.signIn.sub': 'Accedi per aprire il tuo locale.',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.signIn': 'Accedi',
    'auth.forgot': 'Password dimenticata?',
    'auth.iHaveACode': 'Ho un codice di accesso',
    'auth.installGuide': 'Come installare l’app',
    'auth.enterEmail': 'Inserisci la tua email.',
    'auth.enterPassword': 'Inserisci la tua password.',
    'auth.signingIn': 'Accesso in corso…',
    'auth.typeEmailFirst': 'Scrivi prima la tua email qui sopra, poi tocca qui.',
    'auth.resetSent': 'Se {address} ha un account, il link per reimpostare la password sta arrivando.',
    'auth.back': 'Indietro',
    'auth.tryAgain': 'Riprova',
    'auth.otherAccount': 'Accedi con un altro account',
    'auth.logOut': 'Esci',
    'auth.logOut.title': 'Vuoi uscire?',
    'auth.logOut.message': 'Per rientrare ti serviranno email e password.',

    // 📌 Come in inglese, una sola frase per quattro casi: dire quale metà è
    // sbagliata rivelerebbe a chi tenta la porta che quell’email esiste.
    'auth.err.badPair': 'Email e password non corrispondono a nessun account.',
    'auth.err.badEmail': 'Questo non sembra un indirizzo email.',
    'auth.err.disabled': 'Questo account è stato disattivato. Chiedi al titolare di riattivarlo.',
    'auth.err.tooMany': 'Troppi tentativi. Aspetta un minuto e riprova.',
    'auth.err.offline': 'Nessuna connessione. Il primo accesso su un dispositivo richiede internet.',
    'auth.err.emailTaken': 'Questa email ha già un account. Accedi con quella.',
    'auth.err.weakPassword': 'Scegli una password più lunga — almeno 6 caratteri.',
    'auth.err.generic': 'Accesso non riuscito. Riprova.',

    'join.title.invited': 'Sei stato invitato',
    'join.title.new': 'Entra con un codice',
    'join.title.have': 'Inserisci il codice',
    'join.sub.prefillNew': 'Il codice è già inserito. Aggiungi il tuo nome e scegli una password.',
    'join.sub.prefill': 'Il codice è già inserito. Aggiungi il tuo nome per finire.',
    'join.sub.new': 'Crea il tuo account, poi digita il codice che ti hanno dato.',
    'join.sub.have': 'Digita il codice che ti hanno dato.',
    'join.firstName': 'Il tuo nome',
    'join.lastName': 'Il tuo cognome',
    'join.email': 'La tua email',
    'join.choosePassword': 'Scegli una password (almeno {n} caratteri)',
    'join.code': 'Codice',
    'join.join': 'Entra',
    'join.signInInstead': 'Accedi con quella email',
    'join.signInAndAdd': 'Accedi, e aggiungiamo l’attività al tuo account.',
    'join.creating': 'Creazione dell’account…',
    'join.checking': 'Controllo…',
    'join.checkingCode': 'Controllo del codice…',
    'join.badCode': 'Questo codice non funziona. Chiedine uno nuovo.',
    'join.alreadyMember': 'Sei già dentro questa attività. Un codice non può cambiare cosa puoi fare qui.',
    'join.shapeHint': 'Inserisci il codice di sei cifre, oppure apri il link che ti hanno mandato.',

    'join.expires.expired': 'scaduto',
    'join.expires.minutes': { one: 'scade fra {n} minuto', other: 'scade fra {n} minuti' },
    'join.expires.hours': { one: 'scade fra {n} ora', other: 'scade fra {n} ore' },
    'join.expires.days': { one: 'scade fra {n} giorno', other: 'scade fra {n} giorni' },

    'hub.where': 'Dove vuoi andare?',
    'hub.mine': 'Le mie attività',
    'hub.mine.sub': { one: 'Il locale che gestisci', other: 'I locali che gestisci' },
    'hub.customers': 'Attività dei clienti',
    'hub.customers.sub': 'Le attività che usano Misé',
    'hub.back': 'Torna a Misé',

    'picker.title': 'Scegli il locale',
    'picker.sub': 'Hai accesso a più di uno.',
    'noAccess.title': 'Nessun locale',
    'noAccess.body': 'Questo account non è collegato a nessun locale. Se ti hanno dato un codice, digitalo qui.',

    'invite.title': 'Hai aperto un invito',
    'invite.message': 'Vuoi aggiungere questa attività a {who}?',
    'invite.ok': 'Aggiungila',
    'invite.cancel': 'Non ora',

    'people.title': 'Chi può entrare',
    'people.rename': 'Rinomina',
    'people.remove': 'Rimuovi',
    'people.cancel': 'Annulla',
    'people.done': 'Fatto',
    'people.empty': 'Ancora nessun altro.',
    'people.firstName': 'Nome',
    'people.surname': 'Cognome',
    'people.noEmail': 'nessuna email',
    'people.readOut': 'Leggilo a voce a loro:',
    'people.invite.intro': 'Aggiungi qualcuno che lavora qui. Installa l’app e crea il suo account, con la sua email e la sua password: non le scegli tu.',
    'people.remove.title': 'Vuoi rimuovere questa persona?',
    'people.remove.message': '{name} ({email}) perderà subito l’accesso a questo locale. Tutto quello che ha inserito resta.',
    'people.err.read': 'Non è stato possibile leggere chi lavora qui. Controlla la connessione.',
    'people.err.name': 'Non è stato possibile salvare quel nome. Controlla la connessione.',
    'people.err.change': 'Non è stato possibile cambiarlo. Controlla la connessione e riprova.',
    'people.err.remove': 'Non è stato possibile rimuoverli. Controlla la connessione e riprova.',
    'people.err.code': 'Non è stato possibile creare un codice. Controlla la connessione e riprova.',

    'home.switch': 'Cambia locale',
    'home.switch.title': 'Vuoi cambiare locale?',
    'home.switch.ok': 'Cambia',
    'home.switch.cleared': 'Tutto quello che è stato digitato e non salvato su questo dispositivo viene cancellato.',
    'home.switch.toOne': 'Vuoi aprire {other} invece di {here}?',
    'home.switch.toMany': 'Vuoi scegliere un altro locale?',

    'section.calculator': 'Calcolatore',
    'section.orders': 'Ordini',
    'section.suppliers': 'Fornitori',
    'section.suppliersAndIngredients': 'Fornitori e ingredienti',
    'section.catalogue': 'Ricettario',
    'section.pastries': 'Paste',
    'section.foodcost': 'Food cost',
    'section.calculator.sub': 'Calcolo degli impasti per gli ordini del giorno',
    'section.orders.sub': 'Fornitori, ingredienti e l’ordine su WhatsApp',
    'section.catalogue.sub': 'Ricette, scalatura e impasto guidato',
    'section.pastries.sub': 'Le sette liste di lievitazione della settimana',
    'section.foodcost.sub': 'Prezzi, margini ed etichette',

    'title.calculator': 'Calcolatore impasti — Misé',
    'title.catalogue': 'Ricettario — Misé',
    'title.foodcost': 'Food cost — Misé',
    'title.orders': 'Ordini — Misé',
    'title.pastries': 'Paste — Misé',
    'title.suppliers': 'Fornitori e ingredienti — Misé',

    'aria.mainSections': 'Sezioni principali',
    'aria.ordersSections': 'Sezioni degli ordini',
    'aria.orderView': 'Vista dell’ordine',
    'aria.dayOfWeek': 'Giorno della settimana',
    'aria.allMyBusinesses': 'Tutte le mie attività',
    'aria.editThisDay': 'Modifica questo giorno',
    'aria.editRecipe': 'Modifica ricetta',
    'aria.whichIngredients': 'Quali ingredienti mostrare',
    'aria.whichSuppliers': 'Quali fornitori mostrare',
    'aria.ingredientsFrom': 'Ingredienti di {supplier}',

    // ⚠️ I NOMI DEI PULSANTI SONO QUELLI CHE IL TELEFONO MOSTRA DAVVERO in italiano
    // («Condividi», «Aggiungi alla schermata Home»): la guida segue la lingua del
    // telefono, quindi le due cose sono d’accordo per costruzione.
    'ig.pageTitle': 'Installa Misé',
    'ig.installTheApp': 'Installa l’app',
    'ig.whichDevice': 'Che dispositivo stai usando?',
    'ig.device.ios': 'iPhone / iPad',
    'ig.device.android': 'Android',
    'ig.device.desktop': 'Computer',
    'ig.yourDevice': 'il tuo',
    'ig.changeDevice': '← Cambia dispositivo',
    'ig.qrAlt': 'Codice QR per aprire l’app Misé',
    'ig.qrCaption': 'Oppure inquadra questo con la fotocamera del telefono per aprire l’app',
    'ig.safari.title': 'Apri questa pagina in Safari per installare.',
    'ig.safari.body': 'Su iPhone l’app si può aggiungere alla schermata Home solo da Safari — gli altri browser (come Chrome) non riescono a installarla.',
    'ig.safari.how': 'Tocca il menu ••• e scegli “Apri in Safari”, oppure copia il link e incollalo in Safari.',
    'ig.copyLink': 'Copia il link',
    'ig.ios.1': 'Apri il link in Safari (dev’essere Safari).',
    'ig.ios.2': 'Tocca il pulsante Condividi (il quadrato con la freccia in su).',
    'ig.ios.3': 'Scorri in basso e tocca “Aggiungi alla schermata Home”.',
    'ig.ios.4': 'Tocca “Aggiungi” — l’icona dell’app compare nella schermata Home.',
    'ig.android.1': 'Apri il link in Chrome.',
    'ig.android.2': 'Tocca il pulsante “Installa app” se compare, oppure il menu ⋮ (in alto a destra).',
    'ig.android.3': 'Tocca “Installa app” / “Aggiungi a schermata Home”.',
    'ig.android.4': 'Conferma — l’icona dell’app compare.',
    'ig.desktop.1': 'Apri il link in Chrome o Edge.',
    'ig.desktop.2': 'Clicca l’icona di installazione nella barra degli indirizzi (un piccolo schermo con un ⊕), oppure il menu → “Installa Misé”.',
    'ig.desktop.3': 'Conferma — si apre in una finestra sua e ottiene un collegamento.',
    'ig.note': 'Lo fai una volta sola per dispositivo. Dopo, tocchi l’icona dell’app — come qualsiasi altra app.',

    'bz.title': 'Attività dei clienti',
    'bz.new': 'Nuova attività',
    'bz.hint': 'I tuoi locali non sono qui — stanno dietro a “Le mie attività”.',
    'bz.empty': 'Ancora nessuna attività. “Nuova attività” qui sopra ne crea una.',
    'bz.noSections': 'Nessuna sezione',
    'bz.status.open': 'Qualcuno l’ha aperta',
    'bz.status.stranded': 'Nessuno l’ha ancora aperta',
    'bz.created': 'Creata il {day} {month} {year}',
    'bz.createdRecently': 'Creata da poco',
    'bz.created.inSentence': 'creata il {day} {month} {year}',
    'bz.createdRecently.inSentence': 'creata da poco',
    'bz.rowState': '{status} · {created}',
    'bz.newLink': 'Crea un nuovo link',
    'bz.newLink.title': 'Vuoi creare un nuovo link?',
    'bz.newLink.message': 'Un nuovo link per {name}. Ogni link mandato prima smette di funzionare, quindi chi ne ha uno non potrà usarlo.',
    'bz.making': 'Creazione…',
    'bz.delete': 'Elimina',
    'bz.delete.title': 'Vuoi eliminare questa attività?',
    'bz.delete.message': '{name} verrà rimossa, insieme al link che la apre. Nessuno l’ha aperta, quindi non si perde altro — ma questa cosa non si può annullare.',
    'bz.link.copied': 'Il nuovo link per {name} è stato copiato. Incollalo in un messaggio per loro.',
    'bz.link.once': 'Funziona una volta sola e {expires}.',
    'bz.link.manual': 'Copia questo link e mandalo a {name}:',
    'bz.err.newLink': 'Non è stato possibile creare un nuovo link. Riprova.',
    'bz.err.delete': 'Non è stato possibile eliminare questa attività. Riprova.',
    'bz.err.load': 'Non è stato possibile caricare le attività. Controlla la connessione.',

    'nc.title.self': 'Aggiungi un’attività',
    'nc.title.customer': 'Nuovo cliente',
    'nc.nameLabel': 'Il nome dell’attività',
    'nc.namePlaceholder': 'Panificio Rossi',
    'nc.create': 'Crea',
    'nc.country.labels.GB': 'Le etichette sono prodotte in inglese.',
    'nc.country.labels.IT': 'Le etichette sono prodotte in italiano.',
    'nc.link.message': 'Ecco il link per configurare {name}: {link}',
    'nc.country': 'In quale paese vende?',
    'nc.sections.self': 'Quali sezioni usa',
    'nc.sections.customer': 'Che cosa stanno comprando',
    'nc.explain.self': 'Crea l’attività NEL TUO account, come titolare. Si apre subito — nessun link, niente da mandare.',
    'nc.explain.customer': 'Crea l’attività e un link che rende titolare chi lo apre. Scelgono da soli email e password. Tu non entri.',
    'nc.leave.title': 'Vuoi uscire senza mandare il link?',
    'nc.leave.message': '{name} è stata creata, ma il suo link si vede solo qui e non può essere mostrato di nuovo. Senza, nessuno può aprire la loro app.',
    'nc.leave.ok': 'Esci comunque',
    'nc.leave.stay': 'Resta',
    'nc.err.noName': 'Dai un nome all’attività.',
    'nc.err.longName': 'Quel nome supera i {n} caratteri.',
    'nc.err.noCountry': 'Scegli il paese in cui vende questa attività — decide la lingua delle sue etichette.',
    'nc.err.noSection': 'Scegli almeno una sezione — altrimenti la loro app si apre vuota.',


    'day.weekdayShort.0': 'dom', 'day.weekdayShort.1': 'lun', 'day.weekdayShort.2': 'mar',
    'day.weekdayShort.3': 'mer', 'day.weekdayShort.4': 'gio', 'day.weekdayShort.5': 'ven',
    'day.weekdayShort.6': 'sab',
    'day.weekdayLong.0': 'domenica', 'day.weekdayLong.1': 'lunedì', 'day.weekdayLong.2': 'martedì',
    'day.weekdayLong.3': 'mercoledì', 'day.weekdayLong.4': 'giovedì', 'day.weekdayLong.5': 'venerdì',
    'day.weekdayLong.6': 'sabato',
    'day.monthShort.0': 'gen', 'day.monthShort.1': 'feb', 'day.monthShort.2': 'mar',
    'day.monthShort.3': 'apr', 'day.monthShort.4': 'mag', 'day.monthShort.5': 'giu',
    'day.monthShort.6': 'lug', 'day.monthShort.7': 'ago', 'day.monthShort.8': 'set',
    'day.monthShort.9': 'ott', 'day.monthShort.10': 'nov', 'day.monthShort.11': 'dic',
    'day.spelled': '{weekday} {d} {month} {year}',
    'day.today': 'Oggi',
    'day.yesterday': 'Ieri',
    'day.tomorrow': 'Domani',
    'day.today.inSentence': 'oggi',
    'day.yesterday.inSentence': 'ieri',
    'day.tomorrow.inSentence': 'domani',
    'day.inNDays': { one: 'Fra {n} giorno', other: 'Fra {n} giorni' },
    'day.nDaysAgo': { one: '{n} giorno fa', other: '{n} giorni fa' },
    'day.inNDays.inSentence': { one: 'fra {n} giorno', other: 'fra {n} giorni' },
    'day.nDaysAgo.inSentence': { one: '{n} giorno fa', other: '{n} giorni fa' },
    'day.madeFor': '{made} per {target}',
    'day.on': 'il {day}',
    'day.for': 'per {day}',

    'orders.sendDay': 'Manda {day}',
    'orders.notPlacedFor': '{supplier} — ordine non effettuato',
    'orders.typedWhen': {
      one: '{n} voce scritta {when}',
      other: '{n} voci scritte {when}',
    },
    'orders.placedWhen': 'Effettuato {when}',
    'orders.updateOrderFor': 'Aggiornare l’ordine di {supplier} {day}?',
    'orders.deleteOrderFor': 'Eliminare l’ordine di {supplier} {day}?\n\nSparisce dallo Storico per sempre e non si può recuperare. Le quantità suggerite imparano da questi registri, quindi cambieranno.',
    'co.alreadySentFor': 'Hai già mandato un ordine {day}. Mandandolo di nuovo sostituisci il precedente.',
    'co.ordersClosedFor': 'Gli ordini {day} sono chiusi. Scegli un altro giorno.',
    'co.sendEmptyFor': 'Mandare un ordine vuoto {day}?',
    'co.sendOrderFor': 'Mandare questo ordine {day}?',
    'co.send': 'Manda',
    'co.clientAndDay': '{client} — {day}.',

    'calc.leavening': 'Lievito',
    'calc.leaveningNone': 'In questa ricetta non lievita niente',
    'calc.unnamedIngredient': 'Ingrediente senza nome',
    'calc.leaveningHint': 'Quale ingrediente fa lievitare l’impasto. Solo questo viene scalato dalla percentuale qui sotto.',
    'calc.leaveningStartAt': 'Parti da',
    'calc.leaveningPctHintKnob': 'La percentuale da cui parte ogni telefono. Poi ognuno può muovere la propria manopola senza cambiare questa.',
    'calc.leaveningPctHintFixed': 'La percentuale che questa ricetta usa sempre. Con la manopola nascosta, questo è l’unico posto dove si può impostare.',
    'calc.leaveningKnobHint': 'Permette a chi impasta di alzare o abbassare la percentuale sul momento, sul proprio telefono.',
    'calc.howItCalculates': 'Come calcola',
    'calc.logicHint.orders': 'La quantità d’impasto la decidono gli ordini dei clienti.',
    'calc.logicHint.total': 'Scrivi tu quanti chili d’impasto fare.',
    'calc.logicHint.both': 'Gli ordini dei clienti, più una quantità in più scritta a mano.',

    'away.title': 'Sono in ferie',
    'away.untilLabel': 'Via fino a, compreso',
    'away.set': 'Imposta',
    'away.onUntil': 'In ferie fino al {day}',
    'away.whatItDoes': 'Il tuo telefono smette di suonare. Le liste d’ordine continuano ad arrivare e restano lì ad aspettarti — non passano a nessun altro.',
    'away.backTitle': 'Già tornato?',
    'away.backMessage': 'Le tue ferie arrivano al {day}. Chiuderle adesso riaccende le notifiche.',
    'away.back': 'Sono tornato',
    'away.badDate': 'Quella data non si può usare. Scegli un giorno da oggi in avanti, entro un anno.',
    'away.saveFailed': 'Non salvato — controlla la connessione e riprova.',
    'away.nobodyTitle': 'Non verrà avvisato nessuno',
    'away.nobodyMessage': {
      one: '{names} è in ferie, quindi per questa lista non suonerà nessun telefono. Resta comunque in Ordini e sulla Home, e ti aspetta lì.',
      other: '{names} sono in ferie, quindi per questa lista non suonerà nessun telefono. Resta comunque in Ordini e sulla Home, e ti aspetta lì.',
    },
    'away.nobodyMessagePlain': 'Chi gestisce il locale è in ferie, quindi per questa lista non suonerà nessun telefono. Resta comunque in Ordini e sulla Home, e ti aspetta lì.',
    'away.sendAnyway': 'Manda lo stesso',
    'calc.recipeSource': 'Da dove vengono gli ingredienti',
    'calc.sourceOwn': 'Questa ricetta ha i suoi',
    'calc.sourceOwnHint': 'Gli ingredienti si scrivono qui. Non li usa nient’altro.',
    'calc.sourceLinkedHint': 'Gli ingredienti vengono dal Ricettario. Correggili lì e si correggono in ogni linguetta che usa questa ricetta.',
    'calc.editedInCatalogue': 'Si modifica nel Ricettario, non qui — così ne esiste una versione sola.',
    'calc.sourceMissing': 'Questa ricetta adesso non si riesce a leggere dal Ricettario, quindi non si può calcolare niente. Controlla che esista ancora.',
    'calc.sourceEmpty': 'Quella ricetta del Ricettario non ha ancora ingredienti.',
    'calc.sourceUnweighable': 'Questa ricetta qui non si può ancora usare: “{row}” non ha un peso. Il calcolatore scala tutto a peso, quindi daglielo nel Ricettario.',
    'calc.sourceLinkFailed': 'Non sono riuscito a collegare quella ricetta — controlla la connessione e riprova.',
    'orders.deletedIngredient': 'Ingrediente eliminato',
    'orders.setAQuantityTo': 'Metti una quantità a 0 per togliere quella voce dall’ordine.',
    'orders.deleteThisOrder': 'Elimina questo ordine',
    'orders.editOrder': 'Modifica ordine',
    'orders.noItemsRecorded': 'Nessuna voce registrata.',
    'orders.thisOrderWouldHave': 'Questo ordine resterebbe senza voci. Usa “Elimina questo ordine” se non deve esserci affatto.',
    'orders.nothingLeftToSave': 'Non resta niente da salvare',
    'orders.saveChanges': 'Salva le modifiche',
    'orders.noSupplier': 'Nessun fornitore',
    'orders.unknownSupplier': 'Fornitore sconosciuto',
    'orders.noPastOrdersYet': 'Ancora nessun ordine passato.',
    'orders.sendAll': 'Manda tutti',
    'orders.sendOnWhatsapp': 'Manda su WhatsApp',
    'orders.wholeWeekAllSuppliers': 'Settimana intera — tutti i fornitori',
    'orders.searchAnIngredient': 'Cerca un ingrediente…',
    'orders.noIngredientsYetAdd': 'Ancora nessun ingrediente — aggiungili nelle Impostazioni.',
    'orders.nothingInThisOrder': 'Niente in questo ordine corrisponde alla ricerca.',
    'orders.noIngredientMatchesYour': 'Nessun ingrediente corrisponde alla ricerca.',
    'orders.orderScreen': 'Schermata ordine',
    'orders.showStock': 'Mostra la giacenza',
    'orders.showTheStockBox': 'Mostra la casella Giacenza sulle righe dell’ordine',
    'orders.turnThisOffIf': 'Disattivala se non conti quello che resta prima di ordinare. Le quantità suggerite continuano a funzionare: senza giacenza diventano la tua quantità abituale.',
    'orders.daysOfHistory': 'Giorni di storico',
    'orders.daysOfPastOrders': 'Giorni di ordini passati mostrati nello Storico',
    'orders.olderOrdersAreNever': 'Gli ordini più vecchi non vengono mai eliminati — restano a un tocco sotto “Mostra ordini più vecchi”, e le quantità suggerite continuano a imparare da tutti.',
    'orders.addSupplier': '+ Aggiungi fornitore',
    'orders.searchASupplier': 'Cerca un fornitore…',
    'orders.noSuppliersYet': 'Ancora nessun fornitore.',
    'orders.noSupplierMatchesYour': 'Nessun fornitore corrisponde alla ricerca.',
    'orders.addIngredient': '+ Aggiungi ingrediente',
    'orders.noIngredientsYet': 'Ancora nessun ingrediente.',
    'orders.noPrice': 'Nessun prezzo',
    'orders.notSaved': 'Non salvato',
    'orders.editSupplier': 'Modifica fornitore',
    'orders.newSupplier': 'Nuovo fornitore',
    'orders.deliveryDaysWhenThey': 'Giorni di consegna — quando consegnano',
    'orders.orderDaysWhenYou': 'Giorni d’ordine — quando fai l’ordine',
    'orders.phoneWhatsappDigitsOnly': 'Telefono (WhatsApp, solo cifre)',
    'orders.noPrice2': 'Nessuno',
    'orders.weightOfOnePiece': 'Peso di un pezzo (kg)',
    'orders.neededOnlyToUse': 'Serve solo per usarlo in una ricetta scritta in grammi — un uovo è circa 0,055, una bacca di vaniglia circa 0,0035.',
    'orders.howItIsBought': 'Come si acquista',
    'orders.loading': 'Caricamento…',
    'orders.noPriceRecordedYet': 'Ancora nessun prezzo registrato.',
    'orders.priceHistory': 'Storico prezzi',
    'orders.showThem': 'Mostrali',
    'orders.theRest': 'Il resto',
    'orders.noNutritionYet': 'Ancora nessuno',
    'orders.nutritionComplete': 'Completi',
    'orders.declaredShort': 'dichiarato',
    'orders.copyThisFromThe': 'Copia questi dati dalla scheda tecnica del fornitore, non a memoria. “Tracce” è ciò che dichiara il fornitore — non può sapere niente della tua cucina.',
    'orders.iHaveCheckedThe': 'Ho controllato la scheda tecnica del fornitore',
    'orders.pack.label': 'L’elenco ingredienti stampato sulla confezione',
    'orders.pack.help': 'Scrivilo o incollalo esattamente come è stampato. L’app cerca le parole degli allergeni e spunta le caselle qui sotto al posto tuo — tu le controlli e confermi.',
    'orders.pack.placeholder': 'es. Farina di GRANO tenero, acqua, BURRO, sale, farina di malto d’ORZO. Può contenere tracce di FRUTTA A GUSCIO.',

    'orders.pack.photo.fill': 'Fotografa la confezione',
    'orders.pack.photo.title': 'Ingredienti da una foto',
    'orders.pack.photo.lead': 'Fotografa l’elenco ingredienti stampato sulla confezione e l’app lo trascrive per te.',
    'orders.pack.photo.take': 'Scatta una foto',
    'orders.pack.photo.addAnother': 'Aggiungi un’altra foto',
    'orders.pack.photo.remove': 'Togli questa foto',
    'orders.pack.photo.thumbAlt': 'La foto che hai scattato',
    'orders.pack.photo.read': 'Leggi la confezione',
    'orders.pack.photo.reading': 'Sto leggendo…',
    'orders.pack.photo.working': 'Sto leggendo la confezione… ci vogliono pochi secondi.',
    'orders.pack.photo.note': 'Controlla il testo sulla confezione prima di salvare. L’app propone le spunte degli allergeni da questo testo, ma niente è dichiarato finché non spunti tu la casella che dice che hai controllato.',
    'orders.pack.photo.replaceTitle': 'Sostituisco quello che c’è scritto?',
    'orders.pack.photo.replaceBody': 'Qui c’è già un elenco ingredienti. Due elenchi insieme verrebbero letti come un prodotto solo, quindi la foto lo sostituisce. Finché non premi Salva non viene salvato niente.',
    'orders.pack.photo.replaceOk': 'Sostituisci',
    'orders.pack.photo.keepMine': 'Tieni quello che ho scritto',
    'orders.pack.photo.truncated': 'Elenco molto lungo — sono stati tenuti solo i primi 4000 caratteri. Controlla la fine sulla confezione.',
    'orders.pack.photo.err.offline': 'Nessuna connessione. La foto non è stata inviata — riprova quando torni online.',
    'orders.pack.photo.err.notAllowed': 'In questo locale non puoi modificare i prodotti.',
    'orders.pack.photo.err.signedOut': 'Rientra con il tuo accesso e riprova.',
    'orders.pack.photo.err.photoOff': 'La lettura della confezione da foto è spenta per questo locale.',
    'orders.pack.photo.err.personLimit': 'Oggi hai letto molte foto. Riprova più tardi, oppure scrivi questa a mano.',
    'orders.pack.photo.err.venueLimit': 'Oggi in questo locale sono state lette molte foto. Riprova più tardi, oppure scrivi questa a mano.',
    'orders.pack.photo.err.noImages': 'Prima scatta una foto.',
    'orders.pack.photo.err.tooMany': 'Massimo 5 foto per volta.',
    'orders.pack.photo.err.tooLarge': 'Quelle foto sono troppo grandi. Rifalle un po’ più da vicino.',
    'orders.pack.photo.err.badImage': 'Non sono riuscito a preparare quella foto. Rifalla.',
    'orders.pack.photo.err.badFormat': 'L’app non riesce a leggere il formato di quella foto. Scattala con la fotocamera invece di prenderla dalla galleria.',
    'orders.pack.photo.err.nothingFound': 'In queste foto non ho trovato un elenco ingredienti. Prova con uno scatto più dritto e più vicino all’elenco stampato.',
    'orders.pack.photo.err.refused': 'Il lettore non ha voluto leggere questa foto. Se è davvero un elenco ingredienti, rifalla.',
    'orders.pack.photo.err.tooLong': 'Quell’elenco è troppo lungo per leggerlo in una volta. Fotografalo in due parti.',
    'orders.pack.photo.err.tooSlow': 'La lettura ha impiegato troppo ed è stata interrotta. Riprova con meno foto.',
    'orders.pack.photo.err.failed': 'Non sono riuscito a leggere la foto. Riprova.',
    'orders.pack.recognisedNothing': 'Non ha riconosciuto nessuna parola di allergene in questo testo. Questo NON vuol dire che non ce ne siano — leggi tu la confezione e spunta quello che dice.',
    'orders.pack.questionWhich': '«{word}» potrebbe essere {options} — la confezione non dice quale. Spuntalo tu se lo sai.',
    'orders.pack.questionVague': '«{word}» potrebbe nascondere un allergene. Chiedi al fornitore cosa contiene.',
    'orders.pack.questionCategory': 'La confezione dice «{word}» — una famiglia intera. La legge vuole quello preciso (quale frutto a guscio? quale cereale?), quindi non è stato spuntato niente. Chiedi al fornitore quale.',
    'orders.pack.stillYours': 'Questo spunta solo le caselle. Niente è dichiarato finché non spunti «Ho controllato la scheda tecnica del fornitore» e salvi.',
    'orders.per100G': 'Per 100 g',
    'orders.eGGalbani': 'es. Galbani',
    'orders.eGCasseBox': 'es. casse, scatola',
    'orders.noSupplier2': '— Nessun fornitore —',
    'orders.editIngredient': 'Modifica ingrediente',
    'orders.newIngredient': 'Nuovo ingrediente',
    'orders.orderUnit': 'Unità d’ordine',
    'orders.orderToPlaceToday': 'Ordine da fare oggi',
    'orders.ordersToPlaceToday': 'Ordini da fare oggi',
    'orders.thisDeviceDoesNot': 'Questo dispositivo non supporta le notifiche.',
    'orders.getAnAlertWhen': 'Ricevi un avviso quando un ordine è previsto (nel giorno d’ordine di un fornitore), quando si avvicina una festività, o quando una festività cade in un giorno di consegna. Nota: gli avvisi compaiono solo con l’app aperta.',
    'orders.notificationsAreOnFor': ' Le notifiche sono attive su questo dispositivo.',
    'orders.notificationsAreBlockedTurn': 'Le notifiche sono bloccate. Attivale per questa app nelle impostazioni del browser, poi ricarica.',
    'orders.enableNotifications': ' Attiva le notifiche',
    'orders.noSuppliersYet2': 'Ancora nessun fornitore',
    'orders.addYourSuppliersAnd': 'Aggiungi i tuoi fornitori e ingredienti dal pannello impostazioni (icona ingranaggio, in alto a destra).',
    'orders.nothingToSendThat': 'Niente da mandare — quell’ordine non ha voci.',
    'orders.nothingToSendFor': 'Niente da mandare per quel giorno.',
    'orders.orderUpdated': 'Ordine aggiornato ✓',
    'orders.couldNotUpdateThe': 'Non è stato possibile aggiornare l’ordine — controlla la rete e riprova.',
    'orders.orderDeleted': 'Ordine eliminato',
    'orders.couldNotDeleteThe': 'Non è stato possibile eliminare l’ordine — controlla la rete e riprova.',
    'orders.orderSent': 'Ordine mandato',
    'orders.markAsPlaced': 'Segna come fatto',
    'orders.nothingLeftToRecord': 'Non resta niente da registrare — quelle righe sono già fatte o vuote.',
    'orders.tryAgain': 'Riprova.',
    'orders.notRecordedRowsStillThere': '{names} — NON registrato, le righe sono ancora lì.',
    'orders.andSaved': '{names} salvato.',
    'orders.orderSavedToHistory': '{names} — ordine salvato nello storico ✓',
    'orders.savedButNotCleared': '{name} — ordine salvato nello Storico, ma non è stato possibile azzerare le righe. Ricarica la pagina; NON registrarlo di nuovo.',
    'orders.quantitiesClearedFor': 'Quantità azzerate per {n} fornitori ✓',
    'orders.checkExtraDigit': 'Controlla che non ci sia una cifra di troppo.',
    'orders.liveConnectionLost': 'Persa la connessione dal vivo per {what}. Quello che vedi potrebbe non essere aggiornato — ricarica la pagina.',
    'orders.noOrdersInTheLast': {
      one: 'Nessun ordine nell’ultimo giorno.',
      other: 'Nessun ordine negli ultimi {n} giorni.',
    },
    'orders.weekOf': 'Settimana del {day}',
    'orders.orderPlaced': 'Ordine fatto',
    'orders.noQuantitiesTypedYet': 'Ancora nessuna quantità inserita. Aggiungile prima.',
    'orders.recordTheseOrders': 'Registra questi ordini',
    'orders.nothingToRecordFor': 'Niente da registrare per questo fornitore — aggiungi prima le quantità.',
    'orders.youReOfflineReconnect': 'Sei offline — riconnettiti per registrare questo ordine.',
    'orders.couldNotSaveThe': 'Non è stato possibile salvare l’ordine — controlla la rete e riprova.',
    'orders.clearQuantities': 'Azzera le quantità',
    'orders.youReOfflineReconnect2': 'Sei offline — riconnettiti per azzerare queste quantità.',
    'orders.quantitiesCleared': 'Quantità azzerate ✓',
    'orders.couldNotClearThem': 'Non è stato possibile azzerarle — ricarica la pagina per vedere cosa è davvero salvato.',
    'orders.nothingTypedYet': 'Ancora niente inserito.',
    'orders.addToIt': 'Aggiungi',

    // ⚠️ LA SCHERMATA DI CONFERMA (js/orders/place-confirm.js).
    'orders.confirm.aboutToRecord': 'Sta per essere registrato:',
    'orders.confirm.addTitle': 'Aggiungi all’ordine',

    // ⚠️ NIENTE DI AGGIUNTO ALL’ORDINE CONDIVISO RESTA SCONOSCIUTO A CHI COMPRA.
    'orders.untold.changed': {
      one: '{supplier}: l’ordine è cambiato dopo l’ultimo invio — 1 aggiunta',
      other: '{supplier}: l’ordine è cambiato dopo l’ultimo invio — {n} aggiunte',
    },
    'orders.untold.resend': 'Rimanda la lista',
    'orders.alert.close': 'L’ho letto',
    'orders.alert.reopen': 'Rivedi gli avvisi',
    'orders.settings.openHistory': 'Ordini passati',
    'orders.untold.alreadyTitle': 'Era già stato ordinato',
    'orders.untold.alreadyLine': '{name} — ordinati {ordered}, adesso in lista {live}',
    'orders.untold.callSupplier': 'Se ne servono davvero, richiama il fornitore — l’app non può disdire una telefonata.',
    'orders.untold.asked': 'chiesti: {n}',
    'orders.untold.ordered': 'ordinati: {n}',
    'orders.confirm.asked': 'chiesti: {n}',
    'orders.confirm.usually': 'di solito circa {n}',
    'orders.confirm.addsToExisting': 'Per {supplier} c’è già un ordine registrato {when} — queste quantità ci verranno AGGIUNTE.',
    'orders.confirm.sendFirst': 'Manda prima l’ordine al fornitore — registrarlo azzera le righe.',
    'orders.confirm.allZero': 'Tutte le quantità sono a 0, quindi non c’è niente da registrare. Torna indietro per cambiarle, oppure esci da questa schermata.',
    'orders.confirm.noneRecorded': 'Per {names} non è stato registrato niente — tutte le quantità erano a 0.',
    'orders.couldNotUpdateThe2': 'Non è stato possibile aggiornare il giorno dell’ordine — controlla la rete e riprova.',
    'orders.couldNotDiscardThe': 'Non è stato possibile scartare l’ordine — controlla la rete e riprova.',
    'orders.couldNotSaveThe2': 'Non è stato possibile salvare l’ordine — controlla la rete. Tieni aperta questa pagina.',
    'orders.sendOrder': 'Manda l’ordine',
    'orders.noItemsInThis': 'Ancora nessuna voce in questo ordine. Aggiungi prima le quantità.',
    'orders.todaySOrdersAre': 'Gli ordini di oggi sono tutti fatti',
    'orders.orderToday': 'Ordina oggi',
    'orders.itSTodayS': 'È di oggi',
    'orders.unnamedProduct': 'Prodotto senza nome',
    'orders.messageFormat': 'Formato del messaggio',
    'orders.bySupplier': 'Per fornitore',
    'orders.oneList': 'Lista unica',
    'orders.selectAllSuppliers': 'Seleziona tutti i fornitori',
    'orders.nothingIsBeingOrdered': 'Non si sta ancora ordinando niente.',

    'orders.itemsCount': { one: '{n} voce', other: '{n} voci' },
    'orders.whatsappMessage': 'Messaggio WhatsApp',

    // ── La schermata Fornitori: le schede, su una pagina tutta loro ──────────
    'ui.contactsAndAllergens': 'Contatti e allergeni',
    'orders.productsCount': { one: '{n} prodotto', other: '{n} prodotti' },
    'orders.whatTheySell': 'Cosa vendono',
    'orders.deliveryShort': 'consegna',
    'orders.orderShort': 'ordine',
    'orders.notDeclaredShort': 'non dichiarato',
    'orders.registry.loadFailed': 'Non è stato possibile caricare i fornitori. Controlla la connessione e riprova.',
    'orders.registry.whichList': 'Quale elenco mostrare',
    'orders.eg.packWeight': 'es. 2.27kg',
    'orders.eg.ratePerKg': 'es. 7.20 (un chilo)',
    'orders.exVatNote': 'I prezzi sono al netto dell’IVA.',
    'orders.eg.ratePerLitre': 'es. 6.00 (un litro)',
    'orders.eg.ratePerPiece': 'es. 0.035 (un pezzo)',
    'orders.eg.pieceWeight': 'es. 0.055',
    'orders.ingredientsCount': { one: '{n} ingrediente', other: '{n} ingredienti' },

    // Le schede. ⚠️ Erano scritte in inglese dentro il codice, in una forma che il
    // controllo automatico non sapeva vedere.
    'orders.field.name': 'Nome',
    'orders.field.category': 'Categoria',
    'orders.field.email': 'Email',
    'orders.field.supplier': 'Fornitore',
    'orders.field.brand': 'Marca',
    'orders.field.weight': 'Peso',
    'ui.activate': 'Riattiva',
    'orders.deactivateConfirm': 'Sospendere «{name}»? Sparirà dalla schermata degli ordini. Puoi riattivarlo quando vuoi.',
    'orders.deleteConfirm': 'Eliminare «{name}» per sempre? Non si può annullare.',
    'orders.failed.save': 'Non è stato possibile salvare «{name}». Controlla la connessione e riprova.',
    'orders.failed.delete': 'Non è stato possibile eliminare «{name}». Controlla la connessione e riprova.',
    'orders.failed.deactivate': 'Non è stato possibile sospendere «{name}». Controlla la connessione e riprova.',
    'orders.failed.activate': 'Non è stato possibile riattivare «{name}». Controlla la connessione e riprova.',
    'orders.failed.load': 'Non è stato possibile caricare lo storico prezzi di «{name}». Controlla la connessione e riprova.',
    'orders.pricePerKg': 'Prezzo al kg ({currency})',
    'orders.pricePerLitre': 'Prezzo al litro ({currency})',
    'orders.pricePerPiece': 'Prezzo al pezzo ({currency})',
    'orders.priceGeneric': 'Prezzo ({currency})',
    'orders.nSuppliers': { one: '{n} fornitore', other: '{n} fornitori' },
    'orders.clearConfirm': 'Azzerare tutto quello che hai scritto per {who}?\n\nLe giacenze restano. Gli ordini già registrati nello Storico non vengono toccati.',
    'orders.discardTitle': 'Scartare l’ordine di {name}',
    'orders.discardConfirm': 'Cancellare le quantità scritte per {name}? Non sono salvate da nessuna parte e non si possono recuperare.',

    // ── Una lista d'ordine che una persona manda a un'altra ──────────────────
    'orders.request.someone': 'Qualcuno',
    'orders.request.sendToManager': 'Manda al manager',
    'orders.request.sending': 'Invio…',
    'orders.request.sent': 'Lista mandata ✓',
    'orders.request.sendFailed': 'La lista NON è stata mandata — è ancora qui. Controlla la connessione e riprova.',
    'orders.request.title': 'Liste d’ordine',
    'orders.request.open': 'Liste d’ordine',
    'orders.deliveries.tab': 'In arrivo',
    'orders.deliveries.owed': { one: '1 ordine di prima di questa settimana — è arrivato?',
                                other: '{n} ordini di prima di questa settimana — sono arrivati?' },
    'orders.weekStart.title': 'La settimana lavorativa',
    'orders.weekStart.hint': 'Da che giorno inizia la settimana. Decide cosa vuol dire «questa settimana» in In arrivo.',
    // ── Come esce un ordine dall'app ────────────────────────────────────────
    'orders.send.howTitle': 'Come mandiamo quest’ordine?',
    'orders.send.route.manager': 'A chi gestisce il locale, dentro l’app',
    'orders.send.route.whatsapp': 'WhatsApp — scelgo io la chat',
    'orders.send.route.whatsappSupplier': 'WhatsApp direttamente al fornitore',
    'orders.send.route.email': 'Email al fornitore',
    'orders.send.onePerSupplier': { one: 'un messaggio', other: 'un messaggio ciascuno — {n} chat' },
    'orders.send.noContact': { one: 'nessun recapito salvato per {names}',
                               other: 'nessun recapito salvato per {names}' },
    'orders.send.noRouteAvailable': 'Non c’è nessun modo di mandare quest’ordine. Chiedi a chi gestisce il locale di accenderne uno nelle Impostazioni.',
    'orders.send.emailSubject': 'Ordine da {name}',
    // Impostazioni
    'orders.send.settingsTitle': 'Come si possono mandare gli ordini',
    'orders.send.settingsHint': 'Cosa possono usare le persone che lavorano qui. Tu mantieni sempre tutte e quattro.',
    'orders.send.preferred': 'Proposto per primo',
    'orders.send.mustKeepOne': 'Almeno un modo di inviare deve restare acceso, altrimenti un ordine non potrebbe più uscire dall’app.',
    'orders.send.emailOpensApp': 'L’email apre la tua app di posta con l’ordine già pronto — non lo spedisce da sola.',
    // ── La seconda metà della vita di un ordine: la consegna ────────────────
    'orders.deliveries.late': 'In ritardo',
    'orders.deliveries.dueToday': 'Previsti oggi',
    'orders.deliveries.coming': 'In arrivo',
    'orders.deliveries.noneYet': 'Nessun ordine ancora effettuato.',
    'orders.deliveries.allArrived': 'Tutto quello che hai ordinato è arrivato.',
    'orders.deliveries.unknownSupplier': 'Fornitore eliminato',
    'orders.deliveries.expectedOn': 'Previsto {day}',
    'orders.deliveries.noExpectedDay': 'Nessun giorno di consegna impostato per questo fornitore',
    'orders.deliveries.orderedOn': { one: 'Ordinato {day} · {n} articolo',
                                     other: 'Ordinato {day} · {n} articoli' },
    'orders.deliveries.arrivedTitle': 'È arrivato da {supplier}?',
    'orders.deliveries.arrivedMessage': 'L’ordine effettuato il {day}.',
    'orders.deliveries.allArrivedBtn': 'È arrivato tutto',
    'orders.deliveries.somethingMissing': 'Manca qualcosa',
    'orders.deliveries.whatArrived': 'Cosa è arrivato?',
    'orders.deliveries.untickHint': 'Togli la spunta a ciò che NON è arrivato.',
    'orders.deliveries.saveArrival': 'Salva',
    'orders.deliveries.couldNotSave': 'Non salvato. Controlla la connessione e riprova.',
    'orders.reorder.count': { one: '1 ingrediente non è arrivato — da riordinare',
                              other: '{n} ingredienti non sono arrivati — da riordinare' },
    'orders.reorder.title': 'Da riordinare',
    'orders.reorder.message': 'Questi erano stati ordinati e non sono mai arrivati:',
    'orders.reorder.putBack': 'Rimetti nell’ordine',
    'orders.reorder.someSkipped': { one: '1 riga aveva già una quantità ed è stata lasciata com’era.',
                                    other: '{n} righe avevano già una quantità e sono state lasciate com’erano.' },
    'orders.request.waiting': {
      one: '{n} lista d’ordine da fare',
      other: '{n} liste d’ordine da fare',
    },
    'orders.request.from': 'Da {who}',
    'orders.request.progress': '{done} su {total}',
    'orders.request.allOrdered': 'Tutto ordinato',
    'orders.request.none': 'Nessuno ha ancora mandato una lista d’ordine.',
    'orders.request.noneHint': 'Scrivi un ordine, tocca la freccia Manda in alto, poi “Manda al manager”.',
    'orders.request.noneWaiting': 'Tutte le liste mandate sono state ordinate.',
    'orders.request.noneInWindow': {
      one: 'Nessuna lista nell’ultimo giorno',
      other: 'Nessuna lista negli ultimi {n} giorni',
    },
    'orders.request.showOlder': {
      one: 'Mostra le liste più vecchie ({n})',
      other: 'Mostra le liste più vecchie ({n})',
    },
    'orders.request.nowInList': 'adesso in lista: {n}',
    'orders.request.changedSince': 'Queste quantità sono cambiate nell’ordine condiviso dopo che la lista è stata mandata.',
    'orders.request.finish': 'Finito',
    'orders.request.finishTitle': 'Chiudere questa lista?',
    'orders.request.finishMessage': {
      one: 'Una riga non è spuntata. Chiudendo si spunta anche quella.',
      other: '{n} righe non sono spuntate. Chiudendo si spuntano anche quelle.',
    },
    'orders.request.markPlacedFor': 'Segna come ordinato — {supplier}',
    'orders.request.oneTitle': 'Lista d’ordine',
    'orders.request.noteLabel': 'Nota',
    'orders.request.delete': 'Elimina questa lista',
    'orders.request.deleteTitle': 'Eliminare questa lista?',
    'orders.request.deleteMessage': 'Sparisce per tutti. Quello che è già stato ordinato resta nello Storico.',
    'orders.request.deleteFailed': 'Non eliminata — la lista è ancora qui.',
    'orders.request.tickFailed': 'La spunta NON è stata salvata — controlla la connessione.',
    'orders.request.sentToManagers': 'Verrà avvisato chi gestisce il locale.',

    'calc.savedLocallyOnly': 'Salvato solo su questo telefono. L’app non è riuscita a raggiungere le impostazioni salvate online, quindi non ha mandato la modifica — così protegge i clienti e le ricette già salvati lì. Controlla la connessione e ricarica la pagina.',
    'calc.savedNotSent': 'Salvato su questo telefono, ma non ancora mandato agli altri telefoni — controlla la connessione.',
    'calc.empty.noRecipes.sub': 'Il Calcolatore calcola quanto impasto fare partendo da quello che hanno ordinato i tuoi clienti. Aggiungi la tua prima ricetta — i suoi ingredienti e le loro quantità — e diventa una linguetta qui sopra.',
    'calc.empty.noneShown.sub': 'Hai delle ricette, ma nessuna è impostata per comparire come linguetta. Scegli quali mostrare, fino a quattro.',
    'calc.empty.noProducts.sub': 'Ancora nessun prodotto in questa linguetta. Aggiungi i tuoi clienti, e i prodotti che comprano, nelle Impostazioni.',
    'calc.noClientsYet': 'Ancora nessun cliente. Un cliente è qualcuno per cui produci: aggiungine uno, poi elenca i prodotti che ordina e quanto pesa ciascuno.',
    'calc.prefillWindow.help': 'Da quali giorni di registri salvati il modulo d’ordine propone le quantità. Quasi sempre un ordine si fa su due giorni — alcuni prodotti il giorno prima, altri la mattina stessa — quindi “Ieri e oggi” è la scelta abituale.',
    'calc.byHand.help': 'Per le cose che questo cliente compra ma che non calcoli qui — pane tagliato dall’infornata di un altro cliente, per esempio. Compaiono nel messaggio e mai in un totale d’impasto, e il modulo d’ordine le lascia sempre vuote da riempire a mano.',
    'calc.otherProducts.help': 'Prodotti di altri clienti. Aggiungerne uno qui lo mette solo in questo messaggio — non cambia la rubrica.',
    'calc.typeItHere.help': 'Scrivilo qui. Va solo nel messaggio — mai in un calcolo d’impasto — e il modulo d’ordine lo lascia vuoto da riempire a mano.',
    'calc.clientOrders.empty': 'Niente per oggi né per i giorni successivi. Gli ordini già consegnati a un cliente stanno sotto Storico.',
    'calc.clientOrders.notRecorded': 'I numeri sono nel calcolatore, ma l’app non è riuscita a registrare che hai usato questo ordine. Continuerà a comparire come nuovo, e NON ti avviserà se il cliente lo cambia. Controlla la connessione.',
    'calc.cutoff.help': 'Un ordine per un giorno può essere mandato, e modificato, fino a quest’ora del giorno prima. I clienti vedono quest’ora sul loro schermo.',
    'calc.cutoff.empty': 'Lascialo vuoto per nessuna scadenza. Con una scadenza, i clienti possono ordinare da domani in poi ma mai per il giorno corrente, perché la sua scadenza è già passata.',


    'cat.everyRecipeCanBe': 'Ogni ricetta può avere un’etichetta.',
    'cat.linkTheseRowsFirst': 'Collega prima queste righe',
    'cat.aRecipeRowHas': 'Una riga di ricetta deve puntare a un ingrediente prima che si possa sapere qualcosa su di essa. Collegale dalla schermata della ricetta — la matita, poi la riga.',
    'cat.thenDeclareThese': 'Poi dichiara questi',
    'cat.declareTheseFirst': 'Dichiara prima questi',
    'cat.eachOneIsHolding': 'Ognuno sta bloccando questo numero di ricette. Compilali da Ordini → Ingredienti.',
    'cat.noRecipesYet': 'Ancora nessuna ricetta.',
    'cat.noneOfThe14': 'Nessuno dei 14',
    'cat.nothingInItYet': 'Ancora niente dentro',
    'cat.noName': '(senza nome)',
    'cat.fromTheSuppliersSpecifications': 'Dalle schede tecniche dei fornitori. Non copre quello che può aggiungere la tua cucina — banchi condivisi, attrezzature condivise, farina nell’aria.',
    'cat.noCostYetLink': 'Ancora nessun costo — collega gli ingredienti per dare un prezzo a questa ricetta.',
    'cat.fromTheSuppliersSpecifications2': 'Dalle schede tecniche dei fornitori. Non copre quello che può aggiungere la tua cucina.',
    'cat.makeALabel': 'Crea un’etichetta',
    'cat.writeTheMixingSteps': 'Scrivi i passaggi dell’impasto',
    'cat.aStepAtA': 'Un passaggio alla volta, con le quantità di questa ricetta, un timer e la velocità dell’impastatrice.',
    'cat.startAgainFromThe': 'Ricomincia dall’inizio',
    'cat.guidedMixing': 'Impasto guidato',
    'cat.viewRecipeFullScreen': 'Vedi la ricetta a schermo intero',
    'cat.exitFullScreen': 'Esci dallo schermo intero',
    'cat.totalDoughWeightIn': 'Peso totale dell’impasto in grammi',
    'cat.clearBackToBase': 'Azzera — torna alla ricetta base',
    'cat.thatIsAVery': 'È un’infornata molto grande',
    'cat.calculateRecipe': 'Vuoi calcolare la ricetta?',
    'cat.totalDoughWeight': 'Peso totale dell’impasto',
    'cat.importIntoCalculator': 'Importa nel Calcolatore',
    'cat.deleteRecipe': 'Elimina ricetta',
    'cat.makesACopyYou': 'Crea una copia che puoi modificare solo per il Calcolatore — la ricetta del ricettario resta intatta.',
    'cat.calculate': 'Calcola',
    'cat.recipe': 'Ricetta',
    'cat.cost': 'Costo',
    'cat.costOver': 'su {yield}',
    'cat.costOverLoss': 'su {yield} finiti ({pct}% persi da {from})',
    'cat.editTheSteps': 'Modifica i passaggi',
    'cat.nSteps': { one: '{n} passaggio', other: '{n} passaggi' },
    'cat.ofTimers': '{time} di timer',
    'cat.notInAnyStep': 'In nessun passaggio: {list}',
    'cat.notInAnyStepYet': 'Ancora in nessun passaggio: {list}',
    'cat.stepN': 'Passaggio {n}',
    'cat.timer': 'Timer',
    'cat.allergens': 'Allergeni',
    'cat.label': 'Etichetta',
    'cat.nothingToImport': 'Questa ricetta non ha ingredienti a peso, quindi non c’è niente da importare.',
    'cat.searchAnIngredient': 'Cerca un ingrediente…',
    'cat.sheet.declaredCount': '{n} ricette su {total} completamente dichiarate',
    'cat.sheet.blockedCount': {
      one: '{n} non può ancora avere un’etichetta.',
      other: '{n} non possono ancora avere un’etichetta.',
    },
    // Il soggetto è LA RICETTA, quindi femminile singolare — non «dichiarati».
    'cat.sheet.rowDeclared': 'dichiarata',
    'cat.sheet.rowNotDeclared': 'non dichiarata',
    'cat.sheet.theLawHere': 'Cosa richiede la legge qui',
    'cat.sheet.theSpecificOnes': 'I cereali e la frutta a guscio che la legge fa nominare uno per uno',
    'cat.sheet.namesFollowCountry':
      'Queste sono le parole che usa la legge {country}. Restano in quella lingua qualunque sia la lingua dell’app.',
    'cat.sheet.noCountry':
      'Nessuno ha detto in che paese vende questa attività, quindi l’app non può dire quali allergeni richiede la legge qui. Lo imposta il titolare quando crea l’attività.',
    'cat.andMore': '…e altri {n}',
    'cat.nRows': { one: '{n} riga', other: '{n} righe' },
    'cat.nRecipes': { one: '{n} ricetta', other: '{n} ricette' },
    'cat.moveStepUp': 'Sposta su il passaggio {n}',
    'cat.moveStepDown': 'Sposta giù il passaggio {n}',
    'cat.total': 'Totale',
    'cat.ingredient': 'Ingrediente',
    'cat.ingredients': 'Ingredienti',
    'cat.section.batch': 'Peso impasto',
    'cat.section.procedure': 'Procedimento',
    'cat.decl.title': 'Dichiarazione ingredienti',
    'cat.decl.blocked': 'Non ancora pronta — alcuni ingredienti sono da dichiarare. La casella allergeni qui sopra dice quali.',
    'cat.decl.caveat': 'Una bozza da controllare. L’app sa quello che le è stato detto: non può sapere di una sostituzione dell’ultimo minuto o di un fornitore che ha cambiato ricetta.',
    'cat.decl.copy': 'Copia',
    'cat.amount': 'Quantità',
    'cat.unit': 'Unità',
    'cat.removeIngredient': 'Togli l’ingrediente',
    'cat.addIngredient': '+ Aggiungi ingrediente',
    'cat.notWeighed': {
      one: '{n} ingrediente non viene pesato (pezzi / q.b.) — non è nel totale',
      other: '{n} ingredienti non vengono pesati (pezzi / q.b.) — non sono nel totale',
    },
    'cat.recipeName': 'Nome della ricetta',
    'cat.ingredientName': 'Nome dell’ingrediente',
    'cat.linkToAnIngredient': '+ Collega a un ingrediente',
    'cat.aRecipeThatNo': '→ una ricetta che non esiste più',
    'cat.anIngredientThatNo': '→ un ingrediente che non esiste più',
    'cat.pleaseEnterARecipe': 'Inserisci il nome della ricetta.',
    'cat.enterAnAmountFor': 'Inserisci una quantità per almeno un ingrediente.',
    'cat.addAtLeastOne': 'Aggiungi almeno un ingrediente con un nome.',
    'cat.saveRecipe': 'Vuoi salvare la ricetta?',
    'cat.saveTheseChanges': 'Vuoi salvare queste modifiche?',
    'cat.recipeSaved': 'Ricetta salvata.',
    'cat.recipeAdded': 'Ricetta aggiunta.',
    'cat.discardChanges': 'Vuoi scartare le modifiche?',
    'cat.youHaveUnsavedChanges': 'Hai modifiche non salvate. Vuoi scartarle?',
    'cat.rawDoughWeight': 'Impasto crudo',
    'cat.cookedDoughWeight': 'Impasto cotto',
    'cat.lossIs': 'Calo peso in cottura: {pct}%',
    'cat.lossNotYet': 'Calo peso in cottura: pesa l’impasto cotto per saperlo',
    'cat.lossStored': 'Calo peso in cottura: {pct}% — ripesa l’impasto per aggiornarlo',
    'cat.lossCookedHeavier': 'L’impasto cotto non può pesare più del crudo.',
    'cat.lossCapped': 'Salvato come {max}% — un calo totale renderebbe infinito il costo al chilo.',
    'cat.searchARecipe': 'Cerca una ricetta…',
    'cat.searchARecipeBy': 'Cerca una ricetta per nome',
    'cat.noRecipeMatchesYour': 'Nessuna ricetta corrisponde alla ricerca.',
    'cat.noRecipesYetTap': 'Ancora nessuna ricetta. Tocca + per aggiungerne una.',
    // ── Leggere una ricetta da una foto ────────────────────────────────────
    'cat.photo.entry': 'Leggi una ricetta da una foto',
    'cat.photo.fill': 'Compila da una foto',
    'cat.photo.replaceTitle': 'Parto da una foto?',
    'cat.photo.replaceBody': 'Quello che hai scritto qui verrà sostituito da ciò che dice la foto.',
    'cat.photo.replaceOk': 'Usa una foto',
    'cat.photo.setting': 'Leggi le ricette da una foto',
    'cat.photo.settingNote': 'Quando è attiva, una ricetta nuova può essere compilata da una foto. Ogni foto costa qualche centesimo del servizio di lettura.',
    'cat.photo.on': 'Attiva',
    'cat.photo.off': 'Spenta',
    'cat.photo.turnOnTitle': 'La attivo?',
    'cat.photo.turnOnBody': 'L’app leggerà per te una ricetta fotografata. Ogni foto costa qualche centesimo del servizio di lettura — circa 200 ricette per un paio di euro. Puoi rispegnerla quando vuoi.',
    'cat.photo.turnOn': 'Attiva',
    'cat.photo.turnOffTitle': 'La spengo?',
    'cat.photo.turnOffBody': 'In questo locale nessuno potrà più leggere una ricetta da una foto. Le ricette già salvate restano come sono.',
    'cat.photo.turnOff': 'Spegni',
    'cat.photo.nowOn': 'Lettura da foto attiva.',
    'cat.photo.nowOff': 'Lettura da foto spenta.',
    'cat.photo.err.photoOff': 'In questo locale la lettura da foto è spenta.',
    'cat.photo.title': 'Ricetta da una foto',
    'cat.photo.lead': 'Fotografa la ricetta e l’app la compila per te. La controlli e la salvi tu — finché non lo fai, non viene salvato niente.',
    'cat.photo.take': 'Scatta una foto',
    'cat.photo.addAnother': 'Aggiungi un’altra foto',
    'cat.photo.remove': 'Togli questa foto',
    'cat.photo.thumbAlt': 'La foto che hai scattato',
    'cat.photo.read': 'Leggi la ricetta',
    'cat.photo.reading': 'Sto leggendo…',
    'cat.photo.working': 'Sto leggendo la ricetta… ci vogliono pochi secondi.',
    'cat.photo.note': 'Controlla ogni quantità prima di salvare. Una foto può essere letta male, e un numero sbagliato sembra identico a uno giusto.',
    'cat.photo.capped': 'Elenco molto lungo — sono state tenute solo le prime 300 righe.',
    'cat.photo.err.offline': 'Nessuna connessione. La foto non è stata inviata — riprova quando torni online.',
    'cat.photo.err.notAllowed': 'In questo locale non puoi aggiungere ricette.',
    'cat.photo.err.signedOut': 'Rientra con il tuo accesso e riprova.',
    'cat.photo.err.personLimit': 'Oggi hai letto molte foto. Riprova più tardi, oppure scrivi questa a mano.',
    'cat.photo.err.venueLimit': 'Oggi in questo locale sono state lette molte foto. Riprova più tardi, oppure scrivi questa a mano.',
    'cat.photo.err.noImages': 'Prima scatta una foto.',
    'cat.photo.err.tooMany': 'Massimo 5 foto per volta.',
    'cat.photo.err.tooLarge': 'Quelle foto sono troppo grandi. Rifalle un po’ più da vicino.',
    'cat.photo.err.badImage': 'Non sono riuscito a preparare quella foto. Rifalla.',
    'cat.photo.err.badFormat': 'L’app non riesce a leggere il formato di quella foto. Scattala con la fotocamera invece di prenderla dalla galleria.',
    'cat.photo.err.nothingFound': 'In queste foto non ho trovato una ricetta. Prova con uno scatto più dritto e più vicino, con tutto l’elenco degli ingredienti nell’inquadratura.',
    'cat.photo.err.refused': 'Il lettore non ha voluto leggere questa foto. Se è davvero una ricetta, rifalla.',
    'cat.photo.err.tooLong': 'Quell’elenco è troppo lungo da leggere in una volta. Fotografalo in due parti.',
    'cat.photo.err.tooSlow': 'La lettura ha impiegato troppo ed è stata interrotta. Riprova con meno foto.',
    'cat.photo.err.failed': 'Non sono riuscito a leggere la foto. Riprova.',
    // ── La scheda allergeni di una ricetta ─────────────────────────────────
    'cat.alg.title': 'Allergeni',
    'cat.alg.notDeclared': 'non dichiarati',
    'cat.alg.declared': 'dichiarati',
    'cat.alg.notDeclaredCount': {
      one: '{n} ingrediente non è dichiarato — non si può fare un’etichetta',
      other: '{n} ingredienti non sono dichiarati — non si può fare un’etichetta',
    },
    'cat.alg.andMore': { one: '…e un altro', other: '…e altri {n}' },
    'cat.alg.soFar': 'Finora, dalle righe dichiarate: {list}. Questo NON è l’elenco completo.',
    'cat.alg.mayContain': 'Può contenere: {list}',
    'cat.alg.reason.notLinked': 'non collegato a un ingrediente',
    'cat.alg.reason.missingIngredient': 'collegato a un ingrediente che non esiste più',
    'cat.alg.reason.notDeclared': 'l’ingrediente collegato non ha ancora le informazioni sugli allergeni',
    'cat.alg.reason.missingRecipe': 'collegato a una ricetta che non esiste più',
    'cat.alg.reason.subIncomplete': 'la ricetta collegata non è dichiarata del tutto',
    'cat.alg.reason.cycle': 'questa ricetta contiene sé stessa',
    'cat.alg.reason.tooDeep': 'troppe ricette annidate una dentro l’altra',
    'cat.allergenSheet': 'Scheda allergeni',
    'cat.recipeCatalogue': 'Ricettario',
    'cat.editRecipe': 'Modifica ricetta',
    'cat.newRecipe': 'Nuova ricetta',
    'cat.mixingSteps': 'Passaggi dell’impasto',
    'cat.carryOnMixing': 'Vuoi continuare l’impasto?',
    'cat.carryOn': 'Continua',
    'cat.notNow': 'Non ora',
    'cat.thatMixIsNo': 'Quell’impasto non è più disponibile — ricomincialo.',
    'cat.itWasImportedInto': ' È stata importata nel Calcolatore — quella copia resta; se la vuoi togliere, rimuovila a parte nel Calcolatore.',
    'cat.deleteRecipe2': 'Vuoi eliminare la ricetta?',
    'cat.recipeDeleted': 'Ricetta eliminata.',
    'cat.importIntoCalculator2': 'Vuoi importarla nel Calcolatore?',
    'cat.importFailedCheckYour': 'Importazione non riuscita — controlla la connessione e riprova.',
    'cat.liveSyncInterruptedRecipes': 'Sincronizzazione interrotta — le ricette potrebbero non essere aggiornate.',
    'cat.batchWarning': 'Sono {weight} di impasto. Controlla la quantità prima di calcolare.',
    'cat.batchWarningVsRecipe': 'Sono {weight} di impasto — {times}× la ricetta come è scritta ({base}). Controlla la quantità prima di calcolare.',
    'cat.couldnTDeleteThe': 'Non è stato possibile eliminare la ricetta — controlla la connessione.',
    'cat.addTheFirstStep': 'Aggiungi il primo passaggio. Ognuno può portare ingredienti, un timer e una velocità dell’impastatrice.',
    'cat.everyIngredientIsIn': 'Ogni ingrediente è in un passaggio.',
    'cat.whoeverFollowsThisWill': 'A chi segue questa procedura non verrà detto di aggiungerli. Va bene se è voluto.',
    'cat.whatToDoE': 'Cosa fare — es. Aggiungi la farina e l’acqua',
    'cat.ingredientsToAdd': 'Ingredienti da aggiungere',
    'cat.mixerSpeed': 'Velocità dell’impastatrice',
    'cat.removeThisStep': 'Vuoi togliere questo passaggio?',
    'cat.noStepsYet': 'Ancora nessun passaggio',
    'cat.eGFinalDough': 'es. Temperatura finale dell’impasto 24-26 gradi',
    'cat.closingMessageShownWhen': 'Messaggio finale, mostrato quando l’impasto è finito',
    'cat.whenTheDoughIs': 'Quando l’impasto è finito',
    'cat.shownOnItsOwn': 'Mostrato da solo alla fine dell’impasto. Lascialo vuoto per nessun messaggio.',
    'cat.saveTheProcedure': 'Vuoi salvare la procedura?',
    'cat.procedureSaved': 'Procedura salvata.',
    'cat.theStepsYouHave': 'I passaggi che hai scritto non sono stati salvati.',
    'cat.addStep': '+ Aggiungi passaggio',
    'cat.noLongerInThe': 'Non è più nella ricetta',
    'cat.timeIsUpJust': 'Tempo scaduto — proprio ora.',
    'cat.progress': 'Passo {i} di {n}',
    'cat.progress.inline': 'passo {i} di {n}',
    'cat.resumeGuidedMix': 'Riprendi l’impasto guidato — {progress}',
    'cat.calculateFor': 'Calcolare {recipe} per {amount}?',
    'cat.copyIntoCalculator': 'Copiare “{name}” nel Calcolatore? Poi la puoi ritoccare lì senza cambiare il ricettario.',
    'cat.partWayThrough': 'Eri a metà di “{name}” — {progress}.',
    'cat.deleteRecipeQ': 'Eliminare “{name}”? Non si può annullare.',
    'cat.thisRecipe': 'questa ricetta',
    'cat.recipeWord': 'ricetta',
    'cat.nonScalableNote': {
      one: 'Nota: {list} usa un’unità che il Calcolatore non sa scalare (lavora solo in grammi) e non verrà importato.',
      other: 'Nota: {list} usano un’unità che il Calcolatore non sa scalare (lavora solo in grammi) e non verranno importati.',
    },
    'cat.updatedInCalculator': '“{name}” aggiornata nel Calcolatore.',
    'cat.addedToCalculator': '“{name}” aggiunta al Calcolatore.',
    'cat.couldNotSaveRecipe': 'Non è stato possibile salvare “{name}” — controlla la connessione.',
    'cat.stepWillBeRemoved': 'Il passo {n} verrà tolto dalla procedura.',
    'cat.procedureCanHold': 'Una procedura può contenere {n} passi.',
    'cat.stepsAndTimers': {
      one: '{n} passo · {duration} di timer',
      other: '{n} passi · {duration} di timer',
    },
    'cat.saveStepsFor': {
      one: 'Salvare {n} passo per “{name}”?',
      other: 'Salvare {n} passi per “{name}”?',
    },
    'cat.noProcedureFor': '“{name}” non avrà nessuna procedura guidata.',
    'cat.timeWasUpMinutes': {
      one: 'Il tempo è scaduto 1 minuto fa.',
      other: 'Il tempo è scaduto {n} minuti fa.',
    },
    'cat.timeWasUpHours': {
      one: 'Il tempo è scaduto più di un’ora fa.',
      other: 'Il tempo è scaduto più di {n} ore fa.',
    },
    'cat.youAreOn': 'Sei al {progress}. Ti aspetterà dove l’hai lasciato.',
    'cat.notPricedYet': {
      one: '{n} ingrediente non ha ancora un prezzo — questo costo è parziale',
      other: '{n} ingredienti non hanno ancora un prezzo — questo costo è parziale',
    },
    'cat.timeIsUp': 'Tempo scaduto.',
    'cat.startTheTimer': 'Avvia il timer',
    'cat.skipTheTimer': 'Salta il timer',
    'cat.running': 'In corso…',
    'cat.1Min': '+1 min',
    'cat.doneEarly': 'Fatto in anticipo',
    'cat.doneFinish': 'Fatto — concludi',
    'cat.doughFinished': 'Impasto finito',
    'cat.notInAnyStep': 'In nessun passaggio — controlla che siano entrati:',
    'cat.backToTheRecipe': 'Torna alla ricetta',
    'cat.itWillAlsoSend': 'Manderà anche una notifica se esci dall’app.',
    'cat.alsoTellMeIf': 'Avvisami anche se esco dall’app',
    'cat.otherwiseKeepThisScreen': 'Altrimenti tieni aperta questa schermata — la sveglia non può suonare da un’app chiusa.',
    'cat.keepThisScreenOpen': 'Tieni aperta questa schermata — la sveglia non può suonare se esci dall’app.',
    'cat.keepThisScreenOpen2': 'Tieni questa schermata aperta e accesa — la sveglia non può suonare se esci dall’app.',
    'cat.leaveTheGuidedMix': 'Vuoi uscire dall’impasto guidato?',
    'cat.searchAnIngredient': 'Cerca un ingrediente',
    'cat.noPriceYet': 'Ancora nessun prezzo',
    'cat.nothingMatchesYourSearch': 'Niente corrisponde alla ricerca.',
    'cat.noIngredientsYetAdd': 'Ancora nessun ingrediente — aggiungili negli Ordini, sotto Impostazioni.',
    'cat.linkTo': 'Collega a',
    'cat.removeTheLink': 'Togli il collegamento',
    'cat.nothingInThisRecipe': 'Niente in questa ricetta è ancora dichiarato',
    'cat.unknownIngredient': 'Ingrediente sconosciuto',
    'cat.notWeighedPiecesSpoons': 'non pesato (pezzi / cucchiai / a piacere)',
    'cat.partOfThisRecipe': 'Una parte di questa ricetta non ha ancora un prezzo',
    'past.tapThePencilTo': 'Tocca la matita per aggiungere.',
    'past.thatRowHasChanged': 'Quella riga è cambiata — controlla la lista.',
    'past.thatNameIsToo': 'Quel nome è troppo lungo.',
    'past.thatIsMorePastries': 'Sono più paste di quante ne possa contenere una giornata.',
    'past.thatCannotBeSaved': 'Non si può ancora salvare.',
    'past.pastryName': 'Nome della pasta',
    'past.removeThisPastry': 'Vuoi togliere questa pasta?',
    'past.discardChanges': 'Vuoi scartare le modifiche?',
    'past.addPastry': 'Aggiungi pasta',
    'past.anythingWorthRememberingAbout': 'Qualcosa da ricordare su questa giornata…',
    'past.couldnTRemoveThat': 'Non è stato possibile togliere quel registro — controlla la connessione.',
    'past.nothingWasProved': 'Non è stato messo niente a lievitare.',
    'past.removeThisRecord': 'Vuoi togliere questo registro?',
    'past.recordRemoved': 'Registro tolto.',
    'past.noRecordsYet': 'Ancora nessun registro.',
    'past.tapConfirmAtThe': 'Tocca Conferma in fondo a una giornata per conservarla.',
    'past.tomorrowToProve': 'Domani · da mettere',
    'past.toProve': 'Da mettere',
    'past.liveSyncInterruptedThese': 'Sincronizzazione interrotta — questi registri potrebbero non essere aggiornati.',
    'past.liveSyncInterruptedThis': 'Sincronizzazione interrotta — questa lista potrebbe non essere aggiornata.',
    'fc.onTarget': 'In linea con l’obiettivo',
    'fc.slightlyOverTarget': 'Poco sopra l’obiettivo',
    'fc.overTarget': 'Sopra l’obiettivo',
    'fc.notCostedYet': 'Non ancora costificato',
    'fc.foodCost': 'Food cost',
    'fc.partOfThisProduct': 'Una parte di questo prodotto non ha ancora un prezzo, quindi il food cost reale è più alto di questo.',
    'fc.productName': 'Nome del prodotto',
    'fc.chooseARecipe': '— Scegli una ricetta —',
    'fc.chooseAnItem': '— Scegli una voce —',
    'fc.removeRecipe': 'Togli la ricetta',
    'fc.removePackagingItem': 'Togli l’imballaggio',
    'fc.thisRecipeNoLonger': 'Questa ricetta non esiste più',
    'fc.thisRecipeIsNot': 'Questa ricetta non ha ancora un prezzo',
    'fc.thisItemNoLonger': 'Questa voce non esiste più',
    'fc.pricedByWeightSet': 'Prezzo a peso — impostalo come prezzo al pezzo negli Ordini per contarlo qui',
    'fc.choose': '— Scegli —',
    'fc.byThePiece': 'Al pezzo',
    'fc.byWeightPerKg': 'A peso (al kg)',
    'fc.howManyPiecesCome': 'Quanti pezzi escono da un’infornata',
    'fc.piecesPerBatch': 'Pezzi per infornata',
    'fc.howManyFinishedPieces': 'Quanti pezzi finiti fa un’infornata delle ricette qui sopra.',
    'fc.sellingPriceIncludingVat': 'Prezzo di vendita IVA inclusa',
    'fc.name': 'Nome',
    'fc.packaging': 'Imballaggio',
    'fc.sold': 'Venduto',
    'fc.sellingPriceVat': 'Prezzo di vendita, IVA inclusa ({currency})',
    'fc.anotherRate': 'Un’altra aliquota…',
    'fc.anotherVatRateAs': 'Un’altra aliquota IVA, in percentuale',
    'fc.foodCostTargetAs': 'Obiettivo di food cost, in percentuale',
    'fc.pleaseEnterAProduct': 'Inserisci il nome del prodotto.',
    'fc.saveProduct': 'Vuoi salvare il prodotto?',
    'fc.saveTheseChanges': 'Vuoi salvare queste modifiche?',
    'fc.productSaved': 'Prodotto salvato.',
    'fc.productAdded': 'Prodotto aggiunto.',
    'fc.deleteProduct': 'Vuoi eliminare il prodotto?',
    'fc.productDeleted': 'Prodotto eliminato.',
    'fc.discardChanges': 'Vuoi scartare le modifiche?',
    'fc.youHaveUnsavedChanges': 'Hai modifiche non salvate. Vuoi scartarle?',
    'fc.marginHistory': 'Storico dei margini',
    'fc.madeOf': 'Composto da',
    'fc.addRecipe': '+ Aggiungi ricetta',
    'fc.addPackaging': '+ Aggiungi imballaggio',
    'fc.boxesBagsRibbonAnything': 'Scatole, sacchetti, nastro — tutto ciò che si compra a pezzo. Aggiunge costo ma non peso.',
    'fc.howItIsSold': 'Come si vende',
    'fc.thePriceOnThe': 'Il prezzo sull’etichetta. L’app toglie l’IVA prima di calcolare il food cost.',
    'fc.vatRate': 'Aliquota IVA',
    'fc.foodCostTarget': 'Obiettivo di food cost (%)',
    'fc.theShareOfThe': 'La quota del prezzo netto che vuoi sia rappresentata dagli ingredienti. Lascia vuoto per nessun obiettivo.',
    'fc.deleteProduct2': 'Elimina prodotto',
    'fc.slightlyOver': 'Poco sopra',
    'fc.addProduct': '+ Aggiungi prodotto',
    'fc.noProductsYetAdd': 'Ancora nessun prodotto. Aggiungine uno per vedere quanto costa e quanto rende.',
    'fc.noTargetSet': 'Nessun obiettivo impostato',
    'fc.untitledProduct': 'Prodotto senza nome',
    'fc.productsAndMargins': 'Prodotti e margini',
    'fc.newProduct': 'Nuovo prodotto',
    'fc.loading': 'Caricamento…',
    'fc.couldNotLoadThe': 'Non è stato possibile caricare lo storico — controlla la connessione e riprova.',
    'fc.nothingRecordedYetA': 'Ancora niente registrato. Un punto viene aggiunto ogni volta che cambia il prezzo o la ricetta.',
    'fc.aPointIsRecorded': 'Un punto viene registrato quando cambia il prezzo o la ricetta — non quando i prezzi degli ingredienti si muovono, quindi una linea piatta qui non vuol dire che il margine sia rimasto uguale.',
    'fc.liveSyncInterruptedProducts': 'Sincronizzazione interrotta — i prodotti potrebbero non essere aggiornati.',
    'fc.addAtLeastOne': 'Aggiungi almeno una ricetta a questo prodotto',
    'fc.chooseWhetherThisIs': 'Scegli se si vende al pezzo o a peso',
    'fc.sayHowManyPieces': 'Indica quanti pezzi escono da un’infornata',
    'fc.chooseTheVatRate': 'Scegli l’aliquota IVA',
    'fc.enterTheSellingPrice': 'Inserisci il prezzo di vendita',
    'fc.theRecipesInThis': 'Le ricette di questo prodotto non hanno ancora un prezzo',
    'fc.theRecipesInThis2': 'Le ricette di questo prodotto non hanno ancora un peso',
    'fc.couldnTDeleteThe': 'Non è stato possibile eliminare il prodotto — controlla la connessione.',


    'calc.fieldsClearedThisIs': 'Campi azzerati — è un giorno nuovo.',
    'calc.resetAllFields': 'Vuoi azzerare tutti i campi?',
    'calc.numberOfCrates': 'Numero di casse',
    'calc.copied': 'Copiato ✓',
    'calc.copyRecipe': 'Copia la ricetta',
    'calc.fromOrders': 'Dagli ordini',
    'calc.fromATotal': 'Da un totale',
    'calc.bothOrdersTotal': 'Entrambi (ordini + totale)',
    'calc.discardThisNewRecipe': 'Vuoi scartare questa nuova ricetta? Non ci hai aggiunto niente.',
    'calc.pleaseGiveEveryRecipe': 'Dai a ogni ricetta un nome e almeno un ingrediente con un nome prima di salvare.',
    'calc.saveTheseChanges': 'Vuoi salvare queste modifiche?',
    'calc.couldNotSaveCheck': 'Salvataggio non riuscito. Controlla la connessione e riprova.',
    'calc.yourRecipesTheBase': 'Le tue ricette — la base del calcolatore. Toccane una per modificarla, o aggiungine una nuova. Fino a ',
    'calc.canShowAsCalculator': ' possono comparire come linguette del calcolatore.',
    'calc.shown': '  ·  mostrata',
    'calc.hidden': '  ·  nascosta',
    'calc.unnamedRecipe': 'Ricetta senza nome',
    'calc.deleteRecipe': 'Elimina ricetta',
    'calc.addRecipe': '+ Aggiungi ricetta',
    'calc.thisRecipeIsUsed': 'Questa ricetta è usata da ',
    'calc.deleteThe': 'Vuoi eliminare la ricetta ',
    'calc.recipe': '?',
    'calc.editRecipe': 'Modifica ricetta',
    'calc.recipeName': 'Nome della ricetta',
    'calc.calcLogic': 'Logica di calcolo',
    'calc.howItCalculates': 'Come calcola',
    'calc.addIngredient': '+ Aggiungi ingrediente',
    'calc.showTheAdjustKnob': 'Mostra la manopola di regolazione nella linguetta',
    'calc.recipesCanShowAs': ' ricette possono comparire come linguette insieme. Nascondine prima un’altra.',
    'calc.showAsACalculator': 'Mostra come linguetta del calcolatore (max ',
    'calc.removeIngredient': 'Togli ingrediente',
    'calc.thisIsTheLeavening': 'Questo è il lievito (lievito/lievito madre)',
    'calc.editTheseQuantitiesThe': 'Vuoi modificare queste quantità? La ricetta si aggiorna solo dopo averla salvata di nuovo.',
    'calc.noLogsToShow': 'Nessun registro da mostrare adesso — controlla le impostazioni del Registro (visibilità e durata).',
    'calc.noLogsYetCalculate': 'Ancora nessun registro. Calcola e conferma un impasto per salvarlo qui.',
    'calc.addLog': '+ Aggiungi registro',
    'calc.edited': ' (modificato)',
    'calc.versionHistory': 'Storico versioni',
    'calc.deleteLog': 'Elimina registro',
    'calc.editThisLog': 'Vuoi modificare questo registro?',
    'calc.deleteThis': 'Vuoi eliminare questo registro ',
    'calc.logThisCannotBe': '? Non si può annullare.',
    'calc.empty': '(vuoto)',
    'calc.occasionalClient': 'Cliente occasionale',
    'calc.occasional': '  ·  occasionale',
    'calc.extraDough': 'Impasto extra: ',
    'calc.noProductsEntered': 'Nessun prodotto inserito.',
    'calc.totalDough': 'Impasto totale',
    'calc.calculatedBy': 'Calcolato da: ',
    'calc.nameOptional': 'Nome (facoltativo)',
    'calc.calculatedBy2': 'Calcolato da',
    'calc.productsQuantitiesOnly': 'Prodotti — solo quantità',
    'calc.noProductsInThis': 'Nessun prodotto in questa categoria.',
    'calc.saveChanges': 'Salva le modifiche',
    'calc.saveTheseChangesAs': 'Vuoi salvare queste modifiche come nuova versione?',
    'calc.restoredFromV': 'Ripristinata dalla v',
    'calc.logNotFound': 'Registro non trovato.',
    'calc.editHistory': ' — storico modifiche',
    'calc.current': ' · attuale',
    'calc.allVersions': ' Tutte le versioni',
    'calc.restoreThisVersion': 'Ripristina questa versione',
    'calc.restoreThisVersionIt': 'Vuoi ripristinare questa versione? Viene aggiunta sopra come nuova versione attuale — lo storico resta.',
    'calc.noRecipesYetAdd': 'Ancora nessuna ricetta. Aggiungine una in Impostazioni → Ricette.',
    'calc.pickARecipeTo': 'Scegli una ricetta per inserire le quantità.',
    'calc.whenIsThisDough': 'Per quando è questo impasto?',
    'calc.totalDoughG': 'Impasto totale (g)',
    'calc.noProductsForThis': 'Nessun prodotto per questa ricetta.',
    'calc.saveLog': 'Salva il registro',
    'calc.saveThisLog': 'Vuoi salvare questo registro?',
    'calc.forEachRecipeChoose': 'Per ogni ricetta: scegli se i suoi registri compaiono nella lista Registro e per quanto restano. ',
    'calc.logsAreAlwaysKept': 'I registri restano sempre nel database — questo controlla solo la lista dentro l’app.',
    'calc.noProducts': 'Nessun prodotto',
    'calc.keepLogsVisible': 'Tieni visibili i registri',
    'calc.keepVisibleFor': 'Tieni visibile per',
    'calc.logDurationFor': 'Durata del registro per ',
    'calc.saveTheseLogSettings': 'Vuoi salvare queste impostazioni del registro?',
    'calc.setEveryQuantityIn': 'Vuoi rimettere a 0 tutte le quantità di questo ordine?',
    'calc.clearAll': 'Azzera tutto',
    'calc.noWhatsappListsOr': 'Ancora nessuna lista WhatsApp né cliente. Aggiungine una in Impostazioni → WhatsApp.',
    'calc.thisListHasNo': 'Questa lista non ha ancora clienti. Aggiungine in Impostazioni → WhatsApp.',
    'calc.sendOrder': 'Manda l’ordine',
    'calc.co.ordersChanged': {
      one: '{n} ordine è CAMBIATO da quando l’hai usato',
      other: '{n} ordini sono CAMBIATI da quando li hai usati',
    },
    'calc.co.ordersReceived': {
      one: '{n} ordine ricevuto dai tuoi clienti',
      other: '{n} ordini ricevuti dai tuoi clienti',
    },
    'calc.co.justNow': 'adesso',
    'calc.co.minAgo': '{n} min fa',
    'calc.co.hoursAgo': { one: '{n} ora fa', other: '{n} ore fa' },
    'calc.co.showOlder': 'Mostra gli ordini più vecchi (prima degli ultimi {n} giorni)',
    'calc.co.arrivedLate': 'È arrivato dopo le {cutoff}, il termine per quel giorno. Puoi usarlo lo stesso — ma è arrivato in ritardo.',
    'calc.co.clientGone': '{client} non è più nella tua rubrica, quindi non ci sono campi da riempire.',
    'calc.co.thisClient': 'Questo cliente',
    'calc.co.allLocked': {
      one: '{names} è già stato confermato, quindi le quantità sono bloccate. Tocca Modifica sulla scheda, poi inserisci l’ordine.',
      other: '{names} sono già stati confermati, quindi le quantità sono bloccate. Tocca Modifica sulla scheda, poi inserisci l’ordine.',
    },
    'calc.co.someLocked': {
      one: '{names} è confermato e resterà com’è.',
      other: '{names} sono confermati e resteranno come sono.',
    },
    'calc.co.putOrderIn': 'Inserire l’ordine di {client} nel calcolatore?',
    'calc.co.closeOrdersAt': 'Chiudere gli ordini alle {time} del giorno prima? Tutti i clienti lo vedono subito.',
    'calc.prefill.window.both': 'ieri o oggi',
    'calc.prefill.window.today': 'oggi',
    'calc.prefill.window.yesterday': 'ieri',
    'calc.prefill.nothingLogged': 'Niente registrato per questi clienti {when} — scrivi tu le quantità.',
    'calc.prefill.filled': {
      one: 'Una quantità inserita da quello che hai registrato {when} — controllala prima di mandare.',
      other: '{n} quantità inserite da quello che hai registrato {when} — controllale prima di mandare.',
    },
    'calc.shareText': 'Ciao {client}, puoi mandare il tuo ordine a {from} qui: {link}',
    'calc.us': 'noi',
    'calc.linkCopiedFor': 'Il link per ordinare di {client} è copiato. Incollalo in un messaggio.',
    'calc.copyThisLinkFor': 'Copia questo link e mandalo a {client}:\n\n{link}',
    'calc.clientCanSendOrders': '{client} può mandare gli ordini direttamente nell’app. Chiunque abbia il link può ordinare come questo cliente, quindi mandalo solo a lui.',
    'calc.replaceLinkWarning': 'Il link attuale di {client} smetterà di funzionare subito, anche su un telefono che lo sta usando in questo momento. Usa “Copia il link” se vuoi solo rimandarglielo.',
    'calc.stopClientOrdering': 'Impedire a {client} di mandare ordini attraverso l’app? Il suo link smetterà di funzionare. Gli ordini che ha già mandato restano.',
    'calc.alreadyInMessage': '“{name}” è già in questo messaggio.',
    'calc.untitledList': 'Lista senza nome',
    'calc.unnamedClient': 'Cliente senza nome',
    'calc.noOrdersToShare': 'Nessun ordine da condividere',
    'calc.sendTo': 'Manda a',
    'calc.allClientsTogether': 'Tutti i clienti insieme',
    'calc.orOneClient': 'Oppure un solo cliente',
    'calc.extraDough2': 'Impasto extra',
    'calc.extraDoughUnit': 'Unità dell’impasto extra',
    'calc.resetAllFields2': 'Azzera tutti i campi',
    'calc.loading': 'Caricamento…',
    'calc.fetchingTheRecipesSaved': 'Sto recuperando le ricette salvate per questo locale.',
    'calc.noRecipesYet': 'Ancora nessuna ricetta',
    'calc.addARecipe': 'Aggiungi una ricetta',
    'calc.noRecipeIsShown': 'Qui non è mostrata nessuna ricetta',
    'calc.chooseWhichToShow': 'Scegli quali mostrare',
    'calc.discardThisNewClient': 'Vuoi scartare questo nuovo cliente? Non ci hai aggiunto niente.',
    'calc.pleaseGiveEveryClient': 'Dai un nome a ogni cliente e a ogni prodotto prima di salvare.',
    'calc.addClient': '+ Aggiungi cliente',
    'calc.editClient': 'Modifica cliente',
    'calc.clientName': 'Nome del cliente',
    'calc.deleteClient': 'Elimina cliente',
    'calc.deleteThisClientAnd': 'Vuoi eliminare questo cliente e i suoi prodotti?',
    'calc.productsOrdered': 'Prodotti ordinati',
    'calc.addProduct': '+ Aggiungi prodotto',
    'calc.orderingLink': 'Link per ordinare',
    'calc.saveYourChangesFirst': 'Salva prima le modifiche — il link mostra a questo cliente i prodotti come sono salvati.',
    'calc.createALinkAnd': 'Crea un link e mandalo a questo cliente. Vedrà solo i suoi prodotti, e potrà ordinare senza password.',
    'calc.thisClientCannotOrder': 'Questo cliente non può ancora ordinare dall’app. Il titolare o un responsabile può abilitarlo.',
    'calc.copyLink': 'Copia il link',
    'calc.replaceWithANew': 'Sostituisci con un nuovo link',
    'calc.createOrderingLink': '+ Crea il link per ordinare',
    'calc.replaceThisLink': 'Vuoi sostituire questo link?',
    'calc.couldNotCreateThe': 'Non è stato possibile creare il link. Controlla la connessione e riprova.',
    'calc.turnOffOrdering': 'Disattiva gli ordini',
    'calc.turnOff': 'Disattiva',
    'calc.couldNotTurnIt': 'Non è stato possibile disattivarlo. Controlla la connessione e riprova.',
    'calc.productName': 'Nome del prodotto',
    'calc.weightInGrams': 'Peso in grammi',
    'calc.quantityType': 'Tipo di quantità',
    'calc.crateBox': 'Cassa',
    'calc.piecesPerCrate': 'Pezzi per cassa',
    'calc.removeProduct': 'Togli prodotto',
    'calc.pickWhichProductsEach': 'Scegli quali prodotti la casella divisore di ogni ricetta divide in casse. Niente viene diviso finché non lo spunti. Tocca Salva per applicare.',
    'calc.noProductsInThis3': 'Ancora nessun prodotto in questa linguetta.',
    'calc.untickAll': 'Togli tutte le spunte',
    'calc.discardUnsavedChanges': 'Vuoi scartare le modifiche non salvate?',
    'calc.pleaseNameThisClient': 'Dai un nome a questo cliente prima di salvare.',
    'calc.pleaseNameThisList': 'Dai un nome a questa lista prima di salvare.',
    'calc.whatsappLists': 'Liste WhatsApp',
    'calc.deleteList': 'Elimina lista',
    'calc.addList': '+ Aggiungi lista',
    'calc.fillTheOrderFrom': 'Riempi l’ordine da',
    'calc.deleteThisList': 'Vuoi eliminare questa lista?',
    'calc.deleteThisClient': 'Vuoi eliminare questo cliente?',
    'calc.editList': 'Modifica lista',
    'calc.listName': 'Nome della lista',
    'calc.clientsInThisList': 'Clienti in questa lista',
    'calc.addAClientThen': 'Aggiungi un cliente, poi aggiungi i prodotti da mandare per lui.',
    'calc.unknownClient': 'Cliente sconosciuto',
    'calc.nothingToSendYet': 'Ancora niente da mandare — tocca per aggiungere',
    'calc.removeClientFromList': 'Togli il cliente dalla lista',
    'calc.removeThisClientFrom': 'Vuoi togliere questo cliente dalla lista?',
    'calc.addClient2': 'Aggiungi cliente',
    'calc.noClientsYetAdd': 'Ancora nessun cliente. Aggiungili prima in Impostazioni → Clienti.',
    'calc.allClientsAreAlready': 'Tutti i clienti sono già in questa lista.',
    'calc.pickAClientTo': 'Scegli un cliente da aggiungere. Poi aggiungi i prodotti da mandare per lui.',
    'calc.productsToSend': 'Prodotti da mandare',
    'calc.noProductsYetAdd': 'Ancora nessun prodotto. Aggiungi prodotti dalla rubrica.',
    'calc.addedByHand': 'Aggiunto a mano',
    'calc.eGLoavesOf': 'es. Pagnotte di pane',
    'calc.extraLine': 'Riga extra ',
    'calc.removeLine': 'Togli riga',
    'calc.addToTheMessage': 'Aggiungi al messaggio',
    'calc.itsProducts': 'I suoi prodotti',
    'calc.otherProducts': 'Altri prodotti',
    'calc.everythingInTheAddress': 'Tutto quello che c’è in rubrica è già stato aggiunto.',
    'calc.noProductsInThe': 'Ancora nessun prodotto in rubrica.',
    'calc.addALineBy': 'Aggiungi una riga a mano',
    'calc.addThisLine': 'Aggiungi questa riga',
    'calc.notInTheAddress': 'Non è in rubrica?',
    'calc.youHaveUnsavedChanges': 'Hai modifiche non salvate. Vuoi uscire senza salvare? Le modifiche andranno perse.',
    'calc.stillComing': 'In arrivo',
    'calc.couldNotLoadThe': 'Non è stato possibile caricare gli ordini passati. Controlla la connessione e riprova.',
    'calc.wentIntoTheCalculator': 'È entrato nel calcolatore',
    'calc.neverPutIntoThe': 'Mai messo nel calcolatore',
    'calc.theClientSentThis': 'Il cliente ha mandato questo giorno vuoto — non ha chiesto niente.',
    'calc.note': 'Nota: ',
    'calc.thisClientChangedTheir': 'Questo cliente ha cambiato il suo ordine DOPO che l’hai messo nel calcolatore. I numeri qui sotto sono quelli nuovi.',
    'calc.nothingThisDayThe': 'Niente in questo giorno — il cliente ha mandato un ordine vuoto.',
    'calc.aLineAboveIs': 'Una riga qui sopra riguarda un prodotto che questo cliente non ha più, quindi non può entrare nel calcolatore. Rimettilo, oppure gestiscilo tu.',
    'calc.putTheNewOrder': 'Metti dentro il NUOVO ordine',
    'calc.putInTheCalculator': 'Rimettilo nel calcolatore',
    'calc.putInTheCalculator2': 'Metti nel calcolatore',
    'calc.noneOfThisClient': 'In questo momento nessuno dei prodotti di questo cliente è su una linguetta del calcolatore, quindi non c’è niente da riempire.',
    'calc.theseAlreadyHaveA': 'Qui c’è già scritto un numero diverso:',
    'calc.thisWillReplaceWhat': 'Questo sostituirà quello che è scritto',
    'calc.putItIn': 'Mettilo dentro',
    'calc.ordersCloseAt': 'Gli ordini chiudono alle',
    'calc.thatIsNotA': 'Questo non è un orario. Usa l’orologio, oppure lascialo vuoto per nessuna scadenza.',
    'calc.removeTheDeadlineClients': 'Vuoi togliere la scadenza? I clienti potranno ordinare per qualsiasi giorno, oggi compreso.',
    'calc.notSavedCheckYour': 'Non salvato. Controlla la connessione e riprova.',


    'weekday.monday': 'Lunedì',
    'weekday.tuesday': 'Martedì',
    'weekday.wednesday': 'Mercoledì',
    'weekday.thursday': 'Giovedì',
    'weekday.friday': 'Venerdì',
    'weekday.saturday': 'Sabato',
    'weekday.sunday': 'Domenica',
    'weekday.monday.short': 'Lun',
    'weekday.tuesday.short': 'Mar',
    'weekday.wednesday.short': 'Mer',
    'weekday.thursday.short': 'Gio',
    'weekday.friday.short': 'Ven',
    'weekday.saturday.short': 'Sab',
    'weekday.sunday.short': 'Dom',

    'past.confirm': 'Conferma',
    'past.records': 'Registri',
    'past.thisRow': 'questa riga',
    'past.newQuantityFor': 'Nuova quantità per {name}',
    'past.confirmNewQuantityFor': 'Conferma la nuova quantità per {name}',
    'past.hint.typeANumber': 'scrivi un numero',
    'past.hint.sameAsNow': 'come adesso',
    'past.hint.atLeastOne': 'almeno 1',
    'past.hint.tooMany': 'troppi',
    'past.onListTwice': '{name} è due volte in questa lista.',
    'past.howMany': 'Quanti {name}?',
    'past.mostItCanHold': '{n} è il massimo che può contenere.',
    'past.pastryPlaceholder': 'Pasta',
    'past.couldNotRecord': 'Non è stato possibile registrare {day} — controlla la connessione.',
    'past.removeRecordFor': 'Togli la registrazione di {day}, {date}',
    'past.removeRecordForQ': 'Togliere la registrazione di {day}, {date}? Non si può annullare.',
    'past.editDayQ': 'Modificare {day}?',
    'past.alreadyRecordedTonight': '{day} è già registrato per stanotte. Modificare queste quantità?',
    'past.keepAsRecord': 'Tenere questa lista come registrazione di {day}?',
    'past.nothingToProveRecord': '{day} non ha niente da far lievitare. Registrare così?',
    'past.tonightsRecordReplaced': 'La registrazione di stanotte per {day} verrà sostituita.',
    'past.willShowAsDone': '{day} risulterà fatto. Puoi ancora cambiarlo — te lo chiederà prima.',
    'past.couldNotSaveDay': 'Non è stato possibile salvare {day} — controlla la connessione.',
    'fc.perKg': 'al kg',
    'fc.perPiece': 'al pezzo',
    'fc.answerBasis': '{cost} per farlo {unit}  ·  {net} netto  ·  {margin} di margine',
    'fc.deleteProductQ': 'Eliminare “{name}”? Non si può annullare, e se ne va anche lo storico del margine.',
    'fc.thisProduct': 'questo prodotto',
    'fc.productWord': 'prodotto',
    'fc.histDetail': '{cost} di costo  ·  {price} con IVA al {vat}%',
    'fc.couldNotSaveProduct': 'Non è stato possibile salvare “{name}” — controlla la connessione.',
    'nc.sellsIn': 'Vende: {where}.',
    'nc.linkWorksOnce': 'Il link funziona una volta sola e ha {expiry}.',
    'nc.sectionsLine': 'Sezioni: {list}.',
    'nc.readyAndYours': '{name} è pronto, ed è tuo.',
    'nc.ready': '{name} è pronto.',
    'nc.openMyBusinesses': 'Apri le mie attività',
    'nc.linkCopiedFor': 'Il link per {name} è copiato. Incollalo in un messaggio da mandargli.',
    'nc.copyThisLinkFor': 'Copia questo link e mandalo a {name}:\n\n{link}',
    'co.cutoffNote': 'Gli ordini di un giorno chiudono alle {time} del giorno prima. Puoi modificare il tuo ordine fino ad allora.',
    'co.cutoffClosed': 'Gli ordini di un giorno chiudono alle {time} del giorno prima. Riprova più tardi.',
    'help.noOrdersInLastDays': 'Nessun ordine negli ultimi {n} giorni. I più vecchi sono comunque conservati — non si cancella mai niente.',
    'help.passwordTooShort': 'Falla di almeno {n} caratteri — è la lunghezza che la rende sicura.',
    'aria.whatIs': 'Che cos’è {screen}?',
    'past.nothingToProveFor': 'Ancora niente da mettere per {day}.',
    'past.removeRowFrom': 'Vuoi togliere {name} da {day}?',
    'past.saveDay': 'Vuoi salvare {day}?',
    'past.saveThese': { one: 'Vuoi salvare questa pasta per {day}?', other: 'Vuoi salvare queste {n} paste per {day}?' },
    'past.saveEmpty': '{day} non avrà niente da mettere. Vuoi salvare così?',
    'past.daySaved': '{day} salvato.',
    'past.unsavedFor': 'Hai modifiche non salvate per {day}. Vuoi scartarle?',
    'past.noteFor': 'Nota per {day}',
    'past.toProveFor': 'Da mettere per {day}',
    'past.noteStays': 'Nota — resta su {day} finché non la cambi',
    'past.confirmDay': 'Vuoi confermare {day}?',


    'ui.home': "Home",
    'ui.back': 'Indietro',
    'ui.send': 'Manda',
    'send.how': 'Come vuoi mandarlo?',
    'send.whatsapp': 'WhatsApp — scelgo io la chat',
    'send.email': 'Email',
    'send.emailOpensApp': 'Apre la tua app di posta con il testo già pronto — non lo manda.',
    'ui.listPair': '{a} e {b}',
    'aria.recipe': 'Ricetta',
    'ui.cancel': 'Annulla',
    'ui.delete': 'Elimina',
    'ui.discard': 'Scarta',
    'ui.edit': 'Modifica',
    'ui.clear': 'Azzera',
    'ui.reset': 'Reimposta',
    'ui.restore': 'Ripristina',
    'ui.replace': 'Sostituisci',
    'ui.deactivate': 'Disattiva',
    'ui.import': 'Importa',
    'ui.calculate': 'Calcola',
    'ui.leave': 'Esci',
    'ui.remove': 'Rimuovi',
    'ui.create': 'Crea',
    'ui.whatsNew': 'Novità',
    'install.hint.title': 'Aggiungi l’app al telefono',
    'install.hint.body': 'Sei dentro — ma l’app sta girando dentro il browser. Aggiungila alla schermata Home e si apre come tutte le altre app: a tutto schermo, con un tocco, e continua a funzionare anche quando manca la linea.',
    'install.hint.ok': 'Come si fa',
    'install.hint.later': 'Non ora',

    'install.stale.title': 'Reinstalla questa app',
    'install.stale.body': 'Questa app è stata aggiunta alla schermata Home tempo fa, e una parte di come funziona viene decisa in quel momento — un aggiornamento non può cambiarla.\n\nPer rimetterla in pari:\n1. Tieni premuta l’icona dell’app e scegli Disinstalla\n2. Riapri l’indirizzo nel browser\n3. Menu ⋮ → Installa app\n\nNon perdi niente: il tuo lavoro è salvato online, non dentro l’app. E se l’installazione non riesce, continua pure a usarla dal browser — funziona uguale.',
    'ui.confirm': 'Conferma',
    'ui.active': 'Attivo',
    'ui.paused': 'In pausa',
    'ui.lists': 'Liste',
    'ui.recipe': 'Ricetta',
    'ui.note': 'Nota',
    'ui.ingredients': 'Ingredienti',
    'price.byPiece': 'al pezzo',
    'cat.cost.noAmount': 'nessuna quantità',
    'cat.cost.notLinked': 'non collegato a un ingrediente',
    'cat.cost.missingIngredient': 'collegato a un ingrediente che non esiste più',
    'cat.cost.missingRecipe': 'collegato a una ricetta che non esiste più',
    'cat.cost.noPrice': 'l’ingrediente collegato non ha ancora un prezzo',
    'cat.cost.subNotCostable': 'la ricetta collegata non ha ancora un costo',
    'cat.cost.cycle': 'questa ricetta contiene sé stessa',
    'cat.cost.tooDeep': 'troppe ricette annidate una dentro l’altra',
    'cat.guided.speedN': 'Velocità {n}',
    'orders.allergen.notCheckedYet': 'Non ancora verificato — questo ingrediente blocca ogni etichetta in cui è usato. {note}',
    'orders.allergen.checkedOn': 'Verificato il {date} — {what}. {note}',
    'orders.allergen.checkedNoDate': 'Verificato — {what}. {note}',
    'orders.allergen.containsNone': 'non contiene nessuno dei 14',
    // ⚠️ «ha» e «tracce» sono le due colonne: sono istruzioni, non nomi di cibo.
    // Il nome dell'allergene dentro {name} arriva da js/market.js nella lingua del
    // PAESE, perché deve coincidere con l'etichetta stampata.
    'orders.allergen.has': 'ha',
    'orders.allergen.traces': 'tracce',
    'orders.allergen.containsTip': 'Contiene {name}',
    'orders.allergen.tracesTip': 'Può contenere tracce di {name}',
    'orders.nutritionStillEmpty': '{n} di {total} da compilare',
    'past.olderRecordsKept': {
      one: 'I record più vecchi restano — questa schermata mostra l’ultimo giorno.',
      other: 'I record più vecchi restano — questa schermata mostra gli ultimi {n} giorni.',
    },
    'ui.doughScaling': "Calcolo impasti",
    'ui.recipesKgScaling': "Ricette e scalatura in kg",
    'ui.thisWeeksOrder': "L’ordine della settimana",
    'ui.toProveForTomorrow': "Da mettere per domani",
    'ui.productsMargins': "Prodotti e margini",
    'ui.doughScalingFromOrders': "Calcolo impasti dagli ordini",
    'ui.recipes': "Ricette",
    'ui.settings': "Impostazioni",
    'ui.clients': "Clienti",
    'ui.clientsAndTheProducts': "I clienti e i prodotti che ciascuno ordina",
    'ui.addEditOrDelete': "Aggiungi, modifica o elimina ricette; scegli quali mostrare come linguette",
    'ui.whatsapp': "WhatsApp",
    'ui.buildOrderListsPick': "Crea liste d’ordine: scegli i clienti e i prodotti da mandare",
    'ui.showOrHideThe': "Mostra o nascondi la casella dell’impasto extra in ogni ricetta",
    'ui.clientOrdering': "Ordini dei clienti",
    'ui.whenOrdersSentFrom': "Quando chiudono gli ordini mandati dal link di un cliente",
    'ui.divisor': "Divisore",
    'ui.chooseWhichProductsThe': "Scegli quali prodotti divide la casella divisore, per ogni ricetta",
    'ui.log': "Registro",
    'ui.chooseWhichRecipesLogs': "Scegli di quali ricette mostrare i registri, e per quanto restano",
    'ui.showTheExtraDough': "Mostra la casella “Impasto extra” in ogni linguetta di ricetta. Tocca Salva per applicare le modifiche.",
    'ui.save': "Salva",
    'ui.ordersReceived': "Ordini ricevuti",
    'ui.marketOrder': "Ordine del mercato",
    'ui.chooseAList': "Scegli una lista",
    'ui.saveThisDoughFor': "Salva questo impasto per:",
    'ui.today': "Oggi",
    'ui.tomorrow': "Domani",
    'ui.editLog': "Modifica registro",
    'ui.addLog': "Aggiungi registro",
    'ui.editHistory': "Storico modifiche",
    'ui.supplierOrders': "Ordini ai fornitori",
    'ui.order': "Ordine",
    'orders.field.order': 'Ordine',
    'orders.field.stock': 'Giacenza',
    'orders.tab.suppliers': 'Fornitori',
    'orders.tab.ingredients': 'Ingredienti',
    'orders.tab.general': 'Generali',
    'orders.days': 'giorni',
    'orders.filter.all': 'Tutti ({n})',
    'orders.filter.ordering': 'Da ordinare ({n})',
    'orders.suggestedN': 'Suggerito: {n}',
    'orders.muchMoreThanUsual': 'Molto più del solito (circa {n})',
    'orders.alert.holidayTomorrow': 'Domani è festivo ({date}). Organizza gli ordini in anticipo.',
    'orders.alert.holidayInDays': {
      one: 'Fra {n} giorno è festivo ({date}). Organizza gli ordini in anticipo.',
      other: 'Fra {n} giorni è festivo ({date}). Organizza gli ordini in anticipo.',
    },
    'orders.alert.deliveryClash': 'Attenzione: {supplier} consegna il {day}, ma {date} è festivo — verifica la consegna.',
    'orders.mute.orderRequests': 'Non far suonare questo telefono per le liste d’ordine',
    'orders.mute.stillShown': 'La lista compare comunque nell’app — questo toglie solo l’avviso sonoro.',
    'orders.section.alerts': 'Avvisi',
    'orders.section.price': 'Prezzo',
    'orders.section.orderScreen': 'La schermata dell’ordine',
    'orders.section.howSent': 'Come si mandano gli ordini',
    // ── La scheda di un prodotto, in quattro sezioni ────────────────────────
    'orders.section.productData': 'Dati prodotto',
    'orders.section.allergens': 'Allergeni',
    'orders.section.packList': 'Elenco ingredienti',
    'orders.pack.filledIn': 'compilato',
    'orders.pack.toFillIn': 'da compilare',
    'orders.pack.proposedAfterCheck': {
      one: 'La verifica è decaduta: l’app ha cambiato {n} casella leggendo l’elenco. Controlla gli allergeni e spunta di nuovo «Ho controllato…».',
      other: 'La verifica è decaduta: l’app ha cambiato {n} caselle leggendo l’elenco. Controlla gli allergeni e spunta di nuovo «Ho controllato…».',
    },
    'orders.pack.checkVoided': 'La verifica è decaduta: l’app ha cambiato le caselle leggendo l’elenco. Controlla gli allergeni e spunta di nuovo «Ho controllato…».',
    'orders.pack.proposedTicks': {
      one: 'L’app ha spuntato {n} casella leggendo l’elenco ingredienti. Apri Allergeni e controllala.',
      other: 'L’app ha spuntato {n} caselle leggendo l’elenco ingredienti. Apri Allergeni e controllale.',
    },
    'orders.section.nutrition': 'Valori nutrizionali',
    // ── …e i due interruttori che decidono se le ultime due esistono ────────
    'orders.settings.ingredientCard': 'La scheda ingrediente',
    'orders.settings.cardNote': 'Cosa chiede la scheda di ogni prodotto. Vale per tutto il locale, non solo per questo telefono, e ha effetto dalla prossima schermata che apri.',
    'orders.settings.showAllergens': 'Gestisci gli allergeni',
    'orders.settings.showAllergensNote': 'Se lo spegni: niente caselle degli allergeni sul prodotto, niente riquadro allergeni sulla ricetta, niente scheda allergeni — e niente etichette, perché un’etichetta alimentare senza la riga degli allergeni è peggio di nessuna etichetta. Non viene cancellato niente di quello che hai già dichiarato.',
    'orders.settings.showNutrition': 'Gestisci i valori nutrizionali',
    'orders.settings.showNutritionNote': 'I valori per 100 g sul prodotto e la metà nutrizionale dell’etichetta. Non viene cancellato niente di quello che hai già scritto.',
    'orders.settings.packPhoto': 'Leggi la confezione da una foto',
    'orders.settings.packPhotoNote': 'Fotografa l’elenco ingredienti su una confezione e fattelo trascrivere. Ogni foto costa pochi centesimi del servizio di lettura. Spento finché non lo accendi tu.',
    'orders.settings.packPhotoOnTitle': 'Accendo la lettura da foto?',
    'orders.settings.packPhotoOnBody': 'L’app leggerà per te una confezione fotografata. Ogni foto costa pochi centesimi del servizio di lettura — circa 200 confezioni per un paio di sterline. Puoi spegnerlo quando vuoi.',
    'orders.settings.packPhotoTurnOn': 'Accendi',
    'orders.settings.offTitle': 'Spegnere gli allergeni?',
    'orders.settings.offBody': 'Spariscono le caselle degli allergeni, il riquadro allergeni su ogni ricetta, la scheda allergeni e le etichette, per tutti quelli che lavorano qui. Non viene cancellato niente — riaccendendolo torna ogni dichiarazione esattamente com’è.',
    'orders.settings.turnOff': 'Spegni',
    'ui.history': "Storico",
    'ui.orderPlaced': "Ordine fatto…",
    'ui.clearQuantities': "Azzera le quantità…",
    'ui.youReOfflineReconnect': "Sei offline — riconnettiti per caricare e salvare gli ordini.",


    'help.eachCardOpensOne': 'Ogni scheda apre una parte della giornata: cosa produrre, cosa comprare, quanto costa.',
    'help.yourWorkIsSaved': 'Il tuo lavoro si salva mentre lo fai — su questo telefono e online, così lo vede anche un altro telefono.',
    'help.everyScreenHasA': 'Ogni schermata ha un ? come questo. Spiega quella schermata in poche righe.',
    'help.aNumberOnA': 'Un numero su una scheda vuol dire che lì c’è qualcosa che ti aspetta.',
    'help.typeHowManyPieces': 'Scrivi quanti pezzi ha chiesto ogni cliente. L’app calcola l’impasto totale e ogni ingrediente.',
    'help.confirmSavesTheSheet': 'Conferma salva la scheda nel Registro e blocca i campi finché non tocchi Modifica.',
    'help.theFieldsEmptyThemselves': 'I campi si svuotano da soli a ogni nuovo giorno di lavoro — che comincia alle 4 del mattino, non a mezzanotte.',
    'help.ordersReceived': 'Ordini ricevuti',
    'help.ordersYourClientsTyped': 'Ordini che i tuoi clienti hanno scritto da soli, dal loro link.',
    'help.putInTheCalculator': '“Metti nel calcolatore” riempie per te le caselle delle quantità di quel cliente. Niente si muove finché non lo tocchi.',
    'help.ifAClientChanges': 'Se un cliente cambia un ordine DOPO che l’hai usato, questa schermata diventa rossa e te lo dice.',
    'help.ordersForDaysAlready': 'Gli ordini per giorni già passati non compaiono qui — questa schermata è quello che deve ancora arrivare.',
    'help.recipeCatalogue': 'Ricettario',
    'help.everyRecipeYouHave': 'Tutte le ricette che hai, con la ricerca. Aprine una e scalala a qualsiasi peso totale in kg.',
    'help.guidedMixingWalksA': 'L’impasto guidato ti accompagna passo per passo con i timer — tieni aperta quella schermata, o la sveglia non può suonare.',
    'help.linkARowTo': 'Collega una riga a un ingrediente e la ricetta può dirti quanto costa un chilo.',
    'help.ifOnlySomeRows': 'Se solo alcune righe sono collegate, il costo mostrato è di QUELLE righe — non dell’intera ricetta.',
    'help.whatToBuySupplier': 'Cosa comprare, fornitore per fornitore. Ordine è quanti te ne servono; Giacenza è quanti ne hai ancora.',
    'help.orderPlacedRecordsIt': '“Ordine fatto” lo registra e azzera la riga, così la schermata mostra sempre quello che resta da fare.',
    'help.suggestedAmountsComeFrom': 'Le quantità suggerite vengono dai tuoi ultimi 8 ordini di quella voce, quindi non vogliono dire niente finché non ne hai fatti alcuni.',
    'help.suppliersEverythingYouBuy': 'Tutto quello che compri e da chi lo compri. Tocca un fornitore per vedere i suoi dati e tutti i prodotti che vende; tocca un prodotto per aprire la sua scheda.',
    'help.suppliersAllergensLiveHere': 'Gli allergeni stanno sul PRODOTTO, non sulla ricetta — quindi dichiarare il latte sul tuo burro risponde per ogni ricetta che usa quel burro.',
    'help.suppliersPasteThePack': 'Incolla l’elenco ingredienti stampato sulla confezione e l’app spunta le caselle degli allergeni al posto tuo. Propone soltanto: il prodotto resta non dichiarato finché non metti tu la spunta «ho verificato».',
    'help.suppliersTurnThemOff': 'Impostazioni, in fondo, decide se questo locale usa gli allergeni e i valori nutrizionali. Spegnendo gli allergeni spariscono ovunque — anche dalle ricette e dalle etichette — e non viene cancellato niente.',
    'help.packWhenItCannotTell': 'Quando la confezione non dice quale — «frutta a guscio», «cereali», «lecitina» — non viene spuntato niente e la schermata te lo scrive sotto il riquadro. Chiedi al fornitore quale.',
    'help.allergensNameTheSpecific': 'Indica il cereale preciso e il frutto a guscio preciso: la legge vuole «grano», non «cereali», e «nocciole» non serve a chi può mangiare le mandorle.',
    'help.allergensUntilYouTick': 'Finché non spunti «Ho controllato la scheda tecnica del fornitore» e salvi, questo ingrediente blocca ogni etichetta in cui è usato. È la regola di sicurezza che funziona, non un guasto.',
    'help.nutritionComesFromThePack': 'I sette valori per 100 g, copiati dalla tabella stampata sulla confezione.',
    'help.nutritionZeroIsAnAnswer': 'Lo 0 è un valore vero, una casella vuota no: quando la confezione non lo dice, lasciala vuota invece di scrivere zero.',
    'help.nutritionItIsWhatThe': 'È quello che ha dichiarato il fornitore, non un calcolo — così un’etichetta si può sempre confrontare con la confezione da cui viene.',
    'help.foodCost': 'Food cost',
    'help.whatAProductCosts': 'Quanto costa produrre un prodotto, e quanto rende.',
    'help.typeTheSellingPrice': 'Scrivi il prezzo di vendita com’è sull’etichetta, CON l’IVA. L’app calcola il costo sul prezzo senza IVA.',
    'help.itIsOnlyRight': 'È corretto solo se gli ingredienti hanno un prezzo. Uno senza prezzo viene escluso, e il risultato esce troppo basso.',
    'help.whatToPutOut': 'Cosa mettere a lievitare, come una lista fissa per ogni giorno della settimana.',
    'help.confirmKeepsARecord': 'Conferma tiene un registro della nottata e blocca la lista fino alle 4.',
    'help.unlikeTheCalculatorA': 'A differenza del Calcolatore, un nuovo giorno NON la svuota: la lista è quello che fai di solito quel giorno della settimana.',
    'help.reinstallOnce': 'Se usi Misé dalla schermata Home, cancellala e riaggiungila una volta — una parte di un’app installata viene fissata quando la aggiungi, e nessun aggiornamento può raggiungerla.',
    'help.reinstallNothingLost': 'Non perdi niente: il tuo lavoro è salvato online, non dentro l’app.',
    'help.reinstallFromNowOn': 'Se l’installazione non riesce, continua pure dal browser — funziona uguale. D’ora in poi è l’app stessa ad avvisarti quando serve.',
    'help.acceptIsNowCalled': 'Accetta ora si chiama Conferma — la stessa parola che il Calcolatore usa per la stessa cosa.',
    'help.aConfirmedListShows': 'Una lista confermata risulta fatta, e i suoi numeri smettono di aprirsi, così niente cambia per sbaglio.',
    'help.toChangeItAnyway': 'Per cambiarla comunque, tocca Modifica o una riga qualsiasi e ti chiede conferma. Ogni lista si riapre da sola alle 4.',
    'help.tapAPastryTo': 'Tocca una pasta per cambiarne il numero: scrivi quello nuovo e tocca la spunta verde.',
    'help.theNoteAtThe': 'La nota in fondo a una giornata resta lì finché non la cambi — si scrive sotto la matita.',
    'help.tapAcceptWhenA': 'Tocca Accetta quando una lista è finita. Resta sotto Registri in fondo, per 15 giorni.',
    'help.aNewCardOn': 'Una nuova scheda sulla Home: le paste da mettere a lievitare, una lista per ogni giorno della settimana.',
    'help.itOpensOnThe': 'Si apre sul giorno PER cui stai facendo lievitare, così di notte hai già domani.',
    'help.tapAnyDayAlong': 'Tocca un giorno qualsiasi in alto per vedere o compilare quella lista; la matita modifica quella sullo schermo.',
    'help.tapTheListIcon': 'Tocca l’icona della lista accanto a un fornitore per vedere tutto quello che compri da lui.',
    'help.itIsAList': 'È una lista da guardare: niente caselle, così non si può scrivere niente in un ordine per sbaglio.',
    'help.tappingTheRestOf': 'Toccare il resto della riga apre comunque l’ordine, come prima.',
    'help.startAnOrderAgain': 'Ricomincia un ordine: “Azzera le quantità” dentro un fornitore, o in fondo alla linguetta Ordine per sceglierne diversi.',
    'help.whatYouCountedOn': 'Quello che hai contato sugli scaffali resta — si azzerano solo le quantità da ordinare.',
    'help.ordersAlreadyRecordedIn': 'Gli ordini già registrati nello Storico non vengono mai toccati.',
    'help.typeAQuantityFar': 'Scrivi una quantità molto più alta di quella che ordini di solito e la riga te lo dice, in rosso.',
    'help.recordingThatOrderAsks': 'Registrare quell’ordine ti chiede conferma, elencando quello che sembra una cifra di troppo.',
    'help.itStaysQuietOn': 'Resta in silenzio su un ingrediente ordinato meno di quattro volte: non c’è ancora una quantità abituale.',
    'help.historyOpensOnThe': 'Lo Storico si apre sugli ultimi 15 giorni, così gli ordini di questa settimana sono quelli sullo schermo.',
    'help.nothingHasBeenDeleted': 'Non è stato cancellato niente: tocca “Mostra ordini più vecchi” in fondo alla lista.',
    'help.changeHowFarBack': 'Cambia quanto indietro si apre in Impostazioni → Generali.',
    'help.signIn': 'Accedi',
    'help.theAppNowAsks': 'L’app ora chiede una email e una password. Resti collegato — non è tutti i giorni.',
    'help.forgotItTapForgot': 'L’hai dimenticata? Tocca “Password dimenticata?” sulla schermata di accesso e controlla la tua email.',
    'help.theHomeScreenShows': 'La schermata Home mostra su quale locale stai lavorando, sopra le schede.',
    'help.eachLocationSeesOnly': 'Ogni locale vede solo i propri fornitori, ingredienti, ordini e ricette.',
    'help.findAnIngredientBy': 'Trova un ingrediente per nome: tocca “Tutti gli ingredienti”. Non serve sapere di che fornitore è.',
    'help.ingredientsWithNoSupplier': 'Gli ingredienti senza fornitore (supermercato, cash & carry) ora si possono aggiungere e ordinare.',
    'help.sendTheOrderAs': 'Manda l’ordine come una lista della spesa unica, oppure diviso per fornitore come prima.',
    'help.theBarAtThe': 'La barra in fondo mostra cosa c’è nell’ordine — toccala per rivedere solo quelle voci.',
    'help.enterYourSurname': 'Inserisci il tuo cognome.',
    'help.enterYourFirstName': 'Inserisci il tuo nome.',
    'help.thatSurnameNeedsLetters': 'Quel cognome deve contenere delle lettere.',
    'help.thatFirstNameNeeds': 'Quel nome deve contenere delle lettere.',
    'help.chooseAPassword': 'Scegli una password.',
    'help.thatOneIsGuessed': 'Quella è la prima che si prova a indovinare. Scegli qualcosa a cui penseresti solo tu.',
    'help.thatIsOneCharacter': 'È un solo carattere ripetuto. Scegli qualcosa a cui penseresti solo tu.',
    'help.doNotUseYour': 'Non usare il tuo indirizzo email come password.',
    'help.updating': 'Aggiornamento…',
    'help.newVersionAvailableTap': 'Nuova versione disponibile — tocca per aggiornare',
    'help.updateTheAppTo': 'Aggiorna l’app per continuare',
    'help.theUpdateDidNot': 'L’aggiornamento non è andato a buon fine. Vale la pena riprovare — devono essere tutti sulla stessa versione. Quello che hai scritto è già salvato.',
    'help.aNewVersionIs': 'Una nuova versione è pronta e ci mette un momento a installarsi. Quello che hai scritto è già salvato.',
    'help.tryAgain': 'Riprova',
    'help.updateNow': 'Aggiorna ora',
    'help.continueWithoutUpdating': 'Continua senza aggiornare',
    'help.notificationsAreOnFor': 'Le notifiche sono attive su questo telefono.',
    'help.getToldWhenA': 'Fatti avvisare quando un timer finisce o un cliente manda un ordine, anche con l’app chiusa.',
    'help.notificationsAreBlockedFor': 'Le notifiche sono bloccate per questa app. Riattivale nelle impostazioni del telefono, poi ricarica.',
    'help.addThisAppTo': 'Aggiungi prima questa app alla schermata Home — su iPhone le notifiche funzionano solo dall’app installata, non da Safari.',
    'help.notificationsAreNotSet': 'Le notifiche non sono ancora configurate per questa app.',
    'help.thisPhoneCannotShow': 'Questo telefono non può mostrare notifiche.',
    'help.installApp': 'Installa l’app',
    'help.addToYourHome': 'Aggiungila alla schermata Home: tocca il pulsante Condividi, poi “Aggiungi a Home”.',
    'help.linkCopiedNowPaste': 'Link copiato — ora incollalo in Safari',
    'help.copyFailedLongPress': 'Copia non riuscita — tieni premuta la barra degli indirizzi per copiare',
    'help.gotIt': 'Capito',
    'help.yesterdayAndToday': 'Ieri e oggi',
    'help.yesterdayOnly': 'Solo ieri',
    'help.todayOnly': 'Solo oggi',
    'help.marketOrder': 'Ordine del mercato',
    'help.noClientHasSent': 'Nessun cliente ha ancora mandato un ordine. Quando succederà, sarà qui.',
    'help.addABusiness': '+ Aggiungi un’attività',
    'help.couldNotCheckYour': 'Non è stato possibile verificare il tuo accesso',
    'help.thisUsuallyMeansNo': 'Di solito vuol dire che manca la connessione. Controllala e riprova.',
    'help.unitedKingdom': 'Regno Unito',
    'help.italyLabelsInItalian': 'Italia — etichette in italiano',
    'help.theUnitedKingdomLabels': 'il Regno Unito — etichette in inglese',
    'help.createThisBusiness': 'Vuoi creare questa attività?',
    'help.createThisCustomer': 'Vuoi creare questo cliente?',
    'help.itWillBeCreated': 'Verrà creata NEL TUO account, come titolare.',
    'help.whoeverOpensTheLink': 'Chi apre il link ne diventa il titolare.',
    'help.creating': 'Creazione…',
    'help.youAreItsOwner': 'Ne sei il titolare. Sarà nel tuo elenco di attività.',
    'help.itIsNotStored': ' Non viene salvato da nessuna parte e non può essere mostrato di nuovo.',
    'help.copyTheLink': 'Copia il link',
    'nc.country.help': 'Decide la lingua in cui vengono stampate le sue etichette allergeni, e non si può ricavare dopo. La legge chiede un’etichetta nella lingua del paese in cui il cibo si vende.',


    'lang.title': 'Lingua dell’app',
    'lang.intro': 'La lingua che legge sullo schermo chi lavora qui.',
    'lang.use': 'Usa questa',
    'lang.inUse': 'In uso',
    'lang.saving': 'Salvataggio…',
    'lang.err.save': 'Non è stato possibile cambiare la lingua. Controlla la connessione e riprova.',
    'lang.labels': 'Le etichette allergeni non cambiano: sono prodotte in {language}, perché questa attività vende {country}. La legge chiede un’etichetta nella lingua del paese in cui il cibo si vende.',
    'lang.labels.noCountry': 'Questa attività non ha un paese impostato, quindi non può produrre nessuna etichetta allergeni. Il paese decide la lingua dell’etichetta, e non è una cosa che l’app possa indovinare.',


    'language.en.inSentence': 'inglese',
    'language.it.inSentence': 'italiano',
    'country.GB': 'Regno Unito',
    'country.IT': 'Italia',
    'country.GB.in': 'nel Regno Unito',
    'country.IT.in': 'in Italia',


    'label.whatItShows': 'Cosa mostra l’etichetta',
    'label.blocked': 'Non si può fare nessuna etichetta',
    'label.blocked.noWeights': 'Questa ricetta non ha ingredienti con un peso.',
    'label.blocked.allergensOff': 'Questo locale non gestisce gli allergeni, quindi l’app non può fare un’etichetta. Riaccendili in Fornitori e ingredienti → Impostazioni.',
    'label.blocked.notDeclared': {
      one: '{n} ingrediente non è dichiarato. La schermata della ricetta li elenca.',
      other: '{n} ingredienti non sono dichiarati. La schermata della ricetta li elenca.',
    },
    'label.onFinishedWeight': 'Calcolato sul peso finito — il {pct}% si perde in cottura.',
    'label.noNutrition': 'Nessuna tabella nutrizionale: almeno un ingrediente non ha ancora i valori per 100 g. Gli allergeni qui sopra sono comunque completi.',
    'label.caveat.title': 'Controlla questa etichetta prima di metterla sul cibo',
    'label.caveat.body': 'È costruita da quello che hanno dichiarato i fornitori e dalla ricetta come è scritta. Non può sapere niente della tua cucina — banchi condivisi, attrezzature condivise — né di una sostituzione fatta stamattina.',
    'label.copy': 'Copia il testo',
    'label.copied': 'Copiato',
    'label.copyFailed': 'Copia non riuscita — seleziona il testo qui sopra',
    // ⚠️ «Nutrizione» e non «Valori nutrizionali»: i tre pulsanti sono in fila e a
    // 320px il secondo andrebbe a capo da solo, lasciando la fila sbilanciata. La
    // parola dell’ETICHETTA resta «Valori nutrizionali» (js/market.js) — quello è
    // il titolo della tabella, questo è un pulsante.
    'label.shows.allergens': 'Allergeni',
    'label.shows.nutrition': 'Nutrizione',
    'label.shows.both': 'Entrambi',
    'label.untitled': 'Ricetta',
    'label.languageNote': 'Questa etichetta è prodotta in {language} perché questa attività vende {country}.',
    'label.ingredientNamesNote': 'I nomi degli ingredienti sono quelli che hai scritto tu — l’app non li traduce.',
    'label.blocked.noCountry': 'Non si può ancora fare nessuna etichetta: nessuno ha detto in che paese vende questa attività, ed è quello a decidere in che lingua l’etichetta va stampata. Il titolare può impostarlo quando crea l’attività.',
    'label.print': 'Stampa',
    'label.print.viaSystem': 'Finestra di stampa',
    'label.print.zplCopy': 'Copia il codice per la stampante',
    'label.print.zplCopied': 'Copiato — incollalo sulla stampante dal computer del negozio',
    'label.settings.printer': 'Stampante',
    'label.settings.printer.os': 'Qualunque stampante (finestra di stampa)',
    'label.settings.printer.zpl': 'Zebra (la sua lingua)',
    'label.settings.printerNote': 'Una Zebra compone il testo con i propri caratteri, molto più nitidi sulle etichette piccole. Su una Zebra gli allergeni si stampano in MAIUSCOLO, perché quel tipo di stampante non ha il grassetto — e l’anteprima li mostra allo stesso modo.',
    'label.settings.dpi': 'Risoluzione della stampante',
    'label.settings.dpiNote': 'È scritta sull’adesivo dietro la stampante. Col numero sbagliato l’etichetta esce di misura sbagliata anche se tutto il resto è giusto.',
    'label.preview.actualSize': 'Dimensione reale — {w} × {h} mm',
    'label.preview.scaled': '{w} × {h} mm — mostrata più piccola per stare nello schermo',
    'label.print.tooBig': 'Questa etichetta non ci sta su {w} × {h} mm a una dimensione che la legge consente di leggere. Usa etichette più grandi, oppure accorcia i nomi degli ingredienti. Niente viene mai accorciato per farlo entrare.',
    'label.print.noRoad': 'Questo dispositivo non può raggiungere una stampante. Apri questa etichetta su un computer che ha la stampante installata, oppure copia il testo qui sotto.',
    'label.settings.title': 'Stampa etichette',
    'label.settings.size': 'Misura dell’etichetta',
    'label.settings.custom': 'Misura personalizzata',
    'label.settings.width': 'Larghezza (mm)',
    'label.settings.height': 'Altezza (mm)',
    'label.settings.showDate': 'Lascia spazio per una data',
    'label.settings.showDateNote': 'Aggiunge una riga in fondo all’etichetta. La data si scrive al momento della stampa, perché appartiene alla produzione di oggi e non alla ricetta.',
    'label.settings.setup': 'Prima della prima stampa, imposta la misura dell’etichetta nel driver della stampante, e nella finestra di stampa metti i margini a nessuno e la scala al 100% — non «adatta alla pagina». Si fa una volta sola, e finché non è fatto la prima etichetta esce di misura sbagliata.',
    'label.settings.saveFailed': 'Salvataggio non riuscito — la modifica è stata rimessa com’era',


    'co.pageTitle': 'Manda il tuo ordine',
    'co.openTheLinkSent': 'Apri il link per ordinare che ti ha mandato il panificio.',
    'co.youCanChangeYour': 'Puoi modificare il tuo ordine finché il panificio non comincia a farlo.',
    'co.thisLinkIsIncomplete': 'Questo link è incompleto',
    'co.askTheBakeryTo': 'Chiedi al panificio di rimandarti il tuo link per ordinare.',
    'co.thisLinkIsNot': 'Questo link non è valido',
    'co.thisLinkNoLonger': 'Questo link non funziona più',
    'co.itMayHaveBeen': 'Potrebbe essere stato sostituito da uno più recente. Chiedi al panificio il link attuale.',
    'co.openYourOrderingLink': 'Apri il tuo link per ordinare',
    'co.useTheLinkThe': 'Usa il link che ti ha mandato il panificio. Una volta aperto, questa pagina ',
    'co.rememberYouOnThis': 'ti riconoscerà su questo dispositivo.',
    'co.loading': 'Caricamento…',
    'co.fetchingYourProducts': 'Sto recuperando i tuoi prodotti.',
    'co.thisLinkIsNot2': 'Questo link non è ancora attivo',
    'co.askTheBakeryTo2': 'Chiedi al panificio di mandarti un nuovo link per ordinare.',
    'co.couldNotLoadYour': 'Non è stato possibile caricare i tuoi prodotti',
    'co.thisUsuallyMeansNo': 'Di solito vuol dire che manca la connessione. Controllala e riprova.',
    'co.yourOrder': 'Il tuo ordine',
    'co.orderingIsClosedFor': 'Gli ordini sono chiusi per ora',
    'co.sending': 'Invio…',
    'co.thisOrderHasChanged': 'Questo ordine è cambiato da quando l’hai aperto. Ricarico…',
    'co.notSentCheckYour': 'Non mandato — controlla la connessione e riprova.',
    'co.orderSent': 'Ordine mandato',
    'co.changeThisOrder': 'Modifica questo ordine',
    'co.deliveryDay': 'Giorno di consegna',
    'co.yourProductListIs': 'La tua lista prodotti è vuota. Chiedi al panificio di aggiungere quello che ordini.',
    'co.howMany': 'Quanti',
    'co.anythingTheBakeryShould': 'Qualcosa che il panificio dovrebbe sapere (facoltativo)',
    'co.sendOrder': 'Manda l’ordine',
    'co.theLinkDidNot': 'Il link non diceva di quale panificio si tratta.',
    'co.deletedProduct': 'Prodotto eliminato',
    'co.thisClientCannotHave': 'Questo cliente non può avere un link per ordinare finché non è stato salvato.',
    'co.nothingThatDay': 'Hai detto al panificio che quel giorno non ti serve niente.',
    'co.sent.withCutoff': {
      one: '{n} articolo. Puoi modificarlo fino alle {time} del giorno prima.',
      other: '{n} articoli. Puoi modificarli fino alle {time} del giorno prima.',
    },
    'co.sent.noCutoff': {
      one: '{n} articolo. Puoi ancora modificarlo.',
      other: '{n} articoli. Puoi ancora modificarli.',
    },


    'people.noNameYet': '(ancora senza nome)',
    'people.you': ' · tu',
    'people.noEmailParen': '(nessuna email)',
    'price.byWeight': 'al kg',
    'price.byVolume': 'al litro',
    'price.none': 'Ancora nessun prezzo',
    'price.needPieceWeight': 'Aggiungi il peso di un pezzo per usarlo in una ricetta',

    'common.loading': 'Caricamento…',
  }),
});

// ── Which language is showing ────────────────────────────────────────────────

let current = DEFAULT_LANGUAGE;

// ⚠️ AN UNKNOWN LANGUAGE FALLS BACK TO ENGLISH RATHER THAN THROWING, and that is
// the opposite direction from countryOf() in js/market.js — deliberately. There,
// a wrong answer prints a non-compliant label; here, a wrong answer shows the
// wrong words to somebody who can see they are the wrong words. An app that
// refuses to open because a stored setting is odd is worse than an app in the
// wrong language.
// ⚠️ THE WORDS ALREADY ON SCREEN DO NOT REDRAW THEMSELVES. Every screen asks for
// its text when it paints, but the page headers and the Home cards come from the
// markup and are filled in ONCE, at DOMContentLoaded — long before the venue's
// own language arrives with the session. Without this the app switched to
// Italian everywhere except the words that had been there since load, which is
// the half-and-half screen this whole programme is meant to prevent.
//
// A list of listeners rather than a direct call into js/i18n-dom.js: this file is
// PURE and must not reach into the DOM, and the DOM half registers itself.
const listeners = new Set();

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLanguage(lang) {
  const next = LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  const changed = next !== current;
  current = next;
  if (changed) for (const fn of listeners) { try { fn(current); } catch { /* one screen must not stop the others */ } }
  return current;
}

export function currentLanguage() {
  return current;
}

// The language a venue's staff read, from the venue document. Separate from
// outputLanguage(location) in js/market.js, which reads `country` — the two
// fields are independent on purpose, because Federico's venues need them to
// disagree.
export function interfaceLanguage(location) {
  const value = location && location.language;
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

// ⚠️ THE SCREENS ABOVE EVERY VENUE HAVE NO SETTING TO READ, and this is what they
// use instead. Sign-in, "I have a join code" and the Misé home all happen before a
// location is open — the same reason the sign-in screen says «Mise» where every
// other screen says the venue's name. There is genuinely nothing to look up.
//
// The device's own language is the best signal available, and for the case this
// exists for it is a good one: an Italian buyer opening the app for the first time
// on an Italian phone should not be met in English.
//
// ⚠️ IT IS A GUESS, AND ONLY EVER APPLIES BEFORE SOMEBODY IS INSIDE. The venue's
// setting wins the moment a location opens, even when the two disagree — a venue
// whose staff read English stays English on an Italian phone. And neither of them
// ever reaches a label: that follows the country (js/market.js).
//
// ⚠️ IT TAKES THE TAG RATHER THAN READING `navigator`, so this file stays free of
// the DOM and every rule in it can be asserted under Node (P15). The caller passes
// navigator.language.
export function languageFromTag(tag) {
  const base = String(tag || '').toLowerCase().split('-')[0];
  return LANGUAGES.includes(base) ? base : DEFAULT_LANGUAGE;
}

// "A, B and C" — and the joiner is a WORD, which is the whole reason this lives here.
//
// ⚠️ IT WAS WRITTEN INTO THE CODE IN THREE PLACES, twice as `names.join(' and ')` and
// once inside the Orders screen's own listNames(). Italian says «e», and a joiner is
// invisible to every scan in this project: it is one word inside a template literal,
// with no capital letter to catch the eye.
//
// ⚠️ IT LIVES HERE RATHER THAN IN EITHER FEATURE because the two callers are the
// Calculator and Orders, and a feature may never import from another feature's folder.
// A copy of a sentence is a nuisance; a copy of the grammar is the thing that drifts.
export function joinList(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return t('ui.listPair', { a: list.slice(0, -1).join(', '), b: list[list.length - 1] });
}

// The tag to hand Intl for dates and numbers.
//
// ⚠️ IT FOLLOWS THE INTERFACE, AND SO DID THE HARDCODED 'en-GB' IT REPLACES —
// nobody chose that, it was simply the only language there was. A date is read by
// the same person reading the screen around it, so it belongs to the interface.
// 14 March and 14 marzo are the same day; nothing is decided by which is shown.
//
// ⚠️ A DATE ON A LABEL WOULD NOT COME THROUGH HERE, and there is none today. If
// one is ever added it follows the country, like every other word on a label.
export function localeTag(lang = current) {
  return lang === 'it' ? 'it-IT' : 'en-GB';
}

// ── Looking a phrase up ──────────────────────────────────────────────────────

function fill(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ));
}

function plural(entry, n, lang) {
  // Intl decides the category, so a language whose rules differ from English's
  // gets them right without anything here knowing about it.
  const rules = new Intl.PluralRules(lang === 'it' ? 'it-IT' : 'en-GB');
  const category = rules.select(n);
  return entry[category] !== undefined ? entry[category] : entry.other;
}

// ⚠️ TWO DIFFERENT FAILURES, ANSWERED TWO DIFFERENT WAYS, and telling them apart
// is what keeps a half-translated app usable AND keeps a typo findable:
//
//   the key is missing from THIS language but present in English
//     → the English phrase. A translation that has not been written yet must not
//       leave a blank on a working screen.
//
//   the key is missing from EVERY language
//     → the key itself, on screen. That is a programming mistake, not a
//       translation gap, and it must be LOUD. A silent empty string is a button
//       with no words on it that nobody notices until a customer does.
//
// ⚠️ THE LOOKUP TAKES ITS DICTIONARIES AS AN ARGUMENT, so it can be exercised
// against made-up phrases without the real ones being made writable. They are
// frozen on purpose — a screen that could edit the dictionary would be a screen
// that can change another screen's words — and loosening that to suit a test
// would be the test damaging the thing it is checking.
export function translate(dicts, lang, key, vars) {
  const entry = dicts[lang] && dicts[lang][key];
  const fallback = dicts[DEFAULT_LANGUAGE] && dicts[DEFAULT_LANGUAGE][key];
  const found = entry !== undefined ? entry : fallback;
  if (found === undefined) return key;

  const from = entry !== undefined ? lang : DEFAULT_LANGUAGE;
  const text = (typeof found === 'object' && found !== null)
    ? plural(found, vars && Number(vars.n), from)
    : found;
  return fill(text, vars);
}

export function t(key, vars) {
  return translate(DICTIONARIES, current, key, vars);
}

// Everything the dictionaries hold, for the tests that check the two languages
// carry the same keys and that no data word was translated. Not for the app.
export function _dictionaries() {
  return DICTIONARIES;
}
