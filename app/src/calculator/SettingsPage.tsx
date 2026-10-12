import { useEffect, useId, useLayoutEffect, useRef } from 'react';
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
  children: ReactNode;
};

// A screen of Settings with nothing to save: the hub and the list of recipes the Divisor is picked from. The bar
// has Back and the title; Back steps up one level.
//
// When it appears it takes the focus onto its title if it was opened from the level above, and hands the focus
// to the button that opened the screen the person has just come back from (handBack.ts).
export function SettingsPage({ title, fallback, children }: Props) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const leave = useLeave(fallback);
  const titleId = `${useId()}-title`;
  const heading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => { handBack.deliver(); }, [handBack]);
  useEffect(() => {
    // Not on a POP: that is Back arriving at an entry that remembers how it was opened, and the focus then goes
    // to the button that opened the screen the person has just left (handBack.ts).
    if (navigationType !== 'POP' && cameFromParent(state)) heading.current?.focus();
  }, []);

  return (
    <SettingsScreen
      labelledBy={titleId}
      bar={<FormBar backLabel={t('ui.back')} onBack={leave} title={title} titleId={titleId} titleRef={heading} />}
    >
      {children}
    </SettingsScreen>
  );
}
