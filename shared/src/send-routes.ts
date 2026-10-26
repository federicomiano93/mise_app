// send-routes.ts — the four ways an order can leave the app, which of them a
// person may use, and which one is offered first.
//
// TypeScript port of js/orders/send-routes.js for Mise 2. Behaviour is identical, input for input:
// send-routes.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the original
// paid for in bugs.
//
// PURE: no DOM, no Firestore, so every rule below is assertable in a test (P15).
//
// ⚠️⚠️ THIS IS A SIGNPOST, NOT A LOCK, AND SAYING SO IS PART OF THE FEATURE.
// WhatsApp and email live OUTSIDE this app: it opens a link, and there is no server
// call anybody could refuse. No setting here can stop a person opening WhatsApp on
// their own phone. What it genuinely does is remove the road from the app, so nobody
// takes it by habit or by accident and the normal way becomes "send it to the
// manager" — and the message itself is BUILT by the app, so going round it means
// retyping thirty ingredients by hand. It discourages; it does not forbid.
//
// ⚠️ THE DECISION, THOUGH, IS CLOSED PROPERLY: who may change these settings is
// enforced by the database rules, not by a hidden button. Hiding a control is
// courtesy, never security (v269).

export type Route = 'manager' | 'whatsapp' | 'whatsappSupplier' | 'email';
export type RouteFlags = Record<Route, boolean>;

export const ROUTES: readonly Route[] = Object.freeze(['manager', 'whatsapp', 'whatsappSupplier', 'email'] as Route[]);

const isRoute = (route: unknown): route is Route => (ROUTES as readonly unknown[]).includes(route);

// Does this road put the order in the SUPPLIER's hands (WhatsApp, email)? «Manager» sends an
// in-app list to a colleague: nothing leaves the building and it is never merged into the
// history, so the same-day unit check has nothing to say about it.
export function routeSendsToSupplier(route?: unknown): boolean {
  return isRoute(route) && route !== 'manager';
}

// The two that address one supplier directly need a way to reach it.
const NEEDS: Readonly<Record<string, string>> = Object.freeze({ whatsappSupplier: 'phone', email: 'email' });

// What a venue starts with: the two roads that existed before this change.
//
// ⚠️ THE TWO NEW ONES DEFAULT TO OFF. A venue that has never been asked has not
// agreed to let anybody message its suppliers directly, and a default that turns on
// a way of contacting the outside world is a decision made by nobody.
export const DEFAULT_ROUTES: Readonly<RouteFlags> = Object.freeze({
  manager: true, whatsapp: true, whatsappSupplier: false, email: false,
});

type Doc = { sendRoutes?: Record<string, unknown> | null; preferredRoute?: unknown } | null | undefined;

// Read a stored config into the settings the screens use.
//
// ⚠️ A CORRUPT OR HALF-WRITTEN DOCUMENT FALLS BACK TO THE DEFAULTS, never to
// "nothing allowed": an order that cannot leave the app at all is a worse failure
// than one that can leave by a road somebody meant to close.
export function normalizeSendRoutes(doc?: unknown): { routes: RouteFlags; preferred: Route | undefined } {
  const stored = (doc as Doc)?.sendRoutes;
  const routes = {} as RouteFlags;
  ROUTES.forEach(r => {
    const value = stored?.[r];
    routes[r] = typeof value === 'boolean' ? value : DEFAULT_ROUTES[r];
  });
  // ⚠️ ALL FOUR OFF IS NOT A STATE THE APP MAY BE IN. The settings screen refuses
  // to save it, but a document written by hand, an older version or a partial merge
  // could still produce it — and the answer must be a working app, not a dead end.
  if (!ROUTES.some(r => routes[r])) routes.manager = true;

  const wanted = String((doc as Doc)?.preferredRoute || '');
  const preferred = (routes as unknown as Record<string, boolean>)[wanted] ? wanted as Route : ROUTES.find(r => routes[r]);
  return { routes, preferred };
}

interface RouteSettings { routes?: Partial<Record<Route, unknown>>; orderLists?: unknown }

// Which routes THIS person may use.
//
// ⚠️⚠️ A MANAGER OR OWNER ALWAYS KEEPS ALL FOUR, AND THE REASON IS STRUCTURAL. If
// the switches applied to everybody, turning WhatsApp off to hold an employee back
// would disarm the very person who then has to get the order to the supplier — the
// order could never leave the building. The switches say what an EMPLOYEE may use.
//
// ⚠️ ORDER LISTS OFF TAKES THE «TO THE MANAGER» ROAD AWAY FROM EVERYBODY — that road
// IS an order list (28 Sep 2026). Unlike the switches above it is not a limit on an
// employee, it is the venue saying it does not use the feature at all.
export function routesFor(settings?: unknown, { canManage = false }: { canManage?: unknown } = {}): Route[] {
  const s = settings as RouteSettings | null | undefined;
  const listsOn = s?.orderLists !== false;
  const keep = (r: Route): boolean => listsOn || r !== 'manager';
  if (canManage) return ROUTES.filter(keep);
  const routes: Partial<Record<Route, unknown>> = s?.routes || DEFAULT_ROUTES;
  return ROUTES.filter(r => routes[r] === true && keep(r));
}

// The routes as they really stand for staff: with order lists off, «to the manager»
// is gone for everybody (routesFor), so it can never be the road that is «kept open».
// ⚠️ Review of 28 Sep 2026: without this, lists off + WhatsApp on let a manager switch
// WhatsApp off too — validateRoutes still counted the stored manager road — and every
// employee's Send then offered nothing at all.
export function effectiveRoutes(routes?: unknown, orderLists?: unknown): Record<string, unknown> {
  return orderLists === false ? { ...(routes as object), manager: false } : { ...(routes as object) };
}

// Would turning order lists OFF leave an employee with no way to send at all?
// True when the only road switched on for them is «to the manager».
export function listsAreTheOnlyRoad(settings?: unknown): boolean {
  const routes: Partial<Record<Route, unknown>> = (settings as RouteSettings | null | undefined)?.routes || DEFAULT_ROUTES;
  return ROUTES.filter(r => r !== 'manager').every(r => routes[r] !== true);
}

// Can this route actually be used for this supplier?
//
// ⚠️ A ROUTE WITH NOWHERE TO SEND IS OFFERED AS UNAVAILABLE, WITH THE REASON — never
// as a chat that opens blank or a mail addressed to nobody. Those look like the app
// failing; "no number saved for this supplier" looks like the thing it is, and names
// what to go and fix.
export function routeAvailableFor(route: unknown, supplier?: unknown): boolean {
  const need = NEEDS[route as string];
  if (!need) return true;
  return String((supplier as Record<string, unknown> | null | undefined)?.[need] || '').trim() !== '';
}

// The suppliers a direct route cannot reach.
export function unreachable<T>(route: unknown, suppliers?: readonly T[] | null): T[] {
  if (!NEEDS[route as string]) return [];
  return (suppliers || []).filter(s => s && !routeAvailableFor(route, s));
}

// ── Saving the settings ──────────────────────────────────────────────────────

export type RouteValidation =
  | { ok: false; reason: 'none' }
  | { ok: true; routes: Record<string, unknown>; preferred: unknown };

// What the settings screen is allowed to save, and why not.
//
//   -> { ok: true, routes, preferred } | { ok: false, reason }
//
// ⚠️ THE LAST ROAD CANNOT BE CLOSED. With every switch off an employee is left
// holding an order that can never leave the app, and the app would have taken away
// the only thing it was for. Refused out loud, so it is a message rather than a
// switch that mysteriously will not stay off.
export function validateRoutes(routes?: unknown, preferred?: unknown): RouteValidation {
  const r = routes as Record<string, unknown> | null | undefined;
  const on = ROUTES.filter(route => r?.[route] === true);
  if (!on.length) return { ok: false, reason: 'none' };

  // ⚠️ A PREFERENCE POINTING AT A CLOSED ROAD IS MOVED, NOT KEPT. Left alone it
  // would silently mean "no preference" and the app would offer whatever came
  // first — a setting that stopped doing what it says without saying so.
  const chosen = r![preferred as string] ? preferred : on[0];
  return { ok: true, routes: { ...r }, preferred: chosen };
}

// Only the routes ever reach Firestore, never a derived list.
export function toStored(routes?: unknown, preferred?: unknown): { sendRoutes: RouteFlags; preferredRoute: string } {
  const out = {} as RouteFlags;
  ROUTES.forEach(r => { out[r] = (routes as Record<string, unknown> | null | undefined)?.[r] === true; });
  return { sendRoutes: out, preferredRoute: String(preferred || '') };
}
