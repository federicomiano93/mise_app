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

import { accessValue, OWNER, MANAGER } from './sections';

export type Role = typeof OWNER | typeof MANAGER | 'staff';

// THREE roles (Federico, 11 Aug 2026: the proprietario, the head chef or manager, the ordinary
// employee) — and three is the ceiling. ⚠️ These values are DATA, stored in users/{uid} and read
// by the rules; only the words a person reads may be translated.
export const ROLES: readonly Role[] = Object.freeze([OWNER, MANAGER, 'staff'] as const);

// ⚠️ THE DEFAULT IS THE WHOLE DESIGN, AND IT POINTS AT `staff`: destructive power that nobody
// explicitly granted does not exist. Every membership written `true` reads as staff.
export const DEFAULT_ROLE: Role = 'staff';

export function isValidRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function roleOf(userDoc: unknown, locationId: unknown): Role {
  const value = accessValue(userDoc, locationId);
  if (value === OWNER) return OWNER;
  if (value === MANAGER) return MANAGER;
  return DEFAULT_ROLE;
}

// ⚠️ TWO ANSWERS, NOT ONE, AND THEY ARE NOT THE SAME QUESTION. canManage is "may take things
// away" — the owner AND the manager; every delete reads it. isOwner is "may invite people and set
// roles" — the owner alone. Using isOwner for a bin would take the bins away from every manager.
export function canManage(userDoc: unknown, locationId: unknown): boolean {
  const value = accessValue(userDoc, locationId);
  return value === OWNER || value === MANAGER;
}

export function isOwner(userDoc: unknown, locationId: unknown): boolean {
  return accessValue(userDoc, locationId) === OWNER;
}
