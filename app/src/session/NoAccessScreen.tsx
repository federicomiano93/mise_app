import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { AccountLine } from './AccountLine';
import { GateScreen } from './GateScreen';
import { SignOutButton } from './SignOutButton';

// The account exists and belongs to no venue: somebody whose access was removed, or somebody an
// owner has not added yet. A port of noAccessScreen in js/auth-gate.js.
//
// «Try again» is there because the usual way out of this screen is a message to the owner, who
// then adds the account — and the person should not have to sign out and in to find that out.
// The join-code entrance that goes with this screen in the current app comes in step 3g.
export function NoAccessScreen() {
  const { t } = useT();
  return (
    <GateScreen title={t('noAccess.title')} subtitle={t('noAccess.body')}>
      <AccountLine />
      <Button variant="primary" block onPress={() => { window.location.reload(); }}>
        {t('auth.tryAgain')}
      </Button>
      <SignOutButton variant="quiet" />
    </GateScreen>
  );
}
