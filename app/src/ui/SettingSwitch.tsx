import { Switch } from 'react-aria-components';
import styles from './SettingSwitch.module.css';

type Props = {
  selected: boolean;
  onChange: (selected: boolean) => void;
  // The switch is named by the words drawn beside it (aria-labelledby), never by a label that differs from them.
  labelledBy: string;
  describedBy?: string;
  isDisabled?: boolean;
};

// An on/off switch (`role="switch"`, React Aria brings the keyboard and the state). The row that holds it draws
// the words and gives their ids: the whole row is 48px tall so a thumb finds it.
export function SettingSwitch({ selected, onChange, labelledBy, describedBy, isDisabled }: Props) {
  return (
    <Switch
      isSelected={selected}
      onChange={onChange}
      isDisabled={isDisabled}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={styles.switch}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </Switch>
  );
}
