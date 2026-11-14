import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { InviteCard } from './InviteCard';
import { SettingsSubScreen } from './SettingsSubScreen';

// «Who can get in» (the full owner only — SettingsSection replaces it with the page for anybody else, and every Cloud Function behind it
// refuses them too). Staff slice 3 draws the invite card; the people list comes under it in slice 4, as its own part.
//
// ⚠️ BACK STAYS ON WHILE AN INVITATION IS BEING MADE. Leaving costs nothing but the code, which dies by itself in 24 hours unused, and
// a cold function can keep the phone waiting a minute (settingsSource.ts FUNCTION_TIMEOUT_MS): a Back held off for that long reads as
// a broken screen. The current app's screen has no warning on the way out either, on purpose (js/staff/people.js).
export function PeopleScreen() {
  const { t } = useT();
  return (
    <SettingsSubScreen door="people" title={t('people.title')}>
      <PartBoundary>
        <InviteCard />
      </PartBoundary>
    </SettingsSubScreen>
  );
}
