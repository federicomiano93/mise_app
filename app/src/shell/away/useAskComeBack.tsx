import type { ReactNode } from 'react';
import { useT } from '../../i18n/useT';
import { useConfirm } from '../../ui/useConfirm';
import { useAway, useAwayStore } from './AwayContext';
import { awayDayLabel } from './awayWords';

// «Back already?» — ending a holiday early, asked once, from the Home's band and from Settings' row.
//
//   const [askComeBack, dialog] = useAskComeBack(() => say(t('away.saveFailed')));
//
// ⚠️ COMING BACK IS ONE TAP AND IS NOT A DESTRUCTIVE ACT: no danger red, no warning (the current app's askComeBack). The whole point is
// that it ends easily and by itself. `onFailed` is called when the server refused the write (the state is already put back).
export function useAskComeBack(onFailed: () => void): readonly [() => Promise<void>, ReactNode] {
  const { t, locale } = useT();
  const store = useAwayStore();
  const away = useAway();
  const [confirm, dialog] = useConfirm();

  async function ask(): Promise<void> {
    if (!away.away) return;
    const back = await confirm({
      title: t('away.backTitle'),
      message: t('away.backMessage', { day: awayDayLabel(away.until, locale) }),
      okLabel: t('away.back'),
      cancelLabel: t('common.cancel'),
    });
    if (!back) return;
    const change = store.comeBack();
    if (change.accepted) void change.saved.then(saved => { if (!saved) onFailed(); });
  }

  return [ask, dialog];
}
