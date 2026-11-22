import type { ReactNode } from 'react';
import { Power, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { useT } from '../i18n/useT';
import { useKioskExit } from '../kiosk/useKioskExit';
import { useSession } from '../session/SessionContext';
import { sectionById } from './sections';
import styles from './AccountMenu.module.css';

// Who is signed in, as the first letter of their email, at the right end of the top bar (22 Nov 2026; it was a circle under Settings in the rail).
// The circle is a 40px disc inside a 48px touch target, named «Account», not the letter (which is decoration).
//   - Normally it is a LINK to the Account card in Settings, as the avatar always was.
//   - On a kiosk device's Home (`kiosk`) it opens a small menu instead: «Account» (the same place) and «Exit» (closes the kiosk page, or says how
//     to). Exit lives here because the bar's one white row holds nothing else for it, and on a phone it must stay reachable.
export function AccountMenu({ kiosk }: { kiosk: boolean }) {
  const { t } = useT();
  const { user } = useSession();
  // By code point: an email that starts with an emoji must not be cut in half.
  const letter = Array.from(user?.email || user?.uid || '?')[0]?.toUpperCase();
  const circle = <span className={styles.circle} aria-hidden="true">{letter}</span>;

  if (!kiosk) {
    return (
      <Link to={sectionById('settings').path} className={styles.target} aria-label={t('account.title')}>
        {circle}
      </Link>
    );
  }
  return <KioskAccountMenu circle={circle} />;
}

function KioskAccountMenu({ circle }: { circle: ReactNode }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [exit, exitDialog] = useKioskExit();

  return (
    <>
      <MenuTrigger>
        <Button className={styles.target} aria-label={t('account.title')}>{circle}</Button>
        <Popover className={styles.popover} placement="bottom end" offset={4}>
          <Menu
            className={styles.menu}
            aria-label={t('account.title')}
            onAction={key => {
              if (key === 'account') navigate(sectionById('settings').path);
              else if (key === 'exit') exit();
            }}
          >
            <MenuItem id="account" textValue={t('account.title')} className={styles.item}>
              <User className={styles.itemIcon} aria-hidden="true" />
              <span>{t('account.title')}</span>
            </MenuItem>
            <MenuItem id="exit" textValue={t('kiosk.home.exit')} className={`${styles.item} ${styles.danger}`}>
              <Power className={styles.itemIcon} aria-hidden="true" />
              <span>{t('kiosk.home.exit')}</span>
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      {exitDialog}
    </>
  );
}
