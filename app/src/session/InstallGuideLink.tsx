import { useT } from '../i18n/useT';
import { installGuideAddress } from './installGuide';
import styles from './InstallGuideLink.module.css';

// «How to install the app» — the door to the current app's install guide (staff slice 2), on the sign-in screen and on the
// join form. ⚠️ AN <a>, NOT A BUTTON: it navigates, and the browser should treat it as such (a long press, «open in a new
// tab»). On the join form it is for the person who wants to look first: the Home offers the guide once after the join anyway
// (home/InstallHint.tsx), and reading it now costs the form being filled in.
//
// `isDisabled`: the join form turns it off while it is being sent — leaving the page then would cut the join off half-way
// (code review, 13 Nov 2026). A link cannot be disabled, so it says so (aria-disabled) and a tap does nothing.
export function InstallGuideLink({ isDisabled = false }: { isDisabled?: boolean }) {
  const { t } = useT();
  return (
    <a
      className={styles.link}
      href={installGuideAddress(window.location.href)}
      aria-disabled={isDisabled || undefined}
      onClick={event => { if (isDisabled) event.preventDefault(); }}
    >
      {t('auth.installGuide')}
    </a>
  );
}
