import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { AccountLine } from './AccountLine';
import { GateScreen } from './GateScreen';
import { SignOutButton } from './SignOutButton';

// «Could not check your access»: the session could not read who this account belongs to,
// usually because there is no connection. Trying again is a reload, which starts the session
// from scratch.
export function SessionErrorScreen() {
  const { t } = useT();
  return (
    <GateScreen title={t('help.couldNotCheckYour')} subtitle={t('help.thisUsuallyMeansNo')}>
      <AccountLine />
      <Button variant="primary" block onPress={() => { window.location.reload(); }}>
        {t('auth.tryAgain')}
      </Button>
      <SignOutButton variant="quiet" />
    </GateScreen>
  );
}
