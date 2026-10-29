import { countryOf } from '@mise/shared/market';
import { useSession } from '../../session/SessionContext';
import { useMayWritePrices } from '../useMayWritePrices';

// Whether this person may open «Import from invoices» in this venue: the right to write prices (an owner or manager of a venue
// with Food cost on — the rules gate `ingredient-prices` on both, and a batch is all-or-nothing, parity I2) AND a venue in Italy
// (decision F3 (b)): the importer reads only Italian e-invoices (FatturaPA) and its word lists are Italian, so a UK venue has no
// use for the door. The rules are the real guard (P2); this is courtesy, for the door and for the address.
export function useMayImport(): boolean {
  const { location } = useSession();
  const mayWritePrices = useMayWritePrices();
  return mayWritePrices && countryOf(location) === 'IT';
}
