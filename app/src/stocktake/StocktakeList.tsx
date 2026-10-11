import { useEffect } from 'react';
import { isClosed } from '@mise/shared/inventory-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { STOCKTAKE_UNAVAILABLE_SCREEN } from '../shell/sections';
import { announceScreen } from '../telemetry/usage';
import { CountList } from './CountList';
import { MonthBar } from './MonthBar';
import { useStocktake } from './StocktakeContext';
import styles from './StocktakeList.module.css';

type Props = {
  month: string;
  current: string;
  openProductId: string | null;
  onMove: (month: string) => void;
  onOpenProduct: (id: string) => void;
  onCarry: () => void;
  onPurchases: () => void;
};

// The left column: the month bar, and under it the month's counting list.
//
// ⚠️ FOR AN EMPLOYEE A REFUSED MONTH IS THE ANSWER, NOT A HICCUP. The rules keep a closed month (and
// one still carrying frozen prices) from them, and «live updates interrupted» over an empty list
// would read as a broken app. So under the month bar there is one sentence instead of everything
// else; the bar stays, because its arrows are the way to a month that can be opened. Whoever runs
// the place sees the list from the phone's own copy, and the notice (StoreMessages).
//
// Nothing that is money is drawn here for anybody: the money parts come later, behind `canManage`.
export function StocktakeList({ month, current, openProductId, onMove, onOpenProduct, onCarry, onPurchases }: Props) {
  const { t } = useT();
  const { canManage } = useSession();
  const snapshot = useStocktake();
  const named = snapshot.monthId === month && snapshot.month !== null;
  const refused = named && snapshot.monthFailed && !canManage;

  useEffect(() => {
    // Announced when it arises: the shell names the screen by its address, and the address does not
    // change when a month turns out to be one the rules refuse.
    if (refused) announceScreen(STOCKTAKE_UNAVAILABLE_SCREEN);
  }, [refused]);

  return (
    <div className={styles.column}>
      <MonthBar
        month={month}
        current={current}
        closed={named ? isClosed(snapshot.month) : null}
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
          onCarry={canManage ? onCarry : undefined}
          onPurchases={onPurchases}
        />
      )}
    </div>
  );
}
