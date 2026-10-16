import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { AccountLine } from './AccountLine';
import { GateScreen } from './GateScreen';
import { useSession, useSessionStore } from './SessionContext';
import { SignOutButton } from './SignOutButton';
import styles from './ChooseVenueScreen.module.css';

// «Which venue am I working on?», for an account that belongs to more than one and has not
// picked yet (or whose remembered venue is gone). A port of chooseScreen in js/auth-gate.js.
export function ChooseVenueScreen() {
  const { t } = useT();
  const session = useSession();
  const store = useSessionStore();
  const [choosing, setChoosing] = useState(false);

  async function choose(locationId: string) {
    setChoosing(true);
    try {
      await store.chooseLocation(locationId);
      // The session takes it from here: this screen is replaced.
    } catch (error) {
      console.error('Could not open that location:', error);
      setChoosing(false);
    }
  }

  return (
    <GateScreen title={t('picker.title')} subtitle={t('picker.sub')}>
      <ul className={styles.list}>
        {session.options.map(id => (
          <li key={id}>
            {/* The name, never the database id: nobody should have to pick between «main» and
                «trattoria-rosa». The id is only the fallback when a name could not be read. */}
            <Button
              variant="bare"
              className={styles.row}
              isDisabled={choosing}
              onPress={() => { void choose(id); }}
            >
              <span className={styles.name}>{session.optionNames[id] ?? id}</span>
              <ChevronRight className={styles.chevron} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <AccountLine />
      <SignOutButton variant="quiet" />
    </GateScreen>
  );
}
