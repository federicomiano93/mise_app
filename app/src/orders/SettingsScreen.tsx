import { useEffect, useId, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useLocation } from 'react-router';
import { todayISO } from '@mise/shared/day';
import { turningOnForgets } from '@mise/shared/delivery-check';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useOrders, useOrdersStore } from './OrdersContext';
import { askNoticePermission, noticePermission } from './calendarNotices';
import type { NoticePermission } from './calendarNotices';
import { SETTINGS_OPENER, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { ORDERS_PATH } from './ordersPath';
import { phoneMuted, phoneToken, rememberPhoneMute } from './phoneMute';
import { LONG_MS } from './useClearQuantities';
import styles from './SettingsScreen.module.css';

// «Settings» of Orders, at /orders/settings (step 3f-4), one level below the list. For now it holds the goods-arrived switch
// (step 3f-5) and this phone's alerts; the rest of the Orders settings arrive with slice 3f-8. Back is Back (P20).
export function SettingsScreen() {
  const { t } = useT();
  const { state } = useLocation();
  const { config, configLoaded, deliveryCheck } = useOrders();
  const [confirm, confirmDialog] = useConfirm();
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

  useEffect(() => {
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.settings.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
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
                  if (outcome === 'refused') say(t('ord.settings.managersOnly'), LONG_MS);
                  else if (outcome === 'failed') say(t('ord.incoming.couldNotSave'), LONG_MS);
                }, () => { say(t('ord.incoming.couldNotSave'), LONG_MS); });
              }}
            />
          </div>
        </div>

        {/* ⚠️ A PROPERTY OF THIS PHONE, not of the person (somebody may want the alert in a pocket and not on the kitchen tablet), and it
            SILENCES THE BUZZ, NEVER THE WORK: the line under it says so. Shown only while the venue has order lists. A DELIBERATE
            DIFFERENCE from the current app, which pretends: a phone with no alert token has nothing to silence, so the switch is off
            and disabled and says why. */}
        {config.orderLists !== false ? (
          <div className={styles.card}>
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
          </div>
        ) : null}

        {/* Notices on THIS phone (step 3f-6, parity R12): per device, no push. The explanation, then what the browser says. */}
        <section className={styles.card} aria-labelledby={noticesTitle}>
          <div className={styles.block}>
            <h2 id={noticesTitle} className={styles.doorTitle}>{t('ord.settings.noticesTitle')}</h2>
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
        </section>
      </div>
      {confirmDialog}
    </section>
  );
}
