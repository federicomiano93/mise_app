import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { useStatusMessage } from '../ui/StatusMessage';
import { SuppliersWritesProvider, useSuppliersStore } from './SuppliersContext';
import { messageText } from './suppliersMessages';
import type { SuppliersDeps } from './suppliersStore';

// What another section puts around itself to add records from inside it (T15: the Recipe catalogue's «+ Add "…" as an
// ingredient»): the write-only Suppliers store (no listener, no read — SuppliersContext.tsx), and the refusals it reports said
// in the person's words through that section's own status message, as «Ingredients & suppliers» says them.
//
// ⚠️ IT MUST SIT INSIDE THE SECTION'S StatusMessageProvider: a refusal arrives after the card has closed, and is said there.
export function CreateIngredientProvider({ children, deps }: { children: ReactNode; deps?: SuppliersDeps }) {
  return (
    <SuppliersWritesProvider deps={deps}>
      <RefusalsSaid />
      {children}
    </SuppliersWritesProvider>
  );
}

function RefusalsSaid() {
  const { t } = useT();
  const store = useSuppliersStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => { say(messageText(t, message)); }), [store, t, say]);
  return null;
}
