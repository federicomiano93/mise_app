// functions-callables-check.mjs — run the real callables of functions/onboarding.js against the
// Firestore emulator and check, for each one, who is let in, who is refused, and what the
// database holds afterwards.
//
// Run it, emulator and all, with:
//   npm run test:callables:emulated
// or, against an emulator already running under the same project id:
//   npm run test:callables
//
// It runs in CI on every push, in the `rules` job beside the retention check
// (.github/workflows/test.yml), and needs the server's own packages (functions/node_modules).
//
// WHY IT EXISTS. Every other test of onboarding.js only READS its source with a regular
// expression, so a mutation that keeps the text shaped right but changes what the code does
// (a refusal turned into a no-op, a guard inverted) passed every suite. Three were proved on
// 24 Nov 2026 and this file is what kills them:
//   A   redeemJoinCode, the «already a member» return, removed: an owner who opens their own
//       staff link is rewritten as an employee of their own business.
//   B   setMemberRole, the «not a member» test inverted / the «last owner» test weakened.
//   C2  setLocationLanguage, the permission-denied no longer thrown: any signed-in account
//       can set any venue's language.
//
// HOW. firebase-functions v2 exposes `fn.run(request)`, which runs the handler with no HTTP.
// The handlers read only request.auth (uid, token.email) and request.data, so that is all a
// request below carries.
//
// ⚠️ THE EMULATOR, ALWAYS. The Admin SDK bypasses the security rules and, with no emulator
// variable, would talk to a real project with full power. The variable is set HERE, before the
// SDK is loaded, to the local emulator only, and a project id that is not a `demo-` one stops
// the run.
//
// NOT COVERED, on purpose: createWorkspace, listWorkspaces, reissueOwnerLink, deleteWorkspace
// (they need an app-admin account and, for the first, the Auth admin API), the photo and
// ingredient-panel switches (same gate as setStaffCard), and the push functions in index.js.
//
// Deliberately NOT named *.test.mjs: `node --test` would pick it up in the `test` job, which has
// no emulator (the same reason as firestore-rules-check.mjs).

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { PROJECT, requireEmulators, wipe } from './seed-emulator.mjs';

if (!PROJECT.startsWith('demo-')) {
  console.error(`Refusing to run: project ${PROJECT} is not a demo- project.`);
  process.exit(1);
}
await requireEmulators();

// The SDK the functions use, from the functions' own folder (the root package has none).
const requireFromFunctions = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp } = requireFromFunctions('firebase-admin/app');
const { getFirestore } = requireFromFunctions('firebase-admin/firestore');

// ONE default app, created here before onboarding.js asks for it: its db() is
// getFirestore() on the default app, so the module and this test read and write the same
// emulator project. (index.js, which also calls initializeApp(), is never imported.)
initializeApp({ projectId: PROJECT });
const db = getFirestore();

const onboarding = await import('../../functions/onboarding.js');
const { createJoinCode, redeemJoinCode, setMemberRole, setMemberName, setLocationLanguage, setStaffCard, setHomeCardOrder } = onboarding;
const { HIDEABLE_IDS, OPT_IN_IDS } = await import('../../functions/home-cards.js');
const { LINK_LENGTH } = await import('../../functions/join-code.js');

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✖ ${name} ${detail}`); }
}

// ── Calling a callable, and reading what it did ──────────────────────────────

// uid null = signed out. `token: {}` is what a real request carries when the account has no email.
const request = (uid, data) => ({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: {} });
const call = (fn, uid, data) => fn.run(request(uid, data));

// The call must be refused with this HttpsError code (and, if given, this details.reason).
async function refused(name, promise, code, reason) {
  try {
    await promise;
    check(name, false, 'it succeeded');
  } catch (err) {
    const ok = err && err.code === code && (!reason || (err.details && err.details.reason === reason));
    check(name, ok, `got ${err && err.code}: ${err && err.message}`);
  }
}

async function succeeded(name, promise) {
  try {
    const value = await promise;
    check(name, true);
    return value;
  } catch (err) {
    check(name, false, `refused with ${err && err.code}: ${err && err.message}`);
    return null;
  }
}

async function read(path) {
  const snap = await db.doc(path).get();
  return snap.exists ? snap.data() : null;
}
const joinCodeCount = async () => (await db.collection('join-codes').get()).size;
const codeDocId = code => createHash('sha256').update(String(code)).digest('hex');

// ── The world ────────────────────────────────────────────────────────────────
//
// venue-a: an owner, a manager, an employee, and one partial owner of each side (users/{uid} is
// the truth the callables read; the roster rows under members/ are what setMemberRole counts
// owners from). venue-b: its own owner. `outsider` and the `fresh…` accounts belong nowhere.
// Uids are letters and digits only: the callables refuse anything else.
const A = 'venue-a';
const B = 'venue-b';

async function seed() {
  await wipe();
  await db.doc(`locations/${A}`).set({ name: 'Venue A', language: 'en', country: 'GB' });
  await db.doc(`locations/${B}`).set({ name: 'Venue B', language: 'en', country: 'GB' });
  const people = [
    ['ownerA', A, 'owner', 'owner'],
    ['managerA', A, 'manager', 'manager'],
    ['staffA', A, true, 'staff'],
    ['salesA', A, 'owner-sales', 'owner-sales'],
    ['kitchenA', A, 'owner-kitchen', 'owner-kitchen'],
    ['ownerB', B, 'owner', 'owner'],
  ];
  for (const [uid, lid, value, role] of people) {
    await db.doc(`users/${uid}`).set({ locations: { [lid]: value } });
    await db.doc(`locations/${lid}/members/${uid}`).set({ bakery: lid, role, title: '', firstName: uid, lastName: '' });
  }
}

// Everybody who is not a full owner or manager of venue-a.
const NOT_ALLOWED_IN_A = ['staffA', 'salesA', 'kitchenA', 'ownerB', 'outsider'];
const NOT_OWNER_OF_A = ['managerA', ...NOT_ALLOWED_IN_A];

// ── 1. Signed out ────────────────────────────────────────────────────────────
console.log('\nSigned out');
await seed();
{
  const data = { locationId: A, language: 'it', card: HIDEABLE_IDS[0], hidden: true, order: [HIDEABLE_IDS[0]], uid: 'staffA', role: 'staff', code: '123456' };
  const calls = { createJoinCode, redeemJoinCode, setMemberRole, setMemberName, setLocationLanguage, setStaffCard, setHomeCardOrder };
  for (const [name, fn] of Object.entries(calls)) {
    await refused(`${name}: no account is unauthenticated`, call(fn, null, data), 'unauthenticated');
  }
  await refused('an auth object with no uid is unauthenticated too',
    createJoinCode.run({ data, auth: { uid: '', token: {} }, rawRequest: {} }), 'unauthenticated');
  check('nothing was written by any of them', (await joinCodeCount()) === 0 && (await read(`locations/${A}`)).language === 'en');
}

// ── 2. The owner-only gate (requireOwner), through createJoinCode and setMemberName ──
console.log('\nOwner-only calls');
await seed();
{
  const made = await succeeded('createJoinCode: the owner of the venue is let in',
    call(createJoinCode, 'ownerA', { locationId: A, role: 'staff' }));
  if (made) {
    check('…and gets six digits for an employee', /^[0-9]{6}$/.test(made.code) && made.kind === 'digits' && made.role === 'staff', JSON.stringify(made));
    const stored = await read(`join-codes/${codeDocId(made.code)}`);
    check('…the code is stored under its hash, for this venue, by this owner, unused',
      stored && stored.locationId === A && stored.createdBy === 'ownerA' && stored.usedAt === null && stored.role === 'staff',
      JSON.stringify(stored));
    check('…and the plain code is not written anywhere in the document', stored && !JSON.stringify(stored).includes(made.code));
  }
  check('exactly one code exists', (await joinCodeCount()) === 1);

  for (const who of NOT_OWNER_OF_A) {
    await refused(`createJoinCode: ${who} is permission-denied`,
      call(createJoinCode, who, { locationId: A, role: 'staff' }), 'permission-denied');
  }
  check('refusals wrote no code', (await joinCodeCount()) === 1);

  for (const bad of ['../x', '', 'a'.repeat(65), 'a/b', undefined, 123]) {
    await refused(`createJoinCode: locationId ${JSON.stringify(bad)} is invalid-argument`,
      call(createJoinCode, 'ownerA', { locationId: bad, role: 'staff' }), 'invalid-argument');
  }
  await refused('createJoinCode: a missing body is invalid-argument', call(createJoinCode, 'ownerA', undefined), 'invalid-argument');

  await refused('createJoinCode: six digits for a manager are refused (a link only)',
    call(createJoinCode, 'ownerA', { locationId: A, role: 'manager' }), 'failed-precondition');
  const link = await succeeded('createJoinCode: a manager link works',
    call(createJoinCode, 'ownerA', { locationId: A, role: 'manager', kind: 'link', title: 'head-chef' }));
  if (link) check('…32 characters, titled head chef', link.code.length === LINK_LENGTH && link.title === 'head-chef', JSON.stringify(link));

  // setMemberName: the other requireOwner caller.
  const renamed = await succeeded('setMemberName: the owner renames a member', call(setMemberName, 'ownerA', { locationId: A, uid: 'staffA', firstName: ' Luca ', lastName: 'Forno' }));
  check('…whitespace cleaned, the roster row written',
    renamed && renamed.firstName === 'Luca' && (await read(`locations/${A}/members/staffA`)).lastName === 'Forno');
  for (const who of NOT_OWNER_OF_A) {
    await refused(`setMemberName: ${who} is permission-denied`,
      call(setMemberName, who, { locationId: A, uid: 'staffA', firstName: 'Hacked', lastName: '' }), 'permission-denied');
  }
  check('the roster row kept the owner\'s name', (await read(`locations/${A}/members/staffA`)).firstName === 'Luca');
}

// ── 3. redeemJoinCode (mutation A) ───────────────────────────────────────────
console.log('\nRedeeming a join code');
await seed();
{
  const staffCode = (await call(createJoinCode, 'ownerA', { locationId: A, role: 'staff' })).code;

  // A: an owner opens their own staff invitation.
  await refused('an owner redeeming a staff code of their own venue is refused: already-member',
    call(redeemJoinCode, 'ownerA', { kind: 'digits', code: staffCode }), 'failed-precondition', 'already-member');
  check('…and is STILL the owner (users)', (await read('users/ownerA')).locations[A] === 'owner', JSON.stringify(await read('users/ownerA')));
  check('…and still the owner on the roster', (await read(`locations/${A}/members/ownerA`)).role === 'owner');
  check('…and the code is not spent by a look', (await read(`join-codes/${codeDocId(staffCode)}`)).usedAt === null);

  // The same for a manager and an employee already in.
  await refused('a manager redeeming the same code is refused: already-member',
    call(redeemJoinCode, 'managerA', { kind: 'digits', code: staffCode }), 'failed-precondition', 'already-member');
  check('…and is still a manager', (await read('users/managerA')).locations[A] === 'manager');

  // A fresh account becomes what the code says.
  const joined = await succeeded('a fresh account redeems it', call(redeemJoinCode, 'freshOne',
    { kind: 'digits', code: staffCode, firstName: '  Ann  ', lastName: 'Baker' }));
  check('…gets the code\'s venue and role', joined && joined.locationId === A && joined.role === 'staff', JSON.stringify(joined));
  check('…and users/{uid} says employee of that venue only', JSON.stringify((await read('users/freshOne')).locations) === JSON.stringify({ [A]: true }),
    JSON.stringify(await read('users/freshOne')));
  const row = await read(`locations/${A}/members/freshOne`);
  check('…and a roster row with the cleaned name', row && row.firstName === 'Ann' && row.lastName === 'Baker' && row.role === 'staff', JSON.stringify(row));
  const spent = await read(`join-codes/${codeDocId(staffCode)}`);
  check('…and the code is spent by them', spent.usedBy === 'freshOne' && typeof spent.usedAt === 'number');

  // Single use.
  await refused('a spent code cannot be used by a second account', call(redeemJoinCode, 'freshTwo', { kind: 'digits', code: staffCode }), 'permission-denied');
  check('…and the second account got nothing', (await read('users/freshTwo')) === null);

  // A link for a manager becomes 'manager' with the title.
  const link = await call(createJoinCode, 'ownerA', { locationId: A, role: 'manager', kind: 'link', title: 'head-chef' });
  const asManager = await succeeded('a fresh account redeems a manager link', call(redeemJoinCode, 'freshThree', { kind: 'link', code: link.code }));
  check('…becomes a manager', asManager && asManager.role === 'manager' && (await read('users/freshThree')).locations[A] === 'manager');
  check('…with the head chef title on the roster', (await read(`locations/${A}/members/freshThree`)).title === 'head-chef');

  // An invitation is only as good as the owner who sent it.
  await db.doc('users/ownerA2').set({ locations: { [A]: 'owner' } });
  const orphan = await succeeded('a second owner mints a code (users/{uid} is what the gate reads)',
    call(createJoinCode, 'ownerA2', { locationId: A, role: 'staff' }));
  if (orphan) {
    await db.doc('users/ownerA2').set({ locations: { [A]: 'manager' } });
    await refused('a code minted by somebody no longer an owner is refused', call(redeemJoinCode, 'freshFive', { kind: 'digits', code: orphan.code }), 'permission-denied');
    check('…nobody joined, and the code is spent', (await read('users/freshFive')) === null && typeof (await read(`join-codes/${codeDocId(orphan.code)}`)).usedAt === 'number');
  }

  // A code nobody minted, and a malformed one.
  await refused('a code that does not exist is permission-denied', call(redeemJoinCode, 'freshSix', { kind: 'digits', code: '000000' }), 'permission-denied');
  await refused('a malformed code is permission-denied', call(redeemJoinCode, 'freshSix', { kind: 'digits', code: '12' }), 'permission-denied');
  check('…and nobody joined', (await read('users/freshSix')) === null);
}

// ── 4. setMemberRole (mutation B) ────────────────────────────────────────────
console.log('\nPromote, demote, remove');
await seed();
{
  // Not a member: nothing is written.
  await refused('naming somebody who is in no venue is not-found',
    call(setMemberRole, 'ownerA', { locationId: A, uid: 'outsider', role: 'staff' }), 'not-found');
  check('…no users document was made', (await read('users/outsider')) === null);
  check('…no roster row was made', (await read(`locations/${A}/members/outsider`)) === null);
  await refused('naming a member of ANOTHER venue is not-found too',
    call(setMemberRole, 'ownerA', { locationId: A, uid: 'ownerB', role: 'owner' }), 'not-found');
  check('…and venue-b\'s owner was not written into venue-a',
    JSON.stringify((await read('users/ownerB')).locations) === JSON.stringify({ [B]: 'owner' }));
  await refused('removing somebody who is in no venue is not-found',
    call(setMemberRole, 'ownerA', { locationId: A, uid: 'outsider', role: null }), 'not-found');

  // The only owner.
  await refused('the only owner cannot demote themselves', call(setMemberRole, 'ownerA', { locationId: A, uid: 'ownerA', role: 'manager' }), 'failed-precondition');
  await refused('the only owner cannot remove themselves', call(setMemberRole, 'ownerA', { locationId: A, uid: 'ownerA', role: null }), 'failed-precondition');
  check('…they are still the owner, in users and on the roster',
    (await read('users/ownerA')).locations[A] === 'owner' && (await read(`locations/${A}/members/ownerA`)).role === 'owner');

  // Nobody else may call it.
  for (const who of NOT_OWNER_OF_A) {
    await refused(`${who} cannot make an employee an owner`,
      call(setMemberRole, who, { locationId: A, uid: 'staffA', role: 'owner' }), 'permission-denied');
  }
  check('…the employee is still an employee', (await read('users/staffA')).locations[A] === true && (await read(`locations/${A}/members/staffA`)).role === 'staff');

  // Bad arguments.
  await refused('an unknown role is invalid-argument', call(setMemberRole, 'ownerA', { locationId: A, uid: 'staffA', role: 'superuser' }), 'invalid-argument');
  await refused('a missing role is invalid-argument', call(setMemberRole, 'ownerA', { locationId: A, uid: 'staffA' }), 'invalid-argument');
  await refused('a uid with a slash is invalid-argument', call(setMemberRole, 'ownerA', { locationId: A, uid: 'a/b', role: 'staff' }), 'invalid-argument');
  await refused('a bad title is invalid-argument', call(setMemberRole, 'ownerA', { locationId: A, uid: 'managerA', role: 'manager', title: 'king' }), 'invalid-argument');
  check('…and the employee is untouched', (await read('users/staffA')).locations[A] === true);

  // Promote and demote.
  const up = await succeeded('the owner promotes an employee to manager', call(setMemberRole, 'ownerA', { locationId: A, uid: 'staffA', role: 'manager', title: 'head-chef' }));
  check('…users and the roster agree', up && (await read('users/staffA')).locations[A] === 'manager'
    && (await read(`locations/${A}/members/staffA`)).role === 'manager' && (await read(`locations/${A}/members/staffA`)).title === 'head-chef');

  // Two owners: one may be demoted.
  await db.doc('users/ownerA2').set({ locations: { [A]: 'owner' } });
  await db.doc(`locations/${A}/members/ownerA2`).set({ bakery: A, role: 'owner', title: '' });
  const down = await succeeded('with two owners, one can demote the other', call(setMemberRole, 'ownerA', { locationId: A, uid: 'ownerA2', role: 'manager' }));
  check('…users and the roster agree', down && (await read('users/ownerA2')).locations[A] === 'manager' && (await read(`locations/${A}/members/ownerA2`)).role === 'manager');
  await refused('…and the demoted one can no longer change roles', call(setMemberRole, 'ownerA2', { locationId: A, uid: 'staffA', role: 'staff' }), 'permission-denied');
  await refused('…and the one left is the only owner again', call(setMemberRole, 'ownerA', { locationId: A, uid: 'ownerA', role: 'staff' }), 'failed-precondition');

  // Remove.
  const gone = await succeeded('the owner removes an employee', call(setMemberRole, 'ownerA', { locationId: A, uid: 'salesA', role: null }));
  check('…their membership is gone, their other data is not', gone && gone.removed === true
    && (await read('users/salesA')).locations[A] === undefined && (await read(`locations/${A}/members/salesA`)) === null);
  check('…and the rest of the team is untouched', (await read('users/managerA')).locations[A] === 'manager' && (await read('users/kitchenA')).locations[A] === 'owner-kitchen');
}

// ── 5. setLocationLanguage (mutation C2) ─────────────────────────────────────
console.log('\nThe venue\'s language');
await seed();
{
  for (const who of NOT_ALLOWED_IN_A) {
    await refused(`${who} cannot change venue-a's language`, call(setLocationLanguage, who, { locationId: A, language: 'it' }), 'permission-denied');
  }
  check('…the language is unchanged', (await read(`locations/${A}`)).language === 'en');
  check('…and venue-b\'s was never touched', (await read(`locations/${B}`)).language === 'en');

  await refused('a language the app does not have is invalid-argument', call(setLocationLanguage, 'ownerA', { locationId: A, language: 'fr' }), 'invalid-argument');
  await refused('a bad locationId is invalid-argument', call(setLocationLanguage, 'ownerA', { locationId: '../x', language: 'it' }), 'invalid-argument');
  check('…still unchanged', (await read(`locations/${A}`)).language === 'en');

  const byOwner = await succeeded('the owner sets Italian', call(setLocationLanguage, 'ownerA', { locationId: A, language: 'it' }));
  const doc = await read(`locations/${A}`);
  check('…it is saved, and the name and country survive the merge', byOwner && doc.language === 'it' && doc.name === 'Venue A' && doc.country === 'GB', JSON.stringify(doc));
  const byManager = await succeeded('a manager sets English again', call(setLocationLanguage, 'managerA', { locationId: A, language: 'en' }));
  check('…it is saved', byManager && (await read(`locations/${A}`)).language === 'en');
  check('…and venue-b is still untouched', (await read(`locations/${B}`)).language === 'en');
}

// ── 6. The other owner-or-manager gates: setStaffCard, setHomeCardOrder ──────
console.log('\nHome cards');
await seed();
{
  const plain = HIDEABLE_IDS.find(id => !OPT_IN_IDS.includes(id));
  const optIn = OPT_IN_IDS[0];
  const order = [HIDEABLE_IDS[1], HIDEABLE_IDS[0]];
  check('(the card ids this test needs exist)', Boolean(plain) && Boolean(optIn) && HIDEABLE_IDS.length >= 2);

  for (const who of ['staffA', 'salesA', 'kitchenA', 'ownerB', 'outsider']) {
    await refused(`setStaffCard: ${who} is permission-denied`, call(setStaffCard, who, { locationId: A, card: plain, hidden: true }), 'permission-denied');
    await refused(`setHomeCardOrder: ${who} is permission-denied`, call(setHomeCardOrder, who, { locationId: A, order }), 'permission-denied');
  }
  const untouched = await read(`locations/${A}`);
  check('…nothing was written to the venue', untouched.staffHiddenCards === undefined && untouched.staffShownCards === undefined && untouched.homeCardOrder === undefined, JSON.stringify(untouched));

  await refused('setStaffCard: an unknown card is invalid-argument', call(setStaffCard, 'ownerA', { locationId: A, card: 'nope', hidden: true }), 'invalid-argument');
  await refused('setStaffCard: a non-boolean is invalid-argument', call(setStaffCard, 'ownerA', { locationId: A, card: plain, hidden: 'yes' }), 'invalid-argument');
  await refused('setHomeCardOrder: an order with a repeat is invalid-argument', call(setHomeCardOrder, 'ownerA', { locationId: A, order: [plain, plain] }), 'invalid-argument');

  const hid = await succeeded('setStaffCard: the owner hides a card', call(setStaffCard, 'ownerA', { locationId: A, card: plain, hidden: true }));
  const afterHide = await read(`locations/${A}`);
  check('…it is saved as hidden, the venue\'s name survives', hid && afterHide.staffHiddenCards[plain] === true && afterHide.name === 'Venue A', JSON.stringify(afterHide));
  const shown = await succeeded('setStaffCard: a manager shows a money card', call(setStaffCard, 'managerA', { locationId: A, card: optIn, hidden: false }));
  check('…a money card is stored the other way round (shown)', shown && (await read(`locations/${A}`)).staffShownCards[optIn] === true);
  const ordered = await succeeded('setHomeCardOrder: a manager sets the order', call(setHomeCardOrder, 'managerA', { locationId: A, order }));
  const afterOrder = await read(`locations/${A}`);
  check('…it is saved whole, the venue\'s name survives', ordered && JSON.stringify(afterOrder.homeCardOrder) === JSON.stringify(order) && afterOrder.name === 'Venue A', JSON.stringify(afterOrder));
  check('…and venue-b was never touched', (await read(`locations/${B}`)).homeCardOrder === undefined && (await read(`locations/${B}`)).staffHiddenCards === undefined);
}

await wipe();
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\n--- FAILURES ---');
  failures.forEach(f => console.log('  ✖ ' + f));
  process.exit(1);
}
console.log('Every callable refuses who it should, lets in who it should, and writes nothing when it refuses.\n');
