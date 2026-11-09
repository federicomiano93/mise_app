import { isSectionAllowed } from '@mise/shared/sections';
import { useSession } from '../session/SessionContext';

// Whether this person may see and write prices (parity C4, C5, C22): the role AND the venue's Food cost section on.
// ⚠️ THE VENUE'S SECTION, NOT THE ROLE'S (sectionsFor): the owner of the kitchen has no Food cost screen and does buy and load
// the invoices, so the rules give them purchase prices (managesPrices). canManage already leaves out employees.
// One answer for the price section of the card, the price write of a save and the price document of a delete —
// a price write the rules refuse fails the whole batch.
export function useMayWritePrices(): boolean {
  const { canManage, location } = useSession();
  return canManage && isSectionAllowed(location, 'foodcost');
}
