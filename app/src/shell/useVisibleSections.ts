import { useMemo } from 'react';
import { useSession } from '../session/SessionContext';
import { visibleSectionIds } from '../session/visibility';
import { arrangeSections } from './sections';

// The sections THIS person is shown in THIS venue, arranged for the rail, the tab bar and
// «More» — plus the set itself, for a route to ask «is this one on for me?».
//
// ⚠️ UX ONLY, NEVER A PERMISSION (see session/visibility.ts): the data of a hidden section is
// still refused by firestore.rules.
export function useVisibleSections() {
  const { location, canManage } = useSession();
  return useMemo(() => {
    const visible = visibleSectionIds(location, canManage);
    return { visible, ...arrangeSections(visible) };
  }, [location, canManage]);
}
