import { useMemo } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import type { SettingsSource } from './settingsSource';

// The open venue's settings source, for a screen that acts (the language, the sections for employees). The venue cannot change under
// it: a venue switch reloads the whole app (session.ts).
export function useSettingsSource(): SettingsSource {
  const services = useDataServices();
  const { locationId } = useSession();
  // These screens are drawn only for a ready session, so a venue is always open here.
  if (!locationId) throw new Error('Settings needs an open venue.');
  return useMemo(() => services.settings(locationId), [services, locationId]);
}
