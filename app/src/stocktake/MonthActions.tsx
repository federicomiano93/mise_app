import { useCallback, useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { COST_OPENER, useHandBack } from './handBack';
import styles from './MonthActions.module.css';

type Props = {
  // Whether the month on screen is closed.
  closed: boolean;
  // The month and the ingredients have answered: closing before then would freeze an empty list.
  ready: boolean;
  onSeeCost: () => void;
  // Resolve true when the month went ahead and closed (or reopened).
  onClose: () => Promise<boolean>;
  onReopen: () => Promise<boolean>;
};

type Swap = 'to-reopen' | 'to-close';

// The month's bottom bar, for whoever runs the place: «What it cost», and the month's own button —
// «Close the month» (the primary action of the screen) while it is open, «Reopen the month» (quieter)
// once it is closed.
//
// ⚠️ ON THE SPLIT IT STICKS TO THE BOTTOM OF THE SCREEN: a long list must never push the month's
// buttons off a tablet that stands on a bench. On a phone it is the list's last block instead, so the
// rows have the screen (MonthActions.module.css says why; stocktakeCss.spec.ts pins both).
//
// ⚠️ BOTH MONTH BUTTONS ARE ALWAYS BUILT and one is hidden, never one built only when the month is in
// that state: the month changes live (another phone closes it), and a control built conditionally
// would appear and vanish at random.
export function MonthActions({ closed, ready, onSeeCost, onClose, onReopen }: Props) {
  const { t } = useT();
  const handBack = useHandBack();
  const closeButton = useRef<HTMLButtonElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  // A swap of the two month buttons this phone asked for and is waiting to see.
  const swapFocus = useRef<Swap | null>(null);

  const costButton = useCallback((node: HTMLButtonElement | null) => {
    handBack.register(COST_OPENER, node);
  }, [handBack]);

  // ⚠️ THE BUTTON THAT WAS PRESSED HIDES ITSELF, with the focus on it: Close when the month has
  // closed (Reopen takes its place), Reopen when it has opened again. A hidden element cannot keep
  // the focus, so it would fall to <body> — a keyboard user is lost and a screen reader says nothing.
  // The focus goes to the control that takes the button's place.
  //
  // Asked for by the press that causes the swap, done when the swap is on the page: another phone
  // closing the month sets nothing, so it never moves anybody's focus. And only when the focus is
  // still on the button that goes, or nowhere (while a question closes, the focus is on <body> until
  // the dialog's own restore runs a frame later): somebody who has moved on keeps the focus where
  // they put it.
  useLayoutEffect(() => {
    const want = swapFocus.current;
    if (!want) return;
    if (want === 'to-reopen' ? !closed : closed) return;
    swapFocus.current = null;
    const arriving = want === 'to-reopen' ? reopenButton.current : closeButton.current;
    const leaving = want === 'to-reopen' ? closeButton.current : reopenButton.current;
    const active = document.activeElement;
    if (active === null || active === document.body || active === leaving) arriving?.focus();
  });

  const press = async (want: Swap, action: () => Promise<boolean>) => {
    swapFocus.current = want;
    if (!(await action())) swapFocus.current = null;
  };

  return (
    <div className={styles.bar}>
      <Button ref={costButton} className={styles.action} onPress={onSeeCost}>{t('stock.seeCost')}</Button>
      <Button
        ref={closeButton}
        variant="primary"
        className={styles.action}
        hidden={closed}
        isDisabled={!ready}
        onPress={() => { void press('to-reopen', onClose); }}
      >
        {t('stock.closeMonth')}
      </Button>
      <Button
        ref={reopenButton}
        className={styles.action}
        hidden={!closed}
        isDisabled={!ready}
        onPress={() => { void press('to-close', onReopen); }}
      >
        {t('stock.reopenMonth')}
      </Button>
    </div>
  );
}
