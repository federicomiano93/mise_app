import { useSession } from './SessionContext';
import styles from './AccountLine.module.css';

// WHICH account the screen is talking about. A message screen that says "ask the owner to add
// it" is a request somebody can only act on if it names the account — on a shared kitchen
// phone the person looking is not always the person signed in.
export function AccountLine() {
  const { user } = useSession();
  const account = user?.email || user?.uid || '';
  if (!account) return null;
  return <p className={styles.account}>{account}</p>;
}
