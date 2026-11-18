import { describe, expect, it } from 'vitest';
import { member } from '../testing/fakeSettingsSource';
import { fullName, nameForButtons, sortMembers } from './peopleModel';

// The order of the people list and the name a row goes by (a port of js/staff/people.js paint() and displayName()).

const english = new Intl.Collator('en', { sensitivity: 'base', numeric: true }).compare;
const italian = new Intl.Collator('it', { sensitivity: 'base', numeric: true }).compare;
const uids = (list: readonly { uid: string }[]) => list.map(m => m.uid);

describe('the name a row goes by', () => {
  it('is the first and last name, either alone, or nothing', () => {
    expect(fullName({ firstName: 'Anna', lastName: 'Rossi' })).toBe('Anna Rossi');
    expect(fullName({ firstName: 'Anna', lastName: '' })).toBe('Anna');
    expect(fullName({ firstName: '', lastName: 'Rossi' })).toBe('Rossi');
    expect(fullName({ firstName: '', lastName: '' })).toBe('');
  });

  it('names the buttons by the email when the row has no name, so two rows never read alike', () => {
    expect(nameForButtons(member('a', { firstName: 'Anna', lastName: 'Rossi' }))).toBe('Anna Rossi');
    expect(nameForButtons(member('a', { email: 'anna@club.test' }))).toBe('anna@club.test');
    expect(nameForButtons(member('a', { email: '' }))).toBe('');
  });
});

describe('the order of the rows', () => {
  it('puts the most power first: the owner, the partial owners, the manager level, then everybody else', () => {
    const list = [
      member('staff', { firstName: 'Aldo', role: 'staff' }),
      member('chef', { firstName: 'Bea', role: 'manager', title: 'head-chef' }),
      member('kitchen', { firstName: 'Carla', role: 'owner-kitchen' }),
      member('unknown', { firstName: 'Abe', role: null }),
      member('owner', { firstName: 'Zoe', role: 'owner' }),
      member('sales', { firstName: 'Dario', role: 'owner-sales' }),
      member('manager', { firstName: 'Ada', role: 'manager', title: 'manager' }),
    ];
    expect(uids(sortMembers(list, english))).toEqual(['owner', 'kitchen', 'sales', 'manager', 'chef', 'unknown', 'staff']);
  });

  it('sorts by name within a level, in the language’s own alphabetical order, capitals and accents ignored', () => {
    const list = [
      member('b', { firstName: 'luca' }),
      member('c', { firstName: 'Élodie' }),
      member('a', { firstName: 'Elena' }),
      member('d', { firstName: 'Marco', lastName: 'Bianchi' }),
      member('e', { firstName: 'Marco', lastName: 'Albini' }),
    ];
    expect(uids(sortMembers(list, italian))).toEqual(['a', 'c', 'b', 'e', 'd']);
  });

  it('puts a row with no name yet after the named ones of its level, by its email', () => {
    const list = [
      member('x', { email: 'zeta@club.test' }),
      member('y', { firstName: 'Zoe' }),
      member('z', { email: 'alfa@club.test' }),
      member('w', { firstName: 'Anna' }),
    ];
    expect(uids(sortMembers(list, english))).toEqual(['w', 'y', 'z', 'x']);
  });

  it('never changes the list it is given', () => {
    const list = Object.freeze([member('b', { firstName: 'B' }), member('a', { firstName: 'A' })]);
    expect(uids(sortMembers(list, english))).toEqual(['a', 'b']);
    expect(uids(list)).toEqual(['b', 'a']);
  });
});
