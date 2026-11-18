// roleWords.ts — the words of the six role choices of «Who can get in», shared by the invite card and the people list.
//
// The current app's tables (js/roles.js, js/staff/people.js ROLE_MEANS and CONFIRM_TITLE), keyed by the CHOICE, not by the role:
// «Manager» and «Head chef» are one level of power under two names, and each needs its own word and its own sentence.
//
// ⚠️ KEYS, NEVER WORDS: they are looked up with t() when drawn, so a change of language reaches them.

import type { ManagerTitle, Role, RoleChoiceKey } from '@mise/shared/membership';
import type { MessageKey } from '../i18n/en';

// Each choice's word.
export const ROLE_LABEL: Readonly<Record<RoleChoiceKey, MessageKey>> = {
  owner: 'role.owner',
  'owner-sales': 'role.ownerSales',
  'owner-kitchen': 'role.ownerKitchen',
  manager: 'role.manager',
  'head-chef': 'role.headChef',
  staff: 'role.staff',
};

// ⚠️ THE ONLY PLACE ANYBODY IS TOLD WHAT A ROLE DOES: the sentence shown beside each choice and in the question before a change.
export const ROLE_MEANS: Readonly<Record<RoleChoiceKey, MessageKey>> = {
  owner: 'role.means.owner',
  'owner-sales': 'role.means.ownerSales',
  'owner-kitchen': 'role.means.ownerKitchen',
  manager: 'role.means.manager',
  'head-chef': 'role.means.headChef',
  staff: 'role.means.staff',
};

// ⚠️ THE FORM THAT GOES INSIDE A SENTENCE IS ASKED FOR, NEVER COMPUTED: lowercasing somebody else's language is the translator's
// business (js/roles.js personLabelInSentence).
export const ROLE_IN_SENTENCE: Readonly<Record<RoleChoiceKey, MessageKey>> = {
  owner: 'role.owner.inSentence',
  'owner-sales': 'role.ownerSales.inSentence',
  'owner-kitchen': 'role.ownerKitchen.inSentence',
  manager: 'role.manager.inSentence',
  'head-chef': 'role.headChef.inSentence',
  staff: 'role.staff.inSentence',
};

// The question before a change of role, a whole sentence per choice: English needs «an owner», «the head chef», Italian no article
// at all — a hole for the article is a hole no translator can fill (js/staff/people.js CONFIRM_TITLE).
export const ROLE_CONFIRM: Readonly<Record<RoleChoiceKey, MessageKey>> = {
  owner: 'people.confirm.owner',
  'owner-sales': 'people.confirm.ownerSales',
  'owner-kitchen': 'people.confirm.ownerKitchen',
  manager: 'people.confirm.manager',
  'head-chef': 'people.confirm.headChef',
  staff: 'people.confirm.staff',
};

// The choice a role and title read as: the title matters on the manager level only (js/roles.js choiceKey).
export function choiceKeyOf(role: Role, title: ManagerTitle | null): RoleChoiceKey {
  if (role === 'manager') return title === 'head-chef' ? 'head-chef' : 'manager';
  return role;
}
