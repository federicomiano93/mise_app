import { createContext, useContext } from 'react';

// The suppliers THIS phone's screens have just deleted, so the supplier screen does not treat the disappearance as news.
//
// SupplierScreen says «This supplier no longer exists.» and leaves when an open supplier vanishes from the list — the way
// it learns that another phone deleted it. A delete made here says «Supplier deleted.» and leaves by itself
// (useDeleteSupplier), so without this the person would read both and the screen would step back twice. The screen asks
// `has(id)` before it says or leaves.
//
// The mark is taken off when the supplier comes back (a delete the database refused puts it back, and a later delete on
// another phone is then news again): the section calls `prune` with the suppliers it can see.
//
// (The recipes' recipeDeletions.ts, for suppliers: a feature never imports from another feature's folder.)

export interface SupplierDeletions {
  mark(supplierId: string): void;
  has(supplierId: string): boolean;
  // Forgets every mark whose supplier is in `presentIds`.
  prune(presentIds: Iterable<string>): void;
}

const NOTHING: SupplierDeletions = {
  mark() { /* no section around */ },
  has: () => false,
  prune() { /* ditto */ },
};

const SupplierDeletionsContext = createContext<SupplierDeletions>(NOTHING);
export const SupplierDeletionsProvider = SupplierDeletionsContext.Provider;

export function useSupplierDeletions(): SupplierDeletions {
  return useContext(SupplierDeletionsContext);
}

export function createSupplierDeletions(): SupplierDeletions {
  const marked = new Set<string>();
  return {
    mark(supplierId) { marked.add(supplierId); },
    has: supplierId => marked.has(supplierId),
    prune(presentIds) {
      for (const id of presentIds) marked.delete(id);
    },
  };
}
