// peopleModel.ts — the pure half of the people list of «Who can get in» (staff slice 4): the order of the rows and the name a row
// goes by. A port of js/staff/people.js paint() and displayName(); no words here, the screen says them.

import type { Role } from '@mise/shared/membership';
import type { Member } from './settingsSource';

// The person's name as the roster holds it, or '' when it holds none (the accounts made by hand in the Firebase console): the screen
// then says «(no name yet)», which is what tells the owner there is something to fix.
export function fullName(member: Pick<Member, 'firstName' | 'lastName'>): string {
  return [member.firstName, member.lastName].filter(Boolean).join(' ');
}

// What a row's buttons are named after, so two rows never read alike to a screen reader: the name, else the email, else ''.
export function nameForButtons(member: Member): string {
  return fullName(member) || member.email;
}

// ⚠️ MOST POWER FIRST, THEN BY NAME (js/staff/people.js): the question this screen is usually opened to answer is «who can delete
// things», and that should not need scrolling for. The full owner, then the two partial owners, then the manager level (manager and
// head chef), then everybody else — a row with no role this app knows included, as the current app draws it, as an employee.
function rank(role: Role | null): number {
  if (role === 'owner') return 0;
  if (role === 'owner-sales' || role === 'owner-kitchen') return 1;
  if (role === 'manager') return 2;
  return 3;
}

// The rows in the order drawn. Within a level by name, in the interface language's own alphabetical order (`compare`: an
// Intl.Collator's, so «Élodie» sorts beside «Elena»); a row with no name yet comes after the named ones, by its email.
export function sortMembers(members: readonly Member[], compare: (a: string, b: string) => number): Member[] {
  return [...members].sort((a, b) => {
    const byRank = rank(a.role) - rank(b.role);
    if (byRank !== 0) return byRank;
    const nameA = fullName(a);
    const nameB = fullName(b);
    if (nameA && !nameB) return -1;
    if (!nameA && nameB) return 1;
    return compare(nameA || a.email, nameB || b.email) || compare(a.uid, b.uid);
  });
}
