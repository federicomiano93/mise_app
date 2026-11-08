import { useRef } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS } from '../shell/Page';
import { LanguageScreen } from './LanguageScreen';
import { SettingsPage } from './SettingsPage';
import { HandBackContext } from './settingsHandBack';
import type { PendingDoor } from './settingsHandBack';
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
  // The door whose screen is open, for the page to give the focus back to (settingsHandBack.ts). Lives as long as Settings does.
  const pending: PendingDoor = useRef(null);

  let shown = <Navigate to={SETTINGS_PATH} replace state={KEEP_FOCUS} />;
  if (screen === 'page') shown = <SettingsPage />;
  if (canManage && screen === 'language') shown = <LanguageScreen />;
  if (canManage && screen === 'sections') shown = <StaffSectionsScreen />;
  return <HandBackContext.Provider value={pending}>{shown}</HandBackContext.Provider>;
}
