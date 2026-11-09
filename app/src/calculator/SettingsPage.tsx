import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { cameFromParent, useLeave } from './calculatorNav';
import { useHandBack } from './handBack';
import { SettingsScreen } from './SettingsScreen';

type Props = {
  title: string;
  // Where Back goes when nothing is behind this screen (it was opened by its address).
  fallback: string;
  // What Back does when it is not simply a step up (the Clients editor asks about unsaved edits first).
  onBack?: () => void;
  // The one primary action of the bar, when the screen is a form.
  action?: ReactNode;
  // Under the title (the Dough history's day badge).
  sub?: ReactNode;
  // The name the title registers under with the hand-back: a screen left by a move of its own (a log deleted, a
  // version restored) hands the focus to the title of the screen it lands on.
  titleOpener?: string;
  children: ReactNode;
};

// A screen of Settings with nothing to save: the hub and the list of recipes the Divisor is picked from. The bar
// has Back and the title; Back steps up one level.
//
// When it appears it takes the focus onto its title if it was opened from the level above, and hands the focus
// to the button that opened the screen the person has just come back from (handBack.ts).
export function SettingsPage({ title, fallback, onBack, action, sub, titleOpener, children }: Props) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const leave = useLeave(fallback);
  const titleId = `${useId()}-title`;
  const heading = useRef<HTMLHeadingElement | null>(null);
  const titleRef = useCallback((node: HTMLHeadingElement | null) => {
    heading.current = node;
    if (titleOpener !== undefined) handBack.register(titleOpener, node);
  }, [handBack, titleOpener]);

  useLayoutEffect(() => { handBack.deliver(); }, [handBack]);
  useEffect(() => {
    // Not on a POP: that is Back arriving at an entry that remembers how it was opened, and the focus then goes
    // to the button that opened the screen the person has just left (handBack.ts).
    if (navigationType !== 'POP' && cameFromParent(state)) heading.current?.focus();
  }, []);

  return (
    <SettingsScreen
      labelledBy={titleId}
      bar={(
        <FormBar
          backLabel={t('ui.back')}
          onBack={onBack ?? leave}
          title={title}
          titleId={titleId}
          titleRef={titleRef}
          sub={sub}
          action={action}
        />
      )}
    >
      {children}
    </SettingsScreen>
  );
}
