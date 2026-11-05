import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { useLocation, useNavigationType } from 'react-router';
import { todayISO } from '@mise/shared/day';
import { turningOnForgets } from '@mise/shared/delivery-check';
import { HISTORY_LIVE_MONTHS } from '@mise/shared/history-window';
import { ROUTES } from '@mise/shared/send-routes';
import { WEEKDAYS } from '@mise/shared/work-week';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { useOrders, useOrdersStore } from './OrdersContext';
import { askNoticePermission, noticePermission } from './calendarNotices';
import type { NoticePermission } from './calendarNotices';
import { SETTINGS_OPENER, SUPPLIER_ORDER_DOOR, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { ORDERS_PATH } from './ordersPath';
import { phoneMuted, phoneToken, rememberPhoneMute } from './phoneMute';
import { MAX_HISTORY_DAYS, MIN_HISTORY_DAYS } from './settingsPatch';
import type { SettingChange } from './settingsPatch';
import type { SettingOutcome } from './ordersStore';
import { LONG_MS } from './useClearQuantities';
import styles from './SettingsScreen.module.css';

// How long «Saved ✓» stays beside what was just saved (the current app's number).
const SAVED_MS = 2000;

// The short weekday names, Sunday first like WEEKDAYS.
const WEEKDAY_KEYS = [
  'day.weekdayShort.0', 'day.weekdayShort.1', 'day.weekdayShort.2', 'day.weekdayShort.3',
  'day.weekdayShort.4', 'day.weekdayShort.5', 'day.weekdayShort.6',
] as const;

// What a setting says when it cannot be changed the usual way: the alerts of the two refusals that need a sentence.
type Alerts = { readonly onlyRoad?: string; readonly lastRoad?: string };
type Write = (change: SettingChange, alerts?: Alerts) => Promise<SettingOutcome>;

// «Saved ✓», said where it happened. Its live region is on the page, empty, before it speaks.
function useSavedChip(): readonly [boolean, () => void] {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const show = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setShown(true);
    timer.current = setTimeout(() => { timer.current = null; setShown(false); }, SAVED_MS);
  }, []);
  return [shown, show];
}

function SavedTag({ shown }: { shown: boolean }) {
  const { t } = useT();
  return <span role="status" className={shown ? styles.saved : styles.quiet}>{shown ? t('settings.saved') : ''}</span>;
}

// A card with a title (an h2) and, where the current app has one, a line under it.
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.doorTitle}>{title}</h2>
        {note === undefined ? null : <p className={styles.sub}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

type SwitchProps = {
  title: string;
  sub?: string;
  selected: boolean;
  // Cannot be flipped by this person: the line that says who can is joined to the switch.
  locked?: boolean;
  change: (next: boolean) => SettingChange;
  alerts?: Alerts;
  write: Write;
  loaded: boolean;
};

// One switch of config/orders: saves on the tap, says «Saved ✓» beside itself, and FOLLOWS THE DATA, so a refusal leaves it as stored.
function SwitchSetting({ title, sub, selected, locked = false, change, alerts, write, loaded }: SwitchProps) {
  const { t } = useT();
  const titleId = useId();
  const subId = useId();
  const noteId = useId();
  const [saved, showSaved] = useSavedChip();
  const described = [sub === undefined ? '' : subId, locked ? noteId : ''].filter(Boolean).join(' ');
  return (
    <div className={styles.switchRow}>
      <span className={styles.text}>
        <span id={titleId} className={styles.doorTitle}>{title}</span>
        {sub === undefined ? null : <span id={subId} className={styles.sub}>{sub}</span>}
        {locked ? <span id={noteId} className={styles.sub}>{t('ord.settings.managersOnly')}</span> : null}
      </span>
      <SavedTag shown={saved} />
      <SettingSwitch
        selected={selected}
        // ⚠️ OFF UNTIL THE CONFIG HAS ARRIVED: before that the switch shows the default and a tap would write from the defaults.
        isDisabled={locked || !loaded}
        labelledBy={titleId}
        describedBy={described === '' ? undefined : described}
        onChange={next => { void write(change(next), alerts).then(outcome => { if (outcome === 'saved') showSaved(); }); }}
      />
    </div>
  );
}

// Which day the working week starts on: a select of the short names, saved on the change.
function WeekStartRow({ write, loaded }: { write: Write; loaded: boolean }) {
  const { t } = useT();
  const { config } = useOrders();
  const labelId = useId();
  const [saved, showSaved] = useSavedChip();
  return (
    <div className={styles.switchRow}>
      <span className={styles.text}>
        <span id={labelId} className={styles.doorTitle}>{t('ord.settings.weekStarts')}</span>
      </span>
      <SavedTag shown={saved} />
      <select
        className={styles.select}
        aria-labelledby={labelId}
        value={config.weekStartsOn}
        disabled={!loaded}
        onChange={event => {
          void write({ kind: 'weekStart', day: event.target.value }).then(outcome => { if (outcome === 'saved') showSaved(); });
        }}
      >
        {WEEKDAYS.map((day, index) => {
          const key = WEEKDAY_KEYS[index];
          return key === undefined ? null : <option key={day} value={day}>{t(key)}</option>;
        })}
      </select>
    </div>
  );
}

// Days of past orders shown in History: saved when the box is left or Enter is pressed, never per keystroke.
function HistoryDaysRow({ write, loaded }: { write: Write; loaded: boolean }) {
  const { t } = useT();
  const { config } = useOrders();
  const { canManage } = useSession();
  const say = useStatusMessage();
  const boxId = useId();
  const keptId = useId();
  const noteId = useId();
  const [saved, showSaved] = useSavedChip();
  const stored = String(config.historyDays);
  const [text, setText] = useState(stored);
  const focused = useRef(false);
  // The text last handed to the store, so Enter followed by the blur it causes writes once.
  const handed = useRef(stored);
  useEffect(() => {
    // ⚠️ A BOX THAT HAS THE FOCUS IS NEVER OVERWRITTEN: another phone's change must not rewrite the digits under the finger.
    if (focused.current) return;
    setText(stored);
    handed.current = stored;
  }, [stored]);

  const commit = () => {
    if (text === handed.current) return;
    handed.current = text;
    void write({ kind: 'historyDays', value: text }).then(outcome => {
      if (outcome === 'saved') {
        showSaved();
      } else if (outcome === 'invalid') {
        say(t('ord.settings.historyDaysRange'), LONG_MS);
        setText(stored);
        handed.current = stored;
      } else if (outcome === 'unchanged') {
        setText(stored);
        handed.current = stored;
      }
    });
  };

  return (
    <div className={styles.block}>
      <label htmlFor={boxId} className={styles.doorTitle}>{t('ord.settings.historyDays')}</label>
      <div className={styles.inline}>
        <input
          id={boxId}
          className={styles.number}
          type="number"
          inputMode="numeric"
          min={MIN_HISTORY_DAYS}
          max={MAX_HISTORY_DAYS}
          value={text}
          disabled={!canManage || !loaded}
          aria-describedby={canManage ? keptId : `${keptId} ${noteId}`}
          onFocus={() => { focused.current = true; }}
          onChange={event => { setText(event.target.value); }}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={event => { if (event.key === 'Enter') commit(); }}
        />
        <span className={styles.sub}>{t('ord.settings.historyDaysWord')}</span>
        <SavedTag shown={saved} />
      </div>
      <p id={keptId} className={styles.sub}>{t('ord.settings.historyKept', { n: HISTORY_LIVE_MONTHS })}</p>
      {canManage ? null : <p id={noteId} className={styles.sub}>{t('ord.settings.managersOnly')}</p>}
    </div>
  );
}

// «Settings» of Orders, at /orders/settings (steps 3f-4, 3f-5, 3f-8a), one level below the list. Back is Back (P20).
//
// ⚠️ SOME SECTIONS ARE FOR WHOEVER RUNS THE PLACE (lists, the week, the roads, the supplier order): the rules let only an owner or a
// manager write config/orders, so for anybody else they are not drawn. The Stock box and the days of History are shown LOCKED, with the
// line that says who can change them: hidden, nobody would know where the setting went (parity F5). Every control is off until the
// config has arrived and saves on the tap.
export function SettingsScreen({ onOpenSupplierOrder }: { onOpenSupplierOrder: () => void }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const { config, configLoaded, deliveryCheck } = useOrders();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const store = useOrdersStore();
  const { canManage } = useSession();
  const say = useStatusMessage();
  const switchTitle = useId();
  const switchSub = useId();
  const switchNote = useId();
  const muteTitle = useId();
  const muteSub = useId();
  const muteNote = useId();
  // This phone's alert token (js/push.js writes it) and whether the switch is on; read once, the screen is the only writer.
  const hasToken = phoneToken() !== '';
  const [muted, setMuted] = useState(phoneMuted);
  const handBack = useHandBack();
  const leave = useLeave(ORDERS_PATH, () => { handBack.expect(SETTINGS_OPENER); });
  const titleId = useId();
  const noticesTitle = useId();
  // What this phone's browser says about notifications; the button asks, and the answer redraws.
  const [permission, setPermission] = useState<NoticePermission>(noticePermission);
  const title = useRef<HTMLHeadingElement>(null);
  const doorRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(SUPPLIER_ORDER_DOOR, node); }, [handBack]);
  const [deliverySaved, showDeliverySaved] = useSavedChip();

  useEffect(() => {
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once. ⚠️ NOT ON A BACK FROM THE
    // SUPPLIER ORDER (a POP): the door that opened it is owed the focus then.
    if (cameFromList(state) && navigationType !== 'POP') title.current?.focus();
  }, []);

  // One write for every control: says why a refusal wrote nothing, or that the connection failed.
  const write: Write = async (change, alerts = {}) => {
    let outcome: SettingOutcome;
    try {
      outcome = await store.saveSetting(change);
    } catch {
      outcome = 'failed';
    }
    if (outcome === 'refused') say(t('ord.settings.managersOnly'), LONG_MS);
    else if (outcome === 'failed') say(t('ord.incoming.couldNotSave'), LONG_MS);
    else if (outcome === 'only-road' && alerts.onlyRoad !== undefined) await alert({ message: alerts.onlyRoad, okLabel: t('common.ok') });
    else if (outcome === 'last-road' && alerts.lastRoad !== undefined) await alert({ message: alerts.lastRoad, okLabel: t('common.ok') });
    return outcome;
  };

  const lists = config.orderLists;
  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.settings.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        {canManage ? (
          <Section title={t('ord.settings.listsTitle')} note={t('ord.settings.listsNote')}>
            <SwitchSetting
              title={t('ord.settings.listsSwitch')}
              sub={t(lists ? 'ord.settings.listsOn' : 'ord.settings.listsOff')}
              selected={lists}
              change={on => ({ kind: 'orderLists', on })}
              alerts={{ onlyRoad: t('ord.settings.listsNeedRoad') }}
              write={write}
              loaded={configLoaded}
            />
          </Section>
        ) : null}

        <Section title={t('ord.settings.orderScreenTitle')}>
          <SwitchSetting
            title={t('ord.settings.showStock')}
            sub={t('ord.settings.showStockSub')}
            selected={config.showStock}
            locked={!canManage}
            change={on => ({ kind: 'showStock', on })}
            write={write}
            loaded={configLoaded}
          />
          {canManage ? (
            <Button ref={doorRef} variant="bare" className={styles.door} onPress={onOpenSupplierOrder}>
              <span className={styles.text}>
                <span className={styles.doorTitle}>{t('ord.settings.supplierOrder')}</span>
                <span className={styles.sub}>{t('ord.settings.supplierOrderSub')}</span>
              </span>
              <ChevronRight aria-hidden="true" />
            </Button>
          ) : null}
        </Section>

        {canManage ? (
          <Section title={t('ord.settings.weekTitle')} note={t('ord.settings.weekHint')}>
            <WeekStartRow write={write} loaded={configLoaded} />
          </Section>
        ) : null}

        {canManage ? (
          <Section title={t('ord.settings.routesTitle')} note={t('ord.settings.routesHint')}>
            {/* ⚠️ «TO THE MANAGER» IS AN ORDER LIST, so with lists off its switch is not drawn: the road is gone for everybody. */}
            {ROUTES.filter(route => route !== 'manager' || lists).map(route => (
              <SwitchSetting
                key={route}
                title={t(`ord.send.route.${route}`)}
                selected={config.sendSettings.routes[route] === true}
                change={on => ({ kind: 'route', route, on })}
                alerts={{ lastRoad: t('ord.settings.routesKeepOne') }}
                write={write}
                loaded={configLoaded}
              />
            ))}
            <p className={styles.footnote}>{t('ord.settings.routesEmail')}</p>
          </Section>
        ) : null}

        {/* ⚠️ ONE SWITCH FOR THE WHOLE VENUE (decision F4): every phone must agree about what is owed. Only an owner or a manager
            flips it (the rules' canManage on config/orders), so a person without that sees it OFF-limits and told why, rather
            than a switch that answers «refused» after the tap. */}
        <div className={styles.card}>
          <div className={styles.switchRow}>
            <span className={styles.text}>
              <span id={switchTitle} className={styles.doorTitle}>{t('ord.settings.deliveryCheck')}</span>
              <span id={switchSub} className={styles.sub}>{t('ord.settings.deliveryCheckSub')}</span>
              {canManage ? null : <span id={switchNote} className={styles.sub}>{t('ord.settings.managersOnly')}</span>}
            </span>
            <SavedTag shown={deliverySaved} />
            <SettingSwitch
              selected={deliveryCheck.on}
              // ⚠️ OFF UNTIL THE CONFIG HAS ARRIVED: before that the switch shows the default (ON) and a tap would write the wrong thing.
              isDisabled={!canManage || !configLoaded}
              labelledBy={switchTitle}
              describedBy={canManage ? switchSub : `${switchSub} ${switchNote}`}
              onChange={async next => {
                // ⚠️ TURNING IT ON FORGETS THE ORDERS BEFORE TODAY, so it asks first (not on the day it was turned off: nothing is
                // forgotten then). Cancel writes nothing and the switch, which follows the data, stays off.
                if (next && turningOnForgets(deliveryCheck, todayISO())) {
                  const yes = await confirm({
                    title: t('ord.settings.turnOnTitle'),
                    message: t('ord.settings.turnOnMessage'),
                    okLabel: t('ord.settings.turnOnOk'),
                    cancelLabel: t('common.cancel'),
                  });
                  if (!yes) return;
                }
                void store.setDeliveryCheck(next).then(outcome => {
                  if (outcome === 'saved') showDeliverySaved();
                  else if (outcome === 'refused') say(t('ord.settings.managersOnly'), LONG_MS);
                  else if (outcome === 'failed') say(t('ord.incoming.couldNotSave'), LONG_MS);
                }, () => { say(t('ord.incoming.couldNotSave'), LONG_MS); });
              }}
            />
          </div>
        </div>

        {/* Alerts of THIS phone (steps 3f-6, 3f-7; parity R12, M7): per device. */}
        <Section title={t('ord.settings.alertsTitle')} note={t('ord.settings.alertsNote')}>
          {/* Notices on THIS phone (step 3f-6, parity R12): per device, no push. The explanation, then what the browser says. */}
          <div className={styles.block} role="group" aria-labelledby={noticesTitle}>
            <h3 id={noticesTitle} className={styles.doorTitle}>{t('ord.settings.noticesTitle')}</h3>
            <p className={styles.sub}>{t('ord.settings.noticesAbout')}</p>
            {permission === 'unsupported' ? <p>{t('ord.settings.noticesUnsupported')}</p> : null}
            {permission === 'granted' ? (
              <p className={styles.status}>
                <Bell aria-hidden="true" />
                <span>{t('ord.settings.noticesOn')}</span>
              </p>
            ) : null}
            {permission === 'denied' ? <p>{t('ord.settings.noticesBlocked')}</p> : null}
            {permission === 'default' ? (
              <Button
                className={styles.enable}
                onPress={() => { void askNoticePermission().then(setPermission); }}
              >
                <Bell aria-hidden="true" />
                {t('ord.settings.noticesEnable')}
              </Button>
            ) : null}
          </div>

          {/* ⚠️ A PROPERTY OF THIS PHONE, not of the person (somebody may want the alert in a pocket and not on the kitchen tablet), and it
              SILENCES THE BUZZ, NEVER THE WORK: the line under it says so. Shown only while the venue has order lists. A DELIBERATE
              DIFFERENCE from the current app, which pretends: a phone with no alert token has nothing to silence, so the switch is off
              and disabled and says why. */}
          {lists ? (
            <div className={styles.switchRow}>
              <span className={styles.text}>
                <span id={muteTitle} className={styles.doorTitle}>{t('ord.mute.orderRequests')}</span>
                <span id={muteSub} className={styles.sub}>{t('ord.mute.stillShown')}</span>
                {hasToken ? null : <span id={muteNote} className={styles.sub}>{t('ord.mute.noPhone')}</span>}
              </span>
              <SettingSwitch
                selected={hasToken && muted}
                isDisabled={!hasToken}
                labelledBy={muteTitle}
                describedBy={hasToken ? muteSub : `${muteSub} ${muteNote}`}
                onChange={next => {
                  setMuted(next);
                  const failed = () => { setMuted(!next); say(t('ord.incoming.couldNotSave'), LONG_MS); };
                  void store.setPhoneMute(phoneToken(), next).then(outcome => {
                    if (outcome === 'saved') rememberPhoneMute(next);
                    else failed();
                  }, failed);
                }}
              />
            </div>
          ) : null}
        </Section>

        <Section title={t('ord.history.title')}>
          <HistoryDaysRow write={write} loaded={configLoaded} />
        </Section>
      </div>
      {confirmDialog}
      {alertDialog}
    </section>
  );
}
