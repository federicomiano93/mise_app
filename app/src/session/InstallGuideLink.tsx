import { useT } from '../i18n/useT';
import { installGuideAddress } from './installGuide';
import styles from './InstallGuideLink.module.css';

// «How to install the app» — the door to the current app's install guide (staff slice 2), on the sign-in screen and on the
// join form. ⚠️ AN <a>, NOT A BUTTON: it navigates, and the browser should treat it as such (a long press, «open in a new
// tab»). On the join form it is for the person who wants to look first: the Home offers the guide once after the join anyway
// (home/InstallHint.tsx), and reading it now costs the form being filled in.
export function InstallGuideLink() {
  const { t } = useT();
  return <a className={styles.link} href={installGuideAddress(window.location.href)}>{t('auth.installGuide')}</a>;
}
