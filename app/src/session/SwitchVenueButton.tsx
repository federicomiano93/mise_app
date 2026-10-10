import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useSession, useSessionStore } from './SessionContext';
import { LeaveDialog } from './LeaveDialog';
import { useLeaveFlow } from './useLeaveFlow';
import styles from './SwitchVenueButton.module.css';

type Props = {
  // How the button looks. The top bar's venue chip is `bare` with its own className.
  variant?: 'secondary' | 'bare';
  className?: string;
  children: ReactNode;
};

// A button that opens the list of the account's OTHER venues, and moves to the one picked.
//
// ⚠️ MOVING IS A RELOAD (session.ts switchLocation): the screens of the old venue must not
// survive the switch, and this phone's copy of its data is cleared on the way — so, as for
// signing out, the database is asked first whether something typed here is still waiting to
// reach the server.
export function SwitchVenueButton({ variant = 'secondary', className, children }: Props) {
  const { t } = useT();
  const store = useSessionStore();
  const session = useSession();
  const flow = useLeaveFlow((locationId: string) => store.switchLocation(locationId));
  const others = session.options.filter(id => id !== session.locationId);

  return (
    <>
      <Button variant={variant} className={className} aria-haspopup="dialog" onPress={flow.open}>
        {children}
      </Button>
      <LeaveDialog
        flow={flow}
        role="dialog"
        title={t('account.switchVenue')}
        actions={<Button key="cancel" onPress={flow.close}>{t('common.cancel')}</Button>}
      >
        <ul className={styles.list}>
          {others.map(id => (
            <li key={id}>
              <Button
                variant="bare"
                className={styles.row}
                isPending={flow.checking}
                onPress={() => { void flow.proceed(id); }}
              >
                {/* The name, never the database id; the id is only the fallback when a name could
                    not be read. */}
                <span className={styles.name}>{session.optionNames[id] ?? id}</span>
                <ChevronRight className={styles.chevron} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </LeaveDialog>
    </>
  );
}
