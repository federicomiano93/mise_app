import { useEffect, useId, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { groupHistoryByDay } from '@mise/shared/archive';
import { daySpoken } from '@mise/shared/day';
import { mergeHistory } from '@mise/shared/history-window';
import { outputLanguage } from '@mise/shared/market';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { FormBar } from '../ui/FormBar';
import { useOrders } from './OrdersContext';
import { SendPicker } from './SendPicker';
import { dayTranslate } from './dayWords';
import { sendDayOpener, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { HISTORY_PATH } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import { recordSendRows } from './sendFlow';
import styles from './SendScreen.module.css';

// «Send <day>» (parity H10), at /orders/history/day/<date>, one level below History: the recorded orders of one day, each a tick,
// over the same choice of how the message is written and the same «Send» button as the draft's send screen (SendPicker).
//
// The orders are already recorded, so a send here records nothing and the same-day unit check is skipped; a send that reached a
// supplier steps back to History (P20), one that reached nobody leaves the screen as it is.
export function DaySendScreen({ date, lens }: { date: string; lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const session = useSession();
  const { history, olderHistory, ingredients } = useOrders();
  const handBack = useHandBack();
  const leave = useLeave(HISTORY_PATH, () => { handBack.expect(sendDayOpener(date)); });
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const language = outputLanguage(session.location);

  // Live: another phone's correction or deletion shows here, and a record with nothing left in it drops out.
  const rows = useMemo(() => {
    const ofDay = groupHistoryByDay(mergeHistory(history, olderHistory)).find(day => day.date === date)?.records ?? [];
    return recordSendRows(ofDay, ingredients, language);
  }, [history, olderHistory, ingredients, date, language]);

  useEffect(() => {
    // Opened from History the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('ord.history.sendDay', { day: daySpoken(date, new Date(), dayTranslate(t)) })}
        titleId={titleId}
        titleRef={title}
      />
      <SendPicker
        lens={lens}
        rows={rows}
        titleId={titleId}
        emptyText={t('ord.history.sendDayEmpty')}
        resend
        onReached={leave}
      />
    </section>
  );
}
