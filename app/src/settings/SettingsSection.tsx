import { Navigate, useLocation } from 'react-router';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS } from '../shell/Page';
import { LanguageScreen } from './LanguageScreen';
import { SettingsPage } from './SettingsPage';
import { SETTINGS_PATH, settingsScreenOf } from './settingsPath';
import { StaffSectionsScreen } from './StaffSectionsScreen';

// Settings and the screens one level below it (`/settings/language`, `/settings/sections`). It has no gate for the page itself: every
// signed-in person has Settings (their account, the way out, their holiday).
//
// ⚠️ THE TWO SCREENS BELOW ARE FOR AN OWNER OR A MANAGER (`canManage`; a head chef is a manager). Anybody else who reaches one — a typed
// address, an old history entry — is REPLACED by the page, as is any other address under /settings. UX only (P2): the Cloud Functions
// behind the screens refuse a non-manager as well.
export function SettingsSection() {
  const { pathname } = useLocation();
  const { canManage } = useSession();
  const screen = settingsScreenOf(pathname);

  if (screen === 'page') return <SettingsPage />;
  if (canManage && screen === 'language') return <LanguageScreen />;
  if (canManage && screen === 'sections') return <StaffSectionsScreen />;
  return <Navigate to={SETTINGS_PATH} replace state={KEEP_FOCUS} />;
}
