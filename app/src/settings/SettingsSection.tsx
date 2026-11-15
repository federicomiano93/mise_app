import { useRef } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS } from '../shell/Page';
import { LanguageScreen } from './LanguageScreen';
import { PeopleScreen } from './PeopleScreen';
import { SettingsPage } from './SettingsPage';
import { HandBackContext } from './settingsHandBack';
import type { PendingDoor } from './settingsHandBack';
import { SETTINGS_PATH, settingsScreenOf } from './settingsPath';
import { StaffSectionsScreen } from './StaffSectionsScreen';

// Settings and the screens one level below it (`/settings/language`, `/settings/sections`, `/settings/people`). It has no gate for the
// page itself: every signed-in person has Settings (their account, the way out, their holiday).
//
// ⚠️ THE TWO SCREENS BELOW ARE FOR AN OWNER OR A MANAGER (`canManageVenue`; a head chef is a manager, a partial owner is not). Anybody else who reaches one — a typed
// address, an old history entry — is REPLACED by the page, as is any other address under /settings. UX only (P2): the Cloud Functions
// behind the screens refuse a non-manager as well.
//
// ⚠️ «WHO CAN GET IN» IS FOR THE FULL OWNER ONLY (`isOwner`: the value exactly 'owner'; decisions D1 and D3 of
// docs/parity/staff-plan.md). Not a manager, not a head chef, and not a sales or kitchen owner: a partial owner who could hire could
// make a second account of their own the full owner. The same replacement by the page, and the same server refusal behind it.
export function SettingsSection() {
  const { pathname } = useLocation();
  const { canManageVenue, isOwner } = useSession();
  const screen = settingsScreenOf(pathname);
  // The door whose screen is open, for the page to give the focus back to (settingsHandBack.ts). Lives as long as Settings does.
  const pending: PendingDoor = useRef(null);

  let shown = <Navigate to={SETTINGS_PATH} replace state={KEEP_FOCUS} />;
  if (screen === 'page') shown = <SettingsPage />;
  if (canManageVenue && screen === 'language') shown = <LanguageScreen />;
  if (canManageVenue && screen === 'sections') shown = <StaffSectionsScreen />;
  if (isOwner && screen === 'people') shown = <PeopleScreen />;
  return <HandBackContext.Provider value={pending}>{shown}</HandBackContext.Provider>;
}
