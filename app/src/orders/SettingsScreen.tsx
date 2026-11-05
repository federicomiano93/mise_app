import { useCallback, useEffect, useId, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useOrders } from './OrdersContext';
import { HISTORY_DOOR, SETTINGS_OPENER, useHandBack } from './handBack';
import { FROM_LIST, cameFromList, useLeave } from './ordersNav';
import { HISTORY_PATH, ORDERS_PATH } from './ordersPath';
import styles from './SettingsScreen.module.css';

// «Settings» of Orders, at /orders/settings (step 3f-4), one level below the list. For now it holds ONE door, «Past orders»
// (History); the rest of the Orders settings arrive with slice 3f-8. Back is Back (P20).
export function SettingsScreen() {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { config } = useOrders();
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
      </div>
    </section>
  );
}
