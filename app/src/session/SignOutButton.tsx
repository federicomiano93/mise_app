import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useSessionStore } from './SessionContext';
import { LeaveDialog } from './LeaveDialog';
import { useLeaveFlow } from './useLeaveFlow';

// «Log out», with the two questions that come before it: «Log out?» (signing out clears this
// phone's copy of the data and needs the email and password to get back in), and — only when
// something typed on this phone has not reached the server — «Not sent yet».
//
// The dialog is drawn here, beside the button, so cancelling it gives the focus back to this
// button.
export function SignOutButton({ variant = 'secondary' }: { variant?: 'secondary' | 'quiet' }) {
  const { t } = useT();
  const store = useSessionStore();
  const flow = useLeaveFlow(() => store.signOut());

  return (
    <>
      <Button variant={variant} onPress={flow.open}>{t('auth.logOut')}</Button>
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
