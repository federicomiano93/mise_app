import { Check } from 'lucide-react';
import { ROLE_CHOICES } from '@mise/shared/membership';
import type { RoleChoice, RoleChoiceKey } from '@mise/shared/membership';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ROLE_LABEL, ROLE_MEANS } from './roleWords';
import styles from './RolePicker.module.css';

// «Change role» of one row of the people list (staff slice 4): the six choices as a list, as on the invite card, each with the
// sentence of what it can do, and the one the person holds now marked. A tap on a choice CHANGES NOTHING: the list closes and the
// question «Make Anna the head chef?» asks first (PeopleList.tsx).
//
// ⚠️ BUTTONS, NOT RADIOS OR A DROP-DOWN (decision D2 of docs/parity/staff-plan.md, fix ff7046a8): an arrow key on a radio, or on a closed
// drop-down in Chrome on Windows, CHOOSES — the current app's roster opened the question at the first keystroke (WCAG 3.2.2). Here
// the keys only move between the choices; a choice is made by a press, and even then only asked about.
export function RolePicker({ name, current, onPick, onClose }: {
  // The person's name as the buttons name them.
  name: string;
  // The choice the person holds now; null when the roster holds no role this app knows (no choice is marked, every one can be made).
  current: RoleChoiceKey | null;
  onPick: (choice: RoleChoice) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      isOpen
      dismissable
      onClose={onClose}
      title={t('people.roleOf', { name })}
      actions={<Button onPress={onClose}>{t('common.cancel')}</Button>}
    >
      <ul className={styles.list}>
        {ROLE_CHOICES.map(choice => {
          const isCurrent = choice.key === current;
          return (
            <li key={choice.key}>
              <Button
                variant="bare"
                className={styles.choice}
                data-current={isCurrent || undefined}
                aria-current={isCurrent || undefined}
                // The keyboard starts on the role held now, so Enter out of habit asks about nothing new.
                autoFocus={isCurrent || (current === null && choice.key === 'staff')}
                onPress={() => { onPick(choice); }}
              >
                <span className={styles.text}>
                  <span className={styles.name}>
                    {t(ROLE_LABEL[choice.key])}
                    {isCurrent ? (
                      <span className={styles.current}>
                        <Check aria-hidden="true" className={styles.icon} />
                        {t('people.role.current')}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.means}>{t(ROLE_MEANS[choice.key])}</span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
