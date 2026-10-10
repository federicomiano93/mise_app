// Which Home cards a venue shows its ordinary employees, and who may change that — run
// against BOTH implementations: the TypeScript port in shared/ and the js/ file the live app
// uses today. Ported from tests/home-cards.test.mjs, keeping only the tests that execute
// home-cards (or push-model) exports; the ones that read the markup, the server code, the rules
// or the screens belong to the current app's files and stay in that suite.
//
// Federico, 13 Sep 2026: owner, manager and head chef choose the cards, HIDE ONLY, and
// ONLY FOR EMPLOYEES. The judgement is pure and is executed here.

import { describe, expect, test } from 'vitest';
import * as portedCards from './home-cards';
import * as portedPush from './push-model';
import * as legacyCardsJs from '../../js/home-cards.js';
import * as legacyPushJs from '../../js/push-model.js';

const legacyCards = legacyCardsJs as unknown as typeof portedCards;
const legacyPush = legacyPushJs as unknown as typeof portedPush;

const PAGE_OF: Readonly<Record<string, string>> = Object.freeze({
  calculator: 'calculator.html',
  catalogue: 'catalogue.html',
  orders: 'orders.html',
  suppliers: 'suppliers.html',
  pastries: 'pastries.html',
  foodcost: 'foodcost.html',
  inventory: 'inventory.html',
});

describe.each([
  ['shared/ (TypeScript)', portedCards, portedPush],
  ['js/ (current app)', legacyCards, legacyPush],
] as const)('%s', (_name, c, p) => {
  // The work, as opposed to the money: visible to employees unless hidden.
  const optInIds: readonly string[] = c.OPT_IN_IDS;
  const EVERYDAY = c.HIDEABLE_IDS.filter(id => !optInIds.includes(id));

  // ── 1. The judgement ─────────────────────────────────────────────────────────

  test('a venue that has never heard of the field hides no everyday card', () => {
    for (const doc of [null, undefined, {}, { name: 'Bakery' }, 'corrupt', 42]) {
      for (const id of EVERYDAY) {
        expect(c.isHiddenForStaff(doc, id), `${JSON.stringify(doc)} hid ${id}`).toBe(false);
      }
    }
  });

  test('⚠️ only a literal true hides a card', () => {
    for (const value of [false, 'true', 1, null, {}, [], 'yes']) {
      const doc = { [c.HIDDEN_FIELD]: { pastries: value } };
      expect(c.isHiddenForStaff(doc, 'pastries'),
        `${JSON.stringify(value)} must read as visible — a cosmetic switch must never empty a Home`).toBe(false);
    }
    expect(c.isHiddenForStaff({ [c.HIDDEN_FIELD]: { pastries: true } }, 'pastries')).toBe(true);
  });

  test('a corrupt map hides nothing', () => {
    for (const map of [true, 'pastries', ['pastries'], 7]) {
      expect(c.isHiddenForStaff({ [c.HIDDEN_FIELD]: map }, 'pastries')).toBe(false);
    }
  });

  test('hiding one card hides that card and no other', () => {
    const doc = { [c.HIDDEN_FIELD]: { orders: true } };
    for (const id of EVERYDAY) {
      expect(c.isHiddenForStaff(doc, id), id).toBe(id === 'orders');
    }
    // ⚠️ Suppliers shares the `orders` SECTION — and must not share its switch.
    expect(c.cardVisibleTo(doc, false, 'suppliers')).toBe(true);
  });

  test('⚠️⚠️ owners, managers and head chefs see every card, whatever is hidden', () => {
    const everything = { [c.HIDDEN_FIELD]: Object.fromEntries(c.HIDEABLE_IDS.map(id => [id, true])) };
    for (const id of c.HIDEABLE_IDS) {
      expect(c.cardVisibleTo(everything, true, id), `a manager lost ${id}`).toBe(true);
      expect(c.cardVisibleTo(everything, false, id), `an employee still sees ${id}`).toBe(false);
    }
  });

  test('only a literal canManage === true passes the switch', () => {
    const doc = { [c.HIDDEN_FIELD]: { pastries: true } };
    for (const canManage of [undefined, null, 'true', 1, false]) {
      expect(c.cardVisibleTo(doc, canManage, 'pastries'), String(canManage)).toBe(false);
    }
  });

  test('a card with no id, or one this layer does not know, is never hidden', () => {
    const doc = { [c.HIDDEN_FIELD]: { toString: true }, [c.SHOWN_FIELD]: {} };
    for (const id of [undefined, '', 'toString', '__proto__', 'nothing']) {
      expect(c.cardVisibleTo(doc, false, id), String(id)).toBe(true);
    }
  });

  test('the ids are the seven Home cards, and the two money cards are the opt-in ones', () => {
    expect([...c.HIDEABLE_IDS]).toStrictEqual(
      ['calculator', 'catalogue', 'orders', 'suppliers', 'pastries', 'foodcost', 'inventory']);
    expect([...c.OPT_IN_IDS]).toStrictEqual(['foodcost', 'inventory']);
    expect(Object.isFrozen(c.STAFF_CARDS) && c.STAFF_CARDS.every(Object.isFrozen)).toBeTruthy();
  });

  test('⚠️⚠️ a money card is HIDDEN from employees until the venue shows it — and only a literal true shows it', () => {
    for (const doc of [null, undefined, {}, { name: 'Bakery' }, 'corrupt']) {
      for (const id of c.OPT_IN_IDS) {
        expect(c.isHiddenForStaff(doc, id), `${JSON.stringify(doc)} showed ${id}`).toBe(true);
      }
    }
    for (const value of [false, 'true', 1, null, {}, []]) {
      expect(c.cardVisibleTo({ [c.SHOWN_FIELD]: { foodcost: value } }, false, 'foodcost'), JSON.stringify(value)).toBe(false);
    }
    expect(c.cardVisibleTo({ [c.SHOWN_FIELD]: { foodcost: true } }, false, 'foodcost')).toBe(true);
    expect(c.cardVisibleTo({ [c.SHOWN_FIELD]: { foodcost: true } }, false, 'inventory'),
      'showing Food cost does not show the Stocktake').toBe(false);
  });

  test('⚠️ the two maps do not cross: «hidden» cannot touch a money card, nor «shown» an everyday one', () => {
    expect(c.isHiddenForStaff({ [c.HIDDEN_FIELD]: { foodcost: false } }, 'foodcost'),
      'a false in the hidden map is not a way to show the accounts').toBe(true);
    expect(c.isHiddenForStaff({ [c.SHOWN_FIELD]: { pastries: false } }, 'pastries')).toBe(false);
  });

  // ── 6. Hidden means silent, for employees ────────────────────────────────────
  //
  // Federico, 13 Sep 2026: «se le nascondo i dipendenti non ricevono le notifiche perche'
  // vuol dire che non voglio che usino quella scheda».

  test('⚠️ every notification kind belongs to the card whose page it opens', () => {
    for (const kind of p.PUSH_KINDS) {
      const card = p.cardForKind(kind);
      expect(c.HIDEABLE_IDS.includes(card), `${kind} → ${card} is not a card this app can hide`).toBeTruthy();
      expect(p.targetPage(kind), `${kind} opens a page that is not its card's`).toBe(`./${PAGE_OF[card]}`);
    }
  });

  test('employeePush is true exactly for the cards an employee can be notified about', () => {
    // A client order goes to every phone; a timer to whoever set it; an order list only to
    // whoever runs the place (managersAmong), so an employee has nothing to silence there.
    const reachesEmployees: Readonly<Record<string, boolean>> = { order: true, timer: true, orderRequest: false };
    for (const kind of p.PUSH_KINDS) {
      const card = c.STAFF_CARDS.find(candidate => candidate.id === p.cardForKind(kind));
      expect(card?.employeePush, `${kind} → ${card?.id}`).toBe(reachesEmployees[kind]);
    }
    for (const card of c.STAFF_CARDS.filter(candidate => !p.PUSH_KINDS.some(k => p.cardForKind(k) === candidate.id))) {
      expect(card.employeePush, `${card.id} receives no notification at all`).toBe(false);
    }
  });

  // The decision, RUN — the server hands mayBeTold() the two documents it read.
  test('⚠️⚠️ mayBeTold: nothing hidden means everybody, and no role is needed', () => {
    for (const doc of [null, {}, { [c.HIDDEN_FIELD]: { orders: true } }, { [c.HIDDEN_FIELD]: { calculator: false } }]) {
      expect(c.mayBeTold(doc, 'calculator', ['a', 'b'], new Map()), JSON.stringify(doc)).toBe(null);
    }
  });

  test('⚠️⚠️ mayBeTold: a hidden card silences employees and nobody else', () => {
    const doc = { [c.HIDDEN_FIELD]: { calculator: true } };
    const access = new Map<string, unknown>([['emp', true], ['mgr', 'manager'], ['own', 'owner'], ['typo', 'manager ']]);
    const told = c.mayBeTold(doc, 'calculator', ['emp', 'mgr', 'own', 'typo', 'unread'], access);
    expect([...(told ?? [])].sort(),
      'owner and manager (a head chef holds manager) are told; an employee, a corrupt role and an unreadable one are not')
      .toStrictEqual(['mgr', 'own']);
  });

  test('mayBeTold: no uid, a non-string uid and a missing map tell nobody and do not throw', () => {
    const doc = { [c.HIDDEN_FIELD]: { catalogue: true } };
    expect([...(c.mayBeTold(doc, 'catalogue', ['', null, undefined, 42], new Map([['42', 'owner']])) ?? [])]).toStrictEqual([]);
    expect([...(c.mayBeTold(doc, 'catalogue', ['x'], undefined) ?? [])]).toStrictEqual([]);
    expect([...(c.mayBeTold(doc, 'catalogue', 'x', new Map()) ?? [])]).toStrictEqual([]);
  });

  // ── 7. The order, and the money cards (13 Sep 2026) ──────────────────────────
  //
  // Federico: «devo poter cambiare l'ordine trascinandole» (for the whole venue), and
  // «voglio poter decidere tutto dall'app tutte le card che ci sono nella home».

  test('⚠️ a saved order keeps known ids once each and drops everything else', () => {
    expect(c.cleanOrder(['orders', 'orders', 'nope', 7, null, 'calculator'])).toStrictEqual(['orders', 'calculator']);
    for (const bad of [null, undefined, 'orders', {}, 42]) expect(c.cleanOrder(bad)).toStrictEqual([]);
  });

  test('the server accepts only a clean, non-empty list of known ids', () => {
    expect(c.isValidOrder(['pastries', 'orders'])).toBe(true);
    expect(c.isValidOrder([...c.HIDEABLE_IDS])).toBe(true);
    for (const bad of [[], ['orders', 'orders'], ['orders', 'nope'], 'orders', null, [...c.HIDEABLE_IDS, 'calculator'], [1]]) {
      expect(c.isValidOrder(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test('⚠️⚠️ the Home follows the saved order, and a card the order does not name keeps its place after it', () => {
    const markup = ['calculator', 'catalogue', 'orders', 'suppliers', 'pastries'];
    expect(c.orderedCardIds({}, markup), 'no order: the markup order').toStrictEqual(markup);
    expect(c.orderedCardIds(null, markup)).toStrictEqual(markup);
    expect(c.orderedCardIds({ [c.ORDER_FIELD]: ['pastries', 'orders'] }, markup))
      .toStrictEqual(['pastries', 'orders', 'calculator', 'catalogue', 'suppliers']);
    expect(c.orderedCardIds({ [c.ORDER_FIELD]: ['foodcost', 'orders'] }, ['calculator', 'orders']),
      'a card the Home does not show is simply not there').toStrictEqual(['orders', 'calculator']);
    expect(c.orderedCardIds({ [c.ORDER_FIELD]: 'corrupt' }, markup)).toStrictEqual(markup);
  });
});
