import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { AccountLine } from './AccountLine';
import { GateScreen } from './GateScreen';
import { useJoinFlow, useJoinFlowStore } from './JoinFlowContext';
import { SignOutButton } from './SignOutButton';

// The account exists and belongs to no venue: somebody whose access was removed, or somebody who has an account and is
// holding a code. A port of noAccessScreen in js/auth-gate.js.
//
// ⚠️ «I HAVE A JOIN CODE» IS WHY THIS SCREEN MATTERS (staff slice 1). Creating an account and redeeming a code are two steps,
// and anything can happen between them — a dropped connection, a mistyped code, a phone that locked. Whoever gets separated
// from the first attempt arrives here, and without a way to type the code from this screen their only options are to give up
// or make a SECOND account, which cannot be joined either because the code is single use. It sits above «Try again» for that
// reason, as in the current app.
//
// «Try again» is there because the other way out of this screen is a message to the owner, who then adds the account — and
// the person should not have to sign out and in to find that out.
export function NoAccessScreen() {
  const { t } = useT();
  const flowStore = useJoinFlowStore();
  // Back from the join form lands here: the focus goes back to the button that opened it.
  const { returned } = useJoinFlow();
  return (
    <GateScreen title={t('noAccess.title')} subtitle={t('noAccess.body')}>
      <AccountLine />
      <Button variant="secondary" block autoFocus={returned} onPress={() => { flowStore.openForm(); }}>
        {t('auth.iHaveACode')}
      </Button>
      <Button variant="primary" block onPress={() => { window.location.reload(); }}>
        {t('auth.tryAgain')}
      </Button>
      <SignOutButton variant="quiet" />
    </GateScreen>
  );
}
