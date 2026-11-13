import { LogOut } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useOptionalJoinFlowStore } from './JoinFlowContext';
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
//
// `label` replaces «Log out» on the button only (the join form's «Sign in with a different account», current-app fix
// 1a3567b9): the question it asks is the same, because what it does is the same.
// `isDisabled`: the join form switches it off while its code is being checked.
// `keepInvitation`: the invitation link this window holds goes through THIS sign-out (the join form's «Sign in with a different
// account» only, never «Log out»), so the person lands on the new-account form with the code still filled in.
export function SignOutButton({ variant = 'secondary', label, isDisabled = false, keepInvitation = false }: {
  variant?: 'secondary' | 'quiet' | 'small'; label?: string; isDisabled?: boolean; keepInvitation?: boolean;
}) {
  const { t } = useT();
  const store = useSessionStore();
  const invitation = useOptionalJoinFlowStore();
  const flow = useLeaveFlow(async () => {
    if (!keepInvitation) { await store.signOut(); return; }
    invitation?.holdThroughSignOut();
    try {
      await store.signOut({ keepInvitation: true });
    } catch (err) {
      invitation?.holdThroughSignOut(false);
      throw err;
    }
  });

  return (
    <>
      {variant === 'small' ? (
        <Button variant="bare" className={styles.small} onPress={flow.open}>
          <LogOut size={16} aria-hidden="true" />
          {t('auth.logOut')}
        </Button>
      ) : (
        <Button variant={variant} isDisabled={isDisabled} onPress={flow.open}>{label ?? t('auth.logOut')}</Button>
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
