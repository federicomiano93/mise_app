import { useCallback, useEffect, useId, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
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
import { HISTORY_DOOR, SETTINGS_OPENER, useHandBack } from './handBack';
import { FROM_LIST, cameFromList, useLeave } from './ordersNav';
import { HISTORY_PATH, ORDERS_PATH } from './ordersPath';
import { LONG_MS } from './useClearQuantities';
import styles from './SettingsScreen.module.css';

// «Settings» of Orders, at /orders/settings (step 3f-4), one level below the list. For now it holds ONE door, «Past orders»
// (History) and the goods-arrived switch (step 3f-5); the rest of the Orders settings arrive with slice 3f-8. Back is Back (P20).
export function SettingsScreen() {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { config, configLoaded, deliveryCheck } = useOrders();
  const [confirm, confirmDialog] = useConfirm();
  const store = useOrdersStore();
  const { canManage } = useSession();
  const say = useStatusMessage();
  const switchTitle = useId();
  const switchSub = useId();
  const switchNote = useId();
  const handBack = useHandBack();
  const leave = useLeave(ORDERS_PATH, () => { handBack.expect(SETTINGS_OPENER); });
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLElement>(null);
  const door = useCallback((node: HTMLButtonElement | null) => { handBack.register(HISTORY_DOOR, node); }, [handBack]);

  useEffect(() => {
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once. ⚠️ NOT when Back from History
    // has just given it to the door: the hand-back runs before this effect.
    if (cameFromList(state) && !screen.current?.contains(document.activeElement)) title.current?.focus();
  }, []);

  return (
    <section ref={screen} className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.settings.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        <div className={styles.card}>
          <Button
            ref={door}
            variant="bare"
            className={styles.door}
            onPress={() => {
              handBack.expect(HISTORY_DOOR);
              void navigate(HISTORY_PATH, { state: FROM_LIST });
            }}
          >
            <span className={styles.text}>
              <span className={styles.doorTitle}>{t('ord.settings.openHistory')}</span>
              <span className={styles.sub}>{t('ord.settings.historyDaysLine', { n: config.historyDays })}</span>
            </span>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
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
      </div>
      {confirmDialog}
    </section>
  );
}
