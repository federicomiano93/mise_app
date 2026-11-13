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
