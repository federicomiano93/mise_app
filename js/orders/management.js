// management.js — the Orders SETTINGS panel (the gear in the bottom bar).
//
// Order lists on or off, how the order screen looks, when the working week starts,
// which roads an order may leave by, the alerts, History and Help. That is all it is now, and the word above the
// screen finally matches what is behind it.
//
// ⚠️ THE SUPPLIER AND INGREDIENT RECORDS LEFT THIS FILE. They were here — two lists
// of business data sitting under a gear, four levels down — and they are neither
// settings nor rare: the ingredient form is where the whole allergen job happens.
// They live on their own screen now (js/orders/registry.js, suppliers.html), one
// tap from the Home. The helpers both halves still share are in js/orders/mgmt-ui.js.
//
// ⚠️ THE PANEL IS OPEN TO EVERYBODY IN THE LOCATION, AND THAT IS THE DESIGN, not
// a leftover. isAdmin below is the old placeholder from before roles existed; it
// still reads `true` because the panel really is for everybody. What is gated is
// each individual control — two of the four sections are drawn only for whoever
// runs the place, and firestore.rules refuses the write regardless of what this
// page decides to show (P2).
//
// data: { ordersConfig(): {} } — a live getter from orders-main.
// actions: { onClose, saveOrdersConfig(patch) }

import { t } from '../i18n.js';
import { el } from './dom.js';
import { canManageHere } from './firebase-orders.js';
import { renderNotificationSettings } from './notifications.js';
import { alertDialog } from './confirm-dialog.js';
import { ROUTES, validateRoutes, toStored, listsAreTheOnlyRoad } from './send-routes.js';
import { WEEKDAYS as WEEK_START_DAYS, isValidWeekStart } from './work-week.js';
// ⚠️ THE SWITCH LIVES HERE, NOT IN notifications.js. That file is importable under
// Node and has its own test suite BECAUSE it touches no Firebase; importing push.js
// into it pulled the SDK in from an https: URL and broke the whole suite at load.
// A screen that already talks to Firestore is the right home for a control that does.
import { muteOrderRequests, orderRequestsMuted, rememberMute } from '../push.js';
import { BACK_ICON, reportFailure } from './mgmt-ui.js';
import { showHelp } from '../help-button.js';

export const isAdmin = true; // the panel is for everybody; each control is gated on its own

export function buildManagement(data, actions) {
  const content = el('div', { class: 'mgmt-scroll set-screen' });

  // ⚠️ «SAVED ✓» MUST SURVIVE THE REDRAW IT CAUSES. A save writes config/orders, whose
  // snapshot comes straight back and redraws this whole panel (refresh → render) — so
  // a chip shown on the row that was tapped vanished with that row before anybody saw
  // it (found by the driven run). The last save is remembered here, by the row's
  // title, and every freshly built row asks whether it is the one to show it on.
  // ⚠️ AND THE REDRAW USUALLY COMES FIRST: Firestore hands the local write back as a
  // snapshot before the save's own promise resolves, so the row that is on screen when
  // the save finishes is a NEW one. `chips` always holds the chip of the row currently
  // drawn for each title, and markSaved() lights that one.
  let lastSaved = { title: null, until: 0 };
  const chips = new Map();
  function savedChip(title) {
    const chip = el('span', { class: 'set-saved', text: t('settings.saved'), hidden: true });
    chips.set(title, chip);
    const left = lastSaved.title === title ? lastSaved.until - Date.now() : 0;
    if (left > 0) {
      chip.hidden = false;
      setTimeout(() => { chip.hidden = true; }, left);
    }
    return chip;
  }
  function markSaved(title) {
    lastSaved = { title, until: Date.now() + 2000 };
    const chip = chips.get(title);
    if (!chip) return;
    chip.hidden = false;
    setTimeout(() => { chip.hidden = true; }, 2000);
  }

  // ⚠️ NO TAB BAR ANY MORE. It carried Suppliers / Ingredients / General, and with
  // the first two gone a bar of one tab is a control that appears to do nothing.
  const overlay = el('div', { class: 'mgmt-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', { type: 'button', class: 'orders-icon-btn', 'aria-label': t('ui.back'), icon: BACK_ICON, onClick: () => actions.onClose() }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: t('ui.settings') })]),
      el('span', { class: 'header-spacer' }),
    ]),
    content,
  ]);

  // ⚠️ SECTIONS, EACH ANSWERING ONE QUESTION (Federico, 14 Aug 2026: «dividi in
  // sezioni le impostazioni per renderle più chiare»), drawn with the app's ONE
  // settings look since 28 Sep 2026 (tokens.css .set-*: «migliora la UX di tutte le
  // impostazioni»). Every switch here saves on the tap — the rule written above
  // .set-section in tokens.css.
  //
  // ⚠️ SOME ARE FOR WHOEVER RUNS THE PLACE, and the database says the same:
  // config/orders is write-gated on canManage(). Hiding them is COURTESY — an employee
  // who reached the screen anyway would simply have the write refused, which is the
  // shape every guard in this app has (v269: hiding is not the feature).
  function render() {
    content.textContent = '';
    const boss = canManageHere();
    const config = data.ordersConfig();

    if (boss) {
      section('orders.lists.title', 'orders.lists.note', [buildOrderListsSwitch(config)]);
    }
    section('orders.section.orderScreen', null, [buildStockSwitch(config)]);
    if (boss) section('orders.weekStart.title', 'orders.weekStart.hint', [buildWeekStart(config)]);
    if (boss) section('orders.section.howSent', 'orders.send.settingsHint', buildSendRoutes(config));

    const notif = el('div', { class: 'mgmt-notif' });
    renderNotificationSettings(notif);
    section('orders.section.alerts', 'orders.alerts.thisPhone', [
      el('div', { class: 'set-block' }, [notif]),
      config.orderLists ? buildMuteOrderRequests() : null,
    ]);

    // ⚠️ HISTORY IS A DOOR AMONG SETTINGS (Federico moved it in here from the bottom
    // bar on 24 Aug 2026), and the field that says how far back it draws belongs with
    // it and nowhere else. HELP moved in here on 28 Sep 2026: the «?» no longer fits
    // the phone's green bar beside the bell and the order lists.
    section('orders.section.more', null, [
      actions.openHistory ? door('orders.settings.openHistory', null, () => actions.openHistory()) : null,
      actions.openHistory ? buildHistoryDaysField(config) : null,
      door('orders.settings.help', 'orders.settings.helpSub', () => showHelp('orders')),
    ]);
  }

  // A card: its title (and one line under it), then its rows. A section with no rows
  // is not drawn, so a title can never sit over nothing.
  function section(titleKey, noteKey, rows) {
    const inner = rows.filter(Boolean);
    if (!inner.length) return;
    content.appendChild(el('section', { class: 'set-section' }, [
      el('div', { class: 'set-head' }, [
        el('h3', { text: t(titleKey) }),
        noteKey ? el('p', { text: t(noteKey) }) : null,
      ]),
      ...inner,
    ]));
  }

  // A row that opens another screen.
  function door(titleKey, subKey, onClick) {
    return el('button', { type: 'button', class: 'set-row set-door', onClick }, [
      el('span', { class: 'set-text' }, [
        el('span', { class: 'set-title', text: t(titleKey) }),
        subKey ? el('span', { class: 'set-sub', text: t(subKey) }) : null,
      ]),
    ]);
  }

  // A switch that saves on the tap: optimistic, «Saved ✓» for two seconds, and put
  // back — with the reason said — if the write is refused.
  // `sub` may be a function of the current value, for a line that says what ON means.
  function switchRow({ title, sub, checked, save, failLabel, before }) {
    const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': title });
    input.checked = checked;
    const subEl = el('span', { class: 'set-sub' });
    const paintSub = () => {
      const text = typeof sub === 'function' ? sub(input.checked) : sub;
      subEl.textContent = text || '';
      subEl.hidden = !text;
    };
    paintSub();
    const saved = savedChip(title);

    input.addEventListener('change', async () => {
      const wanted = input.checked;
      if (before && !(await before(wanted))) { input.checked = !wanted; return; }
      input.disabled = true;
      try {
        await save(wanted);
        paintSub();
        markSaved(title);
      } catch (err) {
        input.checked = !wanted;       // back to what is actually stored
        paintSub();
        await reportFailure('save', failLabel || title, err);
      } finally {
        input.disabled = false;
      }
    });

    return el('div', { class: 'set-row' }, [
      el('span', { class: 'set-text' }, [el('span', { class: 'set-title', text: title }), subEl]),
      saved,
      el('label', { class: 'set-switch' }, [input, el('span', { class: 'set-switch-track', 'aria-hidden': 'true' })]),
    ]);
  }

  // Order lists on or off for the whole venue (28 Sep 2026, config/orders.orderLists).
  //
  // ⚠️ OFF TAKES A ROAD AWAY, so it is refused — and said — when it is the ONLY road an
  // employee has: turning it off then would leave the staff with no way to send an
  // order at all, which is the one outcome the send settings exist to prevent.
  function buildOrderListsSwitch(config) {
    return switchRow({
      title: t('orders.lists.switch'),
      sub: on => t(on ? 'orders.lists.onSub' : 'orders.lists.offSub'),
      checked: config.orderLists,
      save: on => actions.saveOrdersConfig({ orderLists: on }),
      before: async on => {
        if (on || !listsAreTheOnlyRoad(data.ordersConfig().sendSettings)) return true;
        await alertDialog(t('orders.lists.needAnotherRoad'));
        return false;
      },
    });
  }

  // Show or hide the Stock box on every order row, for EVERY phone (Firestore, not
  // this device). There is nothing to lose by getting it wrong: one more tap undoes it.
  function buildStockSwitch(config) {
    return switchRow({
      title: t('orders.showTheStockBox'),
      sub: t('orders.turnThisOffIf'),
      checked: config.showStock,
      save: on => actions.saveOrdersConfig({ showStock: on }),
      failLabel: t('orders.showStock'),
    });
  }

  // "Do not buzz this phone about order lists."
  //
  // ⚠️ ONE SWITCH, for the one alert somebody asked to be able to turn off.
  // ⚠️ IT SILENCES THE BUZZ, NEVER THE WORK, and the line under it says so.
  // ⚠️ A PROPERTY OF THIS PHONE, not of the person: somebody may want the alert in their
  // pocket and not on the tablet in the kitchen.
  function buildMuteOrderRequests() {
    return switchRow({
      title: t('orders.mute.orderRequests'),
      sub: t('orders.mute.stillShown'),
      checked: orderRequestsMuted(),
      save: async on => { await muteOrderRequests(on); rememberMute(on); },
    });
  }

  // Which day the working week starts on.
  //
  // ⚠️ IT DECIDES WHAT «THIS WEEK» MEANS ON INCOMING — a decision about how the venue
  // works, which is why the database gates the write on canManage().
  // ⚠️ A <select>, not seven buttons: seven targets on a 320px phone is how a bar wraps.
  function buildWeekStart(config) {
    const current = config.weekStartsOn;
    const sel = el('select', { class: 'set-select', 'aria-label': t('orders.weekStart.title') });
    // ⚠️ THE SHORT NAMES the dictionary already carries in both languages.
    WEEK_START_DAYS.forEach((day, i) => {
      const opt = el('option', { value: day, text: t(`day.weekdayShort.${i}`) });
      if (day === current) opt.selected = true;
      sel.appendChild(opt);
    });
    const saved = savedChip(t('orders.weekStart.title'));

    sel.addEventListener('change', async () => {
      const wanted = sel.value;
      // ⚠️ Checked before the network: a value the app does not recognise would be
      // read back as Sunday, so the screen would show one thing and the list do another.
      if (!isValidWeekStart(wanted)) { sel.value = current; return; }
      sel.disabled = true;
      try {
        await actions.saveOrdersConfig({ weekStartsOn: wanted });
        markSaved(t('orders.weekStart.title'));
      } catch (err) {
        sel.value = current;          // back to what is actually stored
        await reportFailure('save', t('orders.weekStart.title'), err);
      } finally {
        sel.disabled = false;
      }
    });

    return el('div', { class: 'set-row' }, [
      el('span', { class: 'set-text' }, [el('span', { class: 'set-title', text: t('orders.weekStart.row') })]),
      saved,
      sel,
    ]);
  }

  // Which roads an employee may send an order by — one switch per road.
  //
  // ⚠️ THE SWITCHES SAY WHAT AN EMPLOYEE MAY USE. Whoever runs the place keeps all of
  // them whatever they say (send-routes.js routesFor); the note under the title says so.
  // ⚠️ AND IT IS A SIGNPOST, NOT A LOCK: WhatsApp and email live outside this app.
  // ⚠️ «TO THE MANAGER» IS AN ORDER LIST, so with order lists off its switch is not
  // drawn at all — the road is gone for everybody (send-routes.js).
  function buildSendRoutes(config) {
    const current = config.sendSettings;
    const routes = { ...current.routes };
    let preferred = current.preferred;

    const rows = ROUTES
      .filter(route => route !== 'manager' || config.orderLists)
      .map(route => switchRow({
        title: t(`orders.send.route.${route}`),
        checked: routes[route] === true,
        failLabel: t('orders.send.settingsTitle'),
        // ⚠️ THE LAST ROAD CANNOT BE CLOSED, and the refusal is SAID.
        before: async on => {
          const verdict = validateRoutes({ ...routes, [route]: on }, preferred);
          if (verdict.ok) return true;
          await alertDialog(t('orders.send.mustKeepOne'));
          return false;
        },
        save: async on => {
          const verdict = validateRoutes({ ...routes, [route]: on }, preferred);
          await actions.saveOrdersConfig(toStored(verdict.routes, verdict.preferred));
          Object.assign(routes, verdict.routes);
          preferred = verdict.preferred;
        },
      }));
    // ⚠️ SAID PLAINLY: believing an email has gone when it is sitting in drafts is the
    // worst outcome this road has.
    rows.push(el('div', { class: 'set-block' }, [
      el('p', { class: 'set-sub', text: t('orders.send.emailOpensApp') }),
    ]));
    return rows;
  }

  // How far back History reaches. It HIDES and never deletes, and the line under it
  // says so. Saved on `change` (blur or Enter), not per keystroke: typing "20" passes
  // through "2", and saving that would push a 2-day window onto every phone.
  function buildHistoryDaysField(config) {
    const input = el('input', {
      type: 'number', min: '1', max: '365', inputmode: 'numeric',
      class: 'set-input', id: 'history-days-input',
    });
    input.value = String(config.historyDays);
    const saved = savedChip(t('orders.daysOfPastOrders'));

    input.addEventListener('change', async () => {
      const stored = data.ordersConfig().historyDays;
      const wanted = Math.floor(Number(input.value));
      // Refuse rather than store: an empty box or a 0 would render an EMPTY History,
      // which reads as "the orders have been deleted".
      if (!Number.isFinite(wanted) || wanted < 1 || wanted > 365) {
        input.value = String(stored);
        return;
      }
      if (wanted === stored) return;

      input.disabled = true;
      try {
        await actions.saveOrdersConfig({ historyDays: wanted });
        markSaved(t('orders.daysOfPastOrders'));
      } catch (err) {
        input.value = String(stored);   // back to what is actually stored
        await reportFailure('save', t('orders.daysOfHistory'), err);
      } finally {
        input.disabled = false;
      }
    });

    return el('div', { class: 'set-block' }, [
      el('label', { class: 'set-label', for: 'history-days-input', text: t('orders.daysOfPastOrders') }),
      el('div', { class: 'mgmt-days-row' }, [input, el('span', { text: t('orders.days') }), saved]),
      el('p', { class: 'set-sub', text: t('orders.olderOrdersAreNever') }),
    ]);
  }

  render();

  // Redrawn when config/orders changes on another phone — the only live document
  // this panel shows.
  return { overlay, refresh: render };
}
