import { LogOut } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useSessionStore } from './SessionContext';
import { LeaveDialog } from './LeaveDialog';
import { LeaveFailed } from './LeaveFailed';
import { useLeaveFlow } from './useLeaveFlow';
import styles from './SignOutButton.module.css';

// «Log out», with the two questions that come before it: «Log out?» (signing out clears this
// phone's copy of the data and needs the email and password to get back in), and — only when
// something typed on this phone has not reached the server — «Not sent yet».
//
// The dialog is drawn here, beside the button, so cancelling it gives the focus back to this
// button.
//
// `small` is the look for a title line (Settings): an icon and a word, muted, no box.
export function SignOutButton({ variant = 'secondary' }: { variant?: 'secondary' | 'quiet' | 'small' }) {
  const { t } = useT();
  const store = useSessionStore();
  const flow = useLeaveFlow(() => store.signOut());

  return (
    <>
      {variant === 'small' ? (
        <Button variant="bare" className={styles.small} onPress={flow.open}>
          <LogOut size={16} aria-hidden="true" />
          {t('auth.logOut')}
        </Button>
      ) : (
        <Button variant={variant} onPress={flow.open}>{t('auth.logOut')}</Button>
      )}
      <LeaveFailed failed={flow.failed} />
      <LeaveDialog
        flow={flow}
        role="alertdialog"
        title={t('auth.logOut.title')}
        message={t('auth.logOut.message')}
        actions={
          <>
            <Button key="cancel" autoFocus onPress={flow.close}>{t('common.cancel')}</Button>
            <Button key="confirm" variant="primary" isPending={flow.checking} onPress={() => { void flow.proceed(); }}>
              {t('auth.logOut')}
            </Button>
          </>
        }
      />
    </>
  );
}
