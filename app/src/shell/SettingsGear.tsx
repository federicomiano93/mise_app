import type { Ref } from 'react';
import { Settings } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import iconStyles from './BandIcon.module.css';

type Props = {
  onPress: () => void;
  // The name for assistive technology; «Settings» unless the section says whose (Orders: «Orders settings»).
  label?: string;
  // The hand-back: Back from the settings gives the focus to this button (a section registers it under its opener name).
  ref?: Ref<HTMLButtonElement>;
  // The settings are open beside the list (the split's right pane): the gear says it is the current one.
  'aria-current'?: 'true';
};

// The one settings door of a section: a 48px square with the gear alone, right after the title on the title's own line (the Orders
// band, 21 Nov 2026, for every section that has settings). Passed to `Page` as its `gear` (from 700px it sits in the top bar beside the title), and drawn only for who sees the settings.
export function SettingsGear({ onPress, label, ref, 'aria-current': current }: Props) {
  const { t } = useT();
  return (
    <Button ref={ref} variant="bare" className={iconStyles.icon} aria-label={label ?? t('ui.settings')} aria-current={current} onPress={onPress}>
      <Settings aria-hidden="true" />
    </Button>
  );
}
