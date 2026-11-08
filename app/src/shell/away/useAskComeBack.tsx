import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../i18n/useT';
import { useConfirm } from '../../ui/useConfirm';
import { useAway, useAwayStore } from './AwayContext';
import { awayDayLabel } from './awayWords';

// «Back already?» — ending a holiday early, asked once, from the Home's band and from Settings' row.
//
//   const [askComeBack, dialog] = useAskComeBack(armFocus);
//
// ⚠️ COMING BACK IS ONE TAP AND IS NOT A DESTRUCTIVE ACT: no danger red, no warning (the current app's askComeBack). The whole point is
// that it ends easily and by itself. `onBack` is called as the person answers «I am back», just before the holiday ends (useFocusOnBack's
// arm). A refusal is said by the shell (AwayRefusalAlert), not here.
export function useAskComeBack(onBack: () => void = () => undefined): readonly [() => Promise<void>, ReactNode] {
  const { t, locale } = useT();
  const store = useAwayStore();
  const away = useAway();
  const [confirm, dialog, dismiss] = useConfirm();
  // ⚠️ A QUESTION THAT HAS LOST ITS POINT CLOSES: the holiday ended while «Back already?» was open (midnight, another phone, a refused
  // holiday put back). Left open it would still say «on holiday until…», and «I am back» would write over a state that is not away.
  useEffect(() => { if (!away.away) dismiss(); }, [away.away, dismiss]);

  async function ask(): Promise<void> {
    if (!away.away) return;
    const back = await confirm({
      title: t('away.backTitle'),
      message: t('away.backMessage', { day: awayDayLabel(away.until, locale) }),
      okLabel: t('away.back'),
      cancelLabel: t('common.cancel'),
    });
    if (!back) return;
    onBack();
    store.comeBack();
  }

  return [ask, dialog];
}
