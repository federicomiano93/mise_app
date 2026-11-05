// order-request-model.ts — an order list one person sends to another: ONLY `remainingIds`.
//
// TypeScript PARTIAL port of js/orders/order-request-model.js for Mise 2. `remainingIds` is the same, input for input:
// order-request-model.spec.ts runs its tests against BOTH files, and odd-inputs.spec.ts feeds both the same strange
// values.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. NOT PORTED (they come with the screens that need them):
//   - `MAX_LINES`, `REQUEST_WINDOW_DAYS`, `buildOrderRequest` — building and sizing the list that is sent;
//   - `senderName` — it ends in the dictionary (`orders.request.someone`);
//   - `isRequestDone`, `waitingRequests`, `splitRequestsByAge` — the banner and the window of the Orders screen;
//   - `groupRequest`, `supplierIdsOf`, `liveDifference` — the manager's working view; they import the Orders archive,
//     the day helpers and the supplier label of the Orders feature.
// `remainingIds` is here because the ingredient merge (ingredient-merge.ts) asks whether an unfinished list still
// names an ingredient.

// A list is a document (data): anything may arrive, and only `quantities` and `done` are read.
interface RequestLike {
  quantities?: unknown;
  done?: unknown;
}

// The lines still to order — what "Finish" would tick, and what the counter counts.
// ⚠️ A LIST IS FINISHED WHEN EVERY LINE IS TICKED — deduced, never stored (there is no «finished» field).
export function remainingIds(request?: unknown): string[] {
  const req = request as RequestLike | null | undefined;
  const done = (req?.done || {}) as Record<string, unknown>;
  return Object.keys((req?.quantities || {}) as object).filter(id => done[id] !== true);
}
