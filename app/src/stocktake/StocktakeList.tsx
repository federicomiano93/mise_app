import { useEffect } from 'react';
import { isClosed } from '@mise/shared/inventory-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { STOCKTAKE_UNAVAILABLE_SCREEN } from '../shell/sections';
import { announceScreen } from '../telemetry/usage';
import { CountList } from './CountList';
import { MonthActions } from './MonthActions';
import { MonthBar } from './MonthBar';
import { useStocktake } from './StocktakeContext';
import { useMonthActions } from './useMonthActions';
import styles from './StocktakeList.module.css';

type Props = {
  month: string;
  current: string;
  openProductId: string | null;
  onMove: (month: string) => void;
  onOpenProduct: (id: string) => void;
  onOpenCost: () => void;
};

// The left column: the month bar, under it the month's counting list and, for whoever runs the
// place, the month's bottom bar.
//
// ⚠️ FOR AN EMPLOYEE A REFUSED MONTH IS THE ANSWER, NOT A HICCUP. The rules keep a closed month (and
// one still carrying frozen prices) from them, and «live updates interrupted» over an empty list
// would read as a broken app. So under the month bar there is one sentence instead of everything
// else; the bar stays, because its arrows are the way to a month that can be opened. Whoever runs
// the place sees the list from the phone's own copy, and the notice (StoreMessages).
//
// ⚠️ THE MONEY AND THE END OF A MONTH ARE THE MANAGER'S: «What it cost», «Close the month» and
// «Carry forward» are drawn only behind `canManage`. A month is refused to an employee only, so the
// bottom bar is never on the refused-month sentence either.
export function StocktakeList({ month, current, openProductId, onMove, onOpenProduct, onOpenCost }: Props) {
  const { t } = useT();
  const { canManage } = useSession();
  const snapshot = useStocktake();
  const actions = useMonthActions(month);
  const named = snapshot.monthId === month && snapshot.month !== null;
  const refused = named && snapshot.monthFailed && !canManage;

  useEffect(() => {
    // Announced when it arises: the shell names the screen by its address, and the address does not
    // change when a month turns out to be one the rules refuse.
    if (refused) announceScreen(STOCKTAKE_UNAVAILABLE_SCREEN);
  }, [refused]);

  const closed = named ? isClosed(snapshot.month) : false;

  return (
    <div className={styles.column}>
      {/* A refused month was never read: whether it is open or closed is not known here, and an
          «Open» badge over the sentence that says it may be closed would contradict it. */}
      <MonthBar
        month={month}
        current={current}
        closed={named && !refused ? closed : null}
        onMove={onMove}
      />
      {refused ? (
        <p className={styles.unavailable}>{t('stock.staffMonthUnavailable')}</p>
      ) : (
        // Keyed by the month: another month is a new list, with a new search and new boxes.
        <CountList
          key={month}
          monthId={month}
          openProductId={openProductId}
          onOpenProduct={onOpenProduct}
          onCarry={canManage ? actions.carry : undefined}
          onPurchases={actions.purchases}
        />
      )}
      {canManage ? (
        <MonthActions
          closed={closed}
          ready={named && snapshot.monthLoaded && snapshot.ingredientsLoaded}
          onSeeCost={onOpenCost}
          onClose={actions.close}
          onReopen={actions.reopen}
        />
      ) : null}
      {actions.dialogs}
    </div>
  );
}
