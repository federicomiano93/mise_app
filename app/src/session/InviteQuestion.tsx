import { useEffect } from 'react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { isBusy } from './busy';
import { focusMainSoon } from './focusMain';
import { useJoinFlow, useJoinFlowStore } from './JoinFlowContext';
import { LeaveDialog } from './LeaveDialog';
import { useSession } from './SessionContext';
import { useLeaveFlow } from './useLeaveFlow';

// How often a question waiting for somebody to finish typing looks again (session.ts BUSY_RETRY_MS is the same pause).
export const ASK_RETRY_MS = 5_000;

// ⚠️ AN INVITATION OPENED BY SOMEBODY WHO IS ALREADY IN (staff slice 1; js/auth-gate.js offerInvite). The person this is for
// is an owner adding a second business to the account they already use. But the same link tapped on a kitchen tablet must
// not throw a working session off its screen, so it is a QUESTION, never a redirect, and it NAMES THE ACCOUNT: on a shared
// phone the person tapping is not always the person signed in, and a business added to the wrong account can only be undone
// from the Firebase console.
//
// ⚠️ «ADD IT» LEADS TO THE JOIN FORM, AND THE JOIN ENDS IN A SWITCH OF VENUE (session.ts openJoinedVenue), which clears this
// phone's copy of the data. So «Add it» goes through the same two checks as switching venue (useLeaveFlow): «Not sent yet»
// when something typed here has not reached the server, and the lab production in progress. Every way of saying no — «Not
// now», Escape, «Stay» — forgets the invitation (docs/parity/staff-plan.md, «Security»: forgotten after Cancel).
//
// ⚠️ IT WAITS WHILE SOMEBODY IS TYPING (markBusy): the form replaces the app, and an editor's unsaved typing would go with it.
// The question comes the moment nobody is.
export function InviteQuestion() {
  const { t } = useT();
  const session = useSession();
  const flowStore = useJoinFlowStore();
  const { invited, open } = useJoinFlow();
  const flow = useLeaveFlow(() => { flowStore.openForm(); });
  const asking = flow.step !== 'closed';
  const { open: ask } = flow;

  useEffect(() => {
    if (!invited || open || asking) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryAsk = () => {
      if (isBusy()) { timer = setTimeout(tryAsk, ASK_RETRY_MS); return; }
      ask();
    };
    tryAsk();
    return () => { clearTimeout(timer); };
    // `ask` is a new function every render; the question depends only on these.
  }, [invited, open, asking]);

  function notNow() {
    flowStore.forget();
    flow.close();
    // The question opened by itself, on no button: the focus goes to the screen, not to the page.
    focusMainSoon();
  }

  if (!invited && !asking) return null;
  const who = session.user?.email || t('invite.thisAccount');
  return (
    <LeaveDialog
      flow={{ ...flow, close: notNow }}
      role="alertdialog"
      title={t('invite.title')}
      message={t('invite.message', { who })}
      actions={
        <>
          <Button key="cancel" autoFocus onPress={notNow}>{t('invite.cancel')}</Button>
          <Button key="ok" variant="primary" isPending={flow.checking} onPress={() => { void flow.proceed(); }}>
            {t('invite.ok')}
          </Button>
        </>
      }
    />
  );
}
