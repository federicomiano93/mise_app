# Mise 2: plan for staff, join codes and kiosk (port-owed items 41-43)

Written 13 Nov 2026, for Federico to approve before any work starts. Nothing is built by this plan.

Items 41-43 of `docs/mise2-port-owed.md` were put off until after the switch (his decision, 8 Nov 2026). Until they are built:

- **new people cannot join** a venue (nobody can invite, nobody can type a code);
- **existing accounts work** as they do today;
- a lab tablet in **kiosk mode** stops resting and stops keeping its screen on.

---

## 1. What the current app has today

**«Who can get in» (People)** — in Home settings, only for the **full owner**.

- A list of everyone in the venue, owner first, then by name. Your own row has no buttons.
- On every other row:
  - **Change role** — a drop-down with six choices: owner, sales owner, kitchen owner, manager, head chef, employee. It asks first, with one sentence saying what the new role can do.
  - **Rename** — first and last name. A name changes nothing about what a person can do.
  - **Remove** — asks first, in red. Their phones stop getting notifications too.
- The server refuses to demote or remove the **last owner**.

**Invite someone, role first (#475)** — on the same screen.

- The role menu starts **empty**: «Choose a role…». Nothing can be sent until a role is picked.
- Two buttons:
  - **«Send a link»** — for any role. A link that lives 24 hours. Send opens the phone's share sheet with a message naming the venue; there is also Copy and Done.
  - **«Read out a code»** — six digits, for **employees only**. Shown big, with the role and the expiry time.
- Fix `ff7046a8`: a stray arrow key, or the iPhone's picker, could pick **Owner** by itself. Now it cannot.
- There is **no list of invitations sent** and **no way to cancel one**. A code dies when it is used, after 24 hours, or after 5 wrong tries.

**The join form** — what a new person sees.

- Reached three ways:
  - **«I have a join code»** on the sign-in screen;
  - the same button on the «No venue yet» screen;
  - **opening an invitation link**, which fills in the code by itself.
- Fields: first and last name; the code; for a new account, **email twice** and **password twice**.
- Fix `1a3567b9`: when a phone is already signed in, the form says **which account** the code will join, with «Sign in with a different account». The email is asked twice.
- Fix `9e0a2dac`: the form **stays on screen** while the code is being checked. Before, a refusal could land on a screen nobody could see. If the account was created but the code was refused, the form comes back for that account with the reason.
- After joining, the app opens the venue, and once only it shows the **install guide**.
- Someone already in a venue who opens a link is asked first, with the account named.

**Kiosk mode** — a setting of **one device** (the lab tablet), not of a person or a venue.

- Anyone can switch it on, from the **«This device»** card in Home settings (his decision, 7 Oct 2026). Choices: rest after **2, 5, 10 or 20 minutes**; screen off after **0, 1, 2 or 4 hours** of rest.
- After the rest time with no touch, a **black rest screen** shows the time, date, venue, work day, an offline line, and what to **order** and what **arrives** today. The order lines show only if this person may see Orders.
- The tap that wakes it **presses nothing** underneath.
- **Rest** and **Exit** buttons sit on the Home.
- **Keep the screen on (#406)**: the screen stays on while resting. The app never reloads under the rest screen; an update waits until the screen-off step.

**Not part of 41-43, but found here** — the **app-admin hub** (only you): «Customer businesses», **create a new business** and its owner link, re-send or delete it. See decision D10.

---

## 2. What Mise 2 has already

- The **five roles** and who can do what (built 9 Nov for the partial owners).
- The **join-code rules** (code length, lifetime, the limits), copied from the current app and checked against it by tests.
- The **kiosk order lines**: the logic is there, but nothing draws them yet.
- **Keep the screen on**, used today only by the Calculator's guided run and lab mode. It does not yet have #406's fix.
- A **«No venue yet»** screen, with Try again and Sign out, but **no code button**.
- **Settings** with «You», «The venue» and «Account». There is no «Who can get in» and no «This device» card.
- **Not there at all:** the join form, account sign-up, invitations, the people list, the rest screen, the kiosk settings, the install-guide door, the admin hub.

**No server change is needed.** The Cloud Functions that hire, change roles and check codes are shared by both apps and already live. The security rules stay as they are.

---

## 3. The slices

Each slice is **its own PR** into `feature/mise2-next` and **works on its own** on the preview and the emulator. They go riskiest first. In each one the tablet and the phone are checked in Italian and English.

Sizes: **S** = a short session, **M** = one session. **About five sessions in all.**

**Slice 1 — Join with a code or a link, already signed in (M).** *Riskiest: it touches the screens above a venue, where the 9e0a2dac race lived.*

- «No venue yet» gains **«I have a join code»**.
- The form asks for first and last name and the code, and says **which account** it will join (fix 1a3567b9).
- **Opening an invitation link** fills in the code. The link has the same shape as today, so links sent just before the switch still work.
- Someone **already in a venue** who opens a link is asked first, with the account named.
- The form **stays on screen** until the server answers. Refusals are said in the app's own words (fix 9e0a2dac).
- On success the venue opens.
- *Works on its own:* a code made today by the current app's People screen lets a new person into Mise 2.

**Slice 2 — Join with a new account (M).** *Second riskiest: Mise 2's first account creation.*

- The sign-in screen gains **«I have a join code»**.
- The form adds **email twice** and **password twice**.
- If the account is created but the code is refused, the form comes back **for that account**, with the reason.
- «Sign in instead» appears when the email already has an account.
- A door to the **install guide**, which stays the current app's own page, and the **one-time visit to it** after joining.
- *Works on its own:* a brand-new person joins from a link with no account.

**Slice 3 — Invite someone, role first (S).** *Small, but it hands out keys, including owner links.*

- A new row, **«Who can get in»**, in Settings → «The venue», for the **full owner only**.
- It opens the **invite card**: choose a role (**nothing chosen at the start**), then «Send a link» or, for an employee, «Read out a code».
- The result is shown **once**: big digits with role and expiry, or the link with **Send**, **Copy** and **Done**.
- *Works on its own:* the owner invites from Mise 2, and the person joins through slice 1 or 2.

**Slice 4 — The people list (M).**

- Under the invite card: everyone in the venue, owner first, then by name.
- On each row except your own: **change role**, **rename**, **remove**. Each asks first.
- Refusals are said plainly. For example: «This is the only owner. Make somebody else an owner first.»
- *Works on its own:* the owner runs the team without the current app.

**Slice 5 — Kiosk: this device, rest screen, screen kept on (M).**

- A fourth Settings card, **«This device»**, for everybody: kiosk on or off, rest time, screen-off time.
- It uses the **same saved setting** as today, so a tablet that is in kiosk mode at the switch stays in kiosk mode.
- The **black rest screen** shows time, date, venue, work day and offline. The waking tap presses nothing.
- The screen is **kept on** while resting, with **#406**: the app never reloads under the rest screen, and an update waits for the screen-off step.
- *Works on its own:* the lab tablet rests and stays on.

**Slice 6 — Kiosk: order lines and the Home buttons (S).**

- The rest screen gains **what to order** and **what arrives** today, only for a person who may see Orders.
- The Home gains **Rest now** and **Exit kiosk** while kiosk mode is on, above «Da fare».
- *Works on its own:* the full kiosk as today.

**When slices 1-4 are in, new people can join again. When 5-6 are in, the kiosk is back.** Then items 41-43 are ticked and their line leaves the deferred list.

---

## 4. Decisions for you (each changes what a person sees)

**D1. Where «Who can get in» lives.**

- Recommended: a row in **Settings → «The venue»**, shown **only to the full owner**.
- Why: it is the place for everything about the venue. The server already refuses anybody else, so the row only hides what they could not use.

**D2. How the role is chosen.**

- Today it is a drop-down. Recommended: a **short list of six choices**, each with the one-line meaning the current app already uses, **none chosen at the start**.
- Why: the iPhone picker and stray-key problems (`ff7046a8`) cannot happen with a list. And the owner sees what each role can do **before** sending, not only in the question afterwards.

**D3. Who may invite.**

- Recommended: **the full owner only, as today**. Managers, the sales owner and the kitchen owner cannot invite.
- Why: your 1 Nov decision. A partial owner who could hire could make a second account of their own the full owner.

**D4. Link or six digits.**

- Recommended: **keep both as today**. Six digits only for an employee; a manager or owner gets a link.
- Why: the security audit of 7 Oct. Six digits can be guessed; a link cannot.

**D5. A list of invitations sent, and cancelling one.**

- Recommended: **not now, as today**.
- Why: it needs new server code, and a code dies by itself in 24 hours. It can be a later change if you want it.

**D6. Sign-up asks the email twice and the password twice.**

- Recommended: **keep it**.
- Why: a mistyped email is an account nobody can get back into.

**D7. Kiosk for everybody, on a «This device» card.**

- Recommended: **keep it as today** (your 7 Oct decision), with the same choices of minutes and hours.
- Why: the tablet is used by whoever is on shift.

**D8. Rest and Exit on Mise 2's Home.**

- Recommended: a **band above «Da fare»**, like the holiday band, shown only while kiosk mode is on.

**D9. What the rest screen shows.**

- Recommended: **exactly what it shows today**. Nothing new.

**D10. The app-admin hub (creating a new customer's business). Not in 41-43, but it stops with the switch.**

- After the switch, the current app's pages are gone, so **you cannot create a new business from the app** until this is ported. Existing businesses are not affected.
- Recommended: **write it into the deferred list now**, so it is a known gap. Plan it as its own slice after 41-43 (about M; it uses the same four live functions).
- Until then, a new customer means **waiting** or **a one-off script**.

---

## 5. Security

**Who decides.**

- A person's role is one value per venue on their **account record**: employee (`true`), `'manager'`, `'owner'`, `'owner-sales'` or `'owner-kitchen'`.
- No phone may write that record. **Only the Cloud Functions do**, after checking who is asking.
- The «who can get in» list on screen is only a **display copy**. It grants nothing.
- **This plan changes no server code and no rule.** Mise 2 only calls the functions that are already live.

**Who can do what on the server** (unchanged):

- **Invite**, **change a role**, **remove**, **rename**: only an account whose value is exactly `'owner'`. Managers and partial owners are refused, whatever the app draws.
- The **last owner** can never be demoted or removed.
- A code **never lowers** someone already in the venue: it is refused, and the code is not spent.

**Join codes** (unchanged):

- **Six digits** for employees only; **links** (32 random characters) for any role.
- Live **24 hours**, used **once**. Two phones using one code at once: only one gets in.
- Only a **scrambled fingerprint** of the code is stored. The code is never written down or logged.
- **5 tries an hour** per account. Six-digit codes **pause for everybody** after 20 wrong tries in an hour; links keep working.
- The refusal never says whether a code existed, except «you are already in this venue» and «codes are paused, ask for a link».

**What Mise 2 must do itself:**

- **Read the link once** and take it **out of the address bar** before anything else runs, so it never reaches an error report, a usage line or the browser history. Forget it after joining, after Cancel, and on sign-out.
- **Never put a code** into an error report, a usage line or the console.
- **Hide** the owner-only screens from everybody else. This is cosmetic: the server is the lock. Specs check both.
- Kiosk is **device-only**. It writes nothing to the database, and its order lines follow the same «may see Orders» rule as today.

**Weak points found in the current server, NOT changed by this plan** (each would be its own decision):

- Anyone can **pause six-digit codes for everybody** with 20 wrong guesses in an hour. Links keep working.
- An owner can **remove another owner** (not the last one).
- The «last owner» check **counts the display list**, not the account records. A wrong display row could let the last real owner be demoted.
- Every member, employees included, can **read colleagues' emails** on the list.

Recommended: leave all four as they are during the port. Look at the third one later; it is the only one that could lock a venue out.

---

## For whoever builds it (not for approval)

- Current app: `js/staff/people.js` (People and the role-first invite), `js/roles.js` (the six choices and their sentences), `js/auth-gate.js` (`joinScreen`, `noAccessScreen`, the link reading and `pending-invite`), `js/join-hold.js`, `js/credentials.js` (`emailConfirmProblem`), `js/join-link.js`, `js/install-hint.js` (`just-joined`), `js/kiosk.js`, `js/kiosk-model.js`, `js/kiosk-orders.js`, `js/home-kiosk-band.js`, `js/wake-lock.js` (#406, `91b7f848`), `js/home-settings.js` («This device»).
- Server: `functions/onboarding.js` (`createJoinCode`, `redeemJoinCode`, `setMemberRole`, `setMemberName`), `functions/join-code.js`, `functions/digits-guard.js`. Rules: `users/{uid}` and `members` are written by no client; `join-codes` and `rate-limits` are read by no client.
- Mise 2 today: `shared/src/join-code.ts`, `shared/src/membership.ts`, `shared/src/kiosk-lines.ts`, `app/src/orders/kioskFeed.ts` (`kioskSections()`, no caller yet), `app/src/ui/wakeLock.ts`, `app/src/session/NoAccessScreen.tsx`, `app/src/session/SignInScreen.tsx`, `app/src/settings/`. `kiosk-` is already in `KEEP_PREFIXES`.
- The link is `index.html#join=<token>`: read before the hash router mounts, because `#join=` is not a route.
- Slice 5: the rest screen must hold `markBusy()` (or an equivalent the shell's reload asks), so neither the 30-second copy check nor a waiting service worker reloads under it.
- Each slice goes through the `mise2-check` gates and the code review before its PR.

---

## Staff slice 1 as built (13 Nov 2026)

Branch `feature/mise2-next-staff-1`, one PR into `feature/mise2-next`. No server, rules or current-app change: Mise 2 calls the live `redeemJoinCode`.

**What a person sees**

- **«No location yet»** says «If you were given a code, type it here.» (the current app's words) and has **«I have a join code»** above «Try again».
- **The join form**: «Enter your code» (or «You have been invited» with the code filled in), the sentence «The code will be used for this account:» with the email, «Sign in with a different account», first name, surname, code, **Join**, **Back**.
- **Every field is checked before anything is sent**: the empty or wrong one is outlined, the reason is under it, the cursor goes there.
- **While the code is checked** the form stays: «Checking…», the boxes read-only, Back and «Sign in with a different account» off. The gate keeps this form through every status the session passes meanwhile (`joinShown` + the ported `keepJoinForm`).
- **Refusals in the app's words**, Italian or English (`session/joinErrors.ts`): «That code does not work. Ask for a new one.» for every refusal of a code; «You are already in this business…»; «Six-digit codes are paused…»; and the new ones listed under «Choices made».
- **Success**: «You’re in. Opening…», then the venue opens, read from the server (no «No location yet» flash, no reload). From inside another venue it is a switch of venue (the phone's copy cleared, a reload).
- **A link opened by somebody with no venue** goes straight to the form, code filled in.
- **A link opened by somebody in a venue or on the venue picker** is a question: «You opened an invitation — Add this business to owner@…?», «Not now» / «Add it». «Add it» goes through the same «Not sent yet» and lab checks as switching venue, then the form replaces the app; Back brings the app back.
- **A link opened while signed out** waits: the sign-in screen as today; after signing in, the form or the question. (Joining with a NEW account is slice 2.)

**Security, as built**

- `session/joinLinkBoot.ts` is main.tsx's **first import** (pinned by `main.spec.ts`): the token is read and the address is rewritten with `history.replaceState` (same history entry, no Back to it) before the router or the telemetry exist. A malformed `#join=` is removed too. A link opened in a tab already running the app is caught on `popstate`/`hashchange` before the router's own listener: the entry the browser made becomes the screen the app was on, with the router's own history state, and the router is never told (an entry without its index would make it skip «Leave?» on a later Back). That entry stays as a copy of the screen before it: the first Back after such a link shows the same screen once more.
- **What no page can do**: the browser's own global history and address-bar suggestions keep the address it was asked to open, `#join=…` included (the plan's «never reaches the browser history» holds for the tab's Back history and the address bar, not for that list). The current app has the same exposure, for longer; a link is single use and dies in 24 hours.
- The invitation then lives in **sessionStorage `pending-invite`** (the current app's key and rule: survives the session's own reloads, dies with the window), validated on every read.
- **Forgotten**: the moment the server says yes; on Back, «Not now», Escape, «Stay»; on «already in this business»; on sign-out (`session.ts signOut` clears it first, and the gate forgets it whenever a signed-in session becomes signed-out, e.g. from another tab). A window that opens signed out keeps it for after the sign-in.
- **Never logged**: nothing in the flow writes to the console; the usage line names the screen `join` only. Specs install the real error reporter and watch every console method, uncaught errors, rejections and usage events: no code, no token.
- One call per tap (a ref, not only the button's pending look): each call spends one of the account's five tries an hour.
- The venue is opened only for the account that sent the code: a sign-out and another sign-in during the call move nothing.
- A newer invitation opened while a code is checked is kept (only the one that was used is forgotten).

**Choices made (not fixed by the plan)**

- «Sign in with a different account» **forgets the link** (the plan: «forget it on sign-out»). The person opens the link again after signing in. The current app carried it over; slice 2 may revisit with the sign-up form.
- «I have a join code» is a **secondary** full-width button above the primary «Try again» (the current app: a link above it).
- The invitation question **waits while anybody is typing** (`markBusy`), and «Add it» asks «Not sent yet» first when something has not reached the server: the join ends in a switch of venue.
- After the server's yes, if the venue cannot be opened on the page, the page reloads instead of reporting a failure (the join did happen).
- A new invitation opened while the form has unsent typing gets a fresh form (the typed names go), as in the current app.
- New texts (EN / IT): `join.tooManyMinutes` «Too many tries. Wait {n} minute(s) and try again.» / «Troppi tentativi. Aspetta {n} minuto/minuti e riprova.»; `join.tooMany` «Too many tries. Wait a while and try again.» / «Troppi tentativi. Aspetta un po’ e riprova.»; `join.offline` «Could not reach the server. Check the connection and try again.» / «Non riesco a raggiungere il server. Controlla la connessione e riprova.»; `join.failed` «Could not check the code. Try again in a moment.» / «Non è stato possibile controllare il codice. Riprova tra un momento.»; `join.opening` «You’re in. Opening…» / «Fatto, sei dentro. Sto aprendo…»; `join.discard.title` «Discard changes?» / «Vuoi scartare le modifiche?».

**Ported to shared (tests run against the `js/` originals)**: `join-hold` (full, paired), `join-link` (partial), `credentials` (partial, `nameProblem` returns the key).

**Not done here**: driving it on the emulator and a device (Federico, before merge); the install-guide door and the one-time visit (slice 2); the sign-in screen's «I have a join code» (slice 2).

---

## Staff slice 2 as built (13 Nov 2026)

Branch `feature/mise2-next-staff-2`, one PR into `feature/mise2-next`. No server, rules or current-app change: Mise 2 creates the account with Firebase Auth (as `js/firebase.js` `signUp` does) and calls the live `redeemJoinCode`.

**What a person sees**

- **The sign-in screen**, under the form and a thin line: **«I have a join code»** (a full-width secondary button) and **«How to install the app»** (a link to the current app's own `install-guide.html`, at the site's root, before and after the switch).
- **The join form for a new account** (signed out): «Join with a code» / «Create your account, then type the code you were given.», or «You have been invited» / «Your code is already filled in. Add your name and choose a password.» when a link brought it. Boxes: first name, surname, «Your email», «Repeat your email», «Choose a password (at least 10 characters)», «Repeat the password», Code. Under **Join**: «How to install the app» and **Back**. No account line and no «Sign in with a different account»: nobody is signed in.
- **Every box is checked before anything is sent**, in the order drawn: names; email given; the two emails the same (trimmed, capitals ignored, as Firebase compares them); the password (at least 10 characters, not one of the obvious ones even with `@` for `a` and `0` for `o`, not one character repeated, not the email's name); the two passwords the same (exactly); the code's shape. The wrong box is outlined, the reason is under it, the cursor goes there. **Nothing is created** until all of it passes: a sign-up cannot be undone from the form.
- **While it runs**: «Creating your account…», then «Checking your code…», then «You’re in. Opening…»; the boxes read-only, Back off. The form stays on screen through every move its own sign-up causes (signed-out → loading → …).
- **The email already has an account**: said on the email box («That email already has an account. Sign in with it instead.»), and **«Sign in with that email»** appears under the form. It opens the sign-in screen with that address filled in and the cursor in the password box. Typing another address takes the button away again.
- **The account was created but the code refused**: the form comes back **for that account** — «The code will be used for this account:» with the new email, «Sign in with a different account», the email and password boxes gone, the name and the code still in their boxes, the refusal in the app's words (slice 1's sentences), tied to the code box, the cursor in it. «Join» again checks the code again for that same account; no second account is ever asked for.
- **Success**: the page starts again on the new venue (as the current app does). On the Home, once, after a short moment: **«Add the app to your phone»** — «Show me how» opens the current app's guide page, «Not now» closes it. Not asked on an installed app (and then forgotten), never asked twice.
- **A link opened with nobody signed in** goes straight to this form, code filled in. **Back** goes to the sign-in screen and **keeps the invitation**: the screen says «Sign in, and we will add the business to your account.», and after the sign-in slice 1 takes over (the form for somebody with no venue, the question for somebody in one). «I have a join code» on that sign-in screen opens the form again with the code filled in.
- **Every join marks the guide**, slice 1's too (an existing account joining another venue), as the current app's every join does.

**Security, as built**

- **The new account's sign-in is held** (`session.ts` `signUpHeld`). An ordinary sign-in by somebody other than whose data this phone holds wipes that copy and reloads at once (Mise 2 asks at every sign-in, not only at boot); for a sign-up that reload would cut the code's check off or throw away the form that must come back with the refusal. While held, the session only notes the account (`loading`) and reads nothing: a brand-new account has no `users/{uid}` and every rule refuses it. A **yes** then runs the same check itself — clears localStorage outside `KEEP_PREFIXES`, wipes the previous person's offline copy if there is one (owner recorded only after a clear that worked; a busy database tried once more at the next opening), remembers the venue, marks `just-joined` **after** the last clear — and reloads. **Leaving the form** (Back, «Sign in with a different account», a new invitation) releases the hold and the account is resolved as any sign-in (normally «No location yet», or a wipe and a reload first). A sign-out ends the hold. Once the yes has started the reload, nothing more is resolved on that page (`joinReloading`): the form closing behind it must not run a sign-in on a stopped Firestore (code review).
- **While the form is being sent, the guide's link is off too** (`aria-disabled`, a tap does nothing): leaving the page then would cut the join off half-way.
- **Somebody signed in from another tab** while the new-account form is up: the form is opened again as the form for that account (invitation still filled in), so no sign-up can replace their session.
- **The passwords** go to Firebase and nowhere else, and are dropped from the form's memory the moment the account exists. The email «Sign in with that email» carries lives in memory only, never in storage.
- **One sign-up and one code check per tap** (a ref, as slice 1), and none at all before every box passes.
- **The password rule is the app's, not the server's** (as in the current app): Firebase's own floor is 6 characters. It stops the ordinary `123456`, not somebody talking to Firebase directly. `auth.err.weakPassword` (Firebase's 6) is kept for that case.
- Specs watch every console method, the real error reporter and the usage events while a new account joins: no code, no token, no password.

**Choices made (not fixed by the plan)**

- **Back from the new-account form keeps a link's invitation** and goes to sign-in (the current app's way). Everywhere else Back still forgets it (slice 1). Reason: whoever opens a link signed out but already has an account (an owner on a new phone) gets to the sign-in screen by Back, and must not lose the link on the way.
- **«Sign in with that email» fills in the address** and puts the cursor in the password box (the current app shows an empty sign-in form).
- **Firebase's refusals are said on the box they are about** (taken or malformed email on the email box, a weak password on the password box); no connection or too many tries are said in the form's alert.
- **The sign-in screen's two doors** sit under a thin line below the form: «I have a join code» as a full-width secondary button, the install guide as a link (the current app: two small links).
- **The guide question waits 0.6 s** after the Home opens, and is spent the moment it is shown.
- **Slice 1's open choice, looked at again — recommended, NOT changed:** «Sign in with a different account» on the join form still forgets the link. Now that a link held while signed out opens the new-account form, keeping it would take the person straight to «create an account, or Back to sign in» for that link — the current app's behaviour — instead of making them open the link again. Recommended: keep it, on the join form's button only (never on «Log out»). Left as built until Federico decides.
- **A typed six-digit code is not carried over** by «Sign in with that email» or Back (only a link is): the person types it again after signing in, on «No location yet». As in the current app. Somebody whose existing account is already in another venue has no code box in Mise 2 (nor in the current app); six digits are for new employees.

**Also in this PR: a defect found while driving slice 1.** Every change of venue (`switchLocation`, and `openJoinedVenue` from inside a venue) stopped Firestore (`wipeOfflineCache` → `terminate()`) while the sections' listeners were live. Firestore errors every live listener on `terminate()` («Firestore shutting down»), and a section mounting afterwards (the Home, once the join form closed) was told «The client has already been terminated»: the Home's to-do list wrote «The to-do list stream failed» to the console — and so to the owner's error reports — right before the reload. Now the session says `leaving` first, the gate swaps the app for the loading screen, the session waits for the screens to close (`env.letScreensClose()`, one short timer), and only then clears and wipes. Every section's listener has unsubscribed by then, not only the to-do list's. `session/leaveVenue.spec.tsx` runs the real session, gate and to-do store against a Firestore that errors live listeners on terminate as the SDK does; it fails without the fix.

**New texts (EN / IT)**: none invented. All 27 are the current app's own words, key for key: `auth.installGuide`, `auth.err.emailTaken`, `auth.err.weakPassword`, `join.title.new`, `join.sub.new`, `join.sub.prefillNew`, `join.email`, `join.repeatEmail`, `join.choosePassword`, `join.repeatPassword`, `join.signInInstead`, `join.signInAndAdd`, `join.creating`, `join.checkingCode`, the nine `help.*` password and email sentences, and the four `install.hint.*`.

**Ported to shared (tests run against the `js/` originals)**: `credentials` (now FULL, still adapted: the checks return dictionary keys; not paired), `install-hint` (full, paired).

**Known, left as is**: after Back (or «Sign in with that email») on a link, a reload while still signed out (an update, a pull-to-refresh) shows the new-account form again rather than the sign-in screen: «I stepped over to sign in» lives in memory only. The invitation is safe; Back again leads to sign-in.

**Not done here**: driving it on the emulator and a device (Federico, before merge) — in particular a real sign-up on the Auth emulator, the reload onto the venue, the wipe on a tablet that held another person's copy, and the guide question on a phone in a browser tab vs installed.
