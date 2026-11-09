// membership.ts — what a person may do inside a location they already belong to.
//
// TypeScript port of the PURE half of js/roles.js (the roles and the two powers). The other half
// turns a role into words through the current app's dictionary, which Mise 2 does not share, so
// this is not a whole-module port and parity.spec.ts does not pair it; membership.spec.ts runs
// every test against both files instead.
//
// js/sections.js answers "which locations may this account open" — the boundary between two
// businesses. This answers "and once inside, may they take things away" — the boundary between
// two people in the SAME business.
//
// ⚠️ THE ROLE HAS NO FIELD OF ITS OWN: it is the VALUE of the membership entry
// (`users/{uid}.locations.<id>`), and accessValue() in sections.ts is the one place that reads it.
//
// ⚠️ IT IS UX AND NOTHING ELSE (P2). What these answers decide is which controls to draw; every
// read and write is still judged by firestore.rules on the server, which read the same value
// themselves and never trust anything sent from here.

import { accessValue, OWNER, MANAGER, OWNER_SALES, OWNER_KITCHEN } from './sections';

export type Role = typeof OWNER | typeof OWNER_SALES | typeof OWNER_KITCHEN | typeof MANAGER | 'staff';

// FIVE roles. Three was meant to be the ceiling (Federico, 11 Aug 2026: the proprietario, the head
// chef or manager, the ordinary employee), and he raised it on 1 Nov 2026, knowing why it was
// there: an owner of the sales side only and an owner of the kitchen side only, beside the owner
// who sees everything. They run their side as an owner would and hire nobody. Do not add a sixth
// without asking him the same question. ⚠️ These values are DATA, stored in users/{uid} and read
// by the rules; only the words a person reads may be translated.
export const ROLES: readonly Role[] = Object.freeze([OWNER, OWNER_SALES, OWNER_KITCHEN, MANAGER, 'staff'] as const);

// ⚠️ THE DEFAULT IS THE WHOLE DESIGN, AND IT POINTS AT `staff`: destructive power that nobody
// explicitly granted does not exist. Every membership written `true` reads as staff.
export const DEFAULT_ROLE: Role = 'staff';

export function isValidRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function roleOf(userDoc: unknown, locationId: unknown): Role {
  const value = accessValue(userDoc, locationId);
  return typeof value === 'string' ? value : DEFAULT_ROLE;
}

// ⚠️ TWO ANSWERS, NOT ONE, AND THEY ARE NOT THE SAME QUESTION. canManage is "may take things
// away" — the owner AND the manager; every delete reads it. isOwner is "may invite people and set
// roles" — the owner alone. Using isOwner for a bin would take the bins away from every manager.
//
// ⚠️ A PARTIAL OWNER ANSWERS YES HERE, because every screen they can open is on their own side and
// the rules refuse the rest. It says nothing about the venue as a whole: that is canManageVenue().
export function canManage(userDoc: unknown, locationId: unknown): boolean {
  const value = accessValue(userDoc, locationId);
  return value === OWNER || value === MANAGER || value === OWNER_SALES || value === OWNER_KITCHEN;
}

// May this account change how the whole venue works — its language, its Home cards, what its
// employees are shown? The Cloud Functions behind those switches ask for exactly these two values
// (functions/onboarding.js).
export function canManageVenue(userDoc: unknown, locationId: unknown): boolean {
  const value = accessValue(userDoc, locationId);
  return value === OWNER || value === MANAGER;
}

// Does this person work on the clients at all — the Clients editor, the WhatsApp lists, the
// ordering links and menus? Everybody but the owner of the kitchen, who reads names and quantities
// only inside the Calculator. Same list as worksOnClientsAs() in firestore.rules. `role` is the
// session's, 'staff' for `true`.
export function worksOnClients(role: unknown): boolean {
  return role !== OWNER_KITCHEN;
}

export function isOwner(userDoc: unknown, locationId: unknown): boolean {
  return accessValue(userDoc, locationId) === OWNER;
}
