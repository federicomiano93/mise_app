import { sectionsFor } from '@mise/shared/sections';
import { useSession } from '../session/SessionContext';

// Whether this person may see and write prices (parity C4, C5, C22): the role AND the venue's Food cost section on, as the
// session narrows it. One answer for the price section of the card, the price write of a save and the price document of a delete —
// a price write the rules refuse fails the whole batch.
export function useMayWritePrices(): boolean {
  const { canManage, location, role } = useSession();
  return canManage && sectionsFor(location, role).foodcost === true;
}
