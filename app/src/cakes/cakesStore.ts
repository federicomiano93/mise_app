// cakesStore.ts — the cakes and the venue's reference grams, as the Cakes section reads them. One venue.
//
// NEW IN MISE 2 (20 Nov 2026), plain TypeScript with no React and no Firebase: the source is injected, so every trap below is a
// spec with a fake. Screens read it through CakesContext.tsx. It says nothing in words: a failure is a CakesMessage, and
// cakesMessages.ts puts it in the person's language.
//
// ⚠️ NOTHING IS WRITTEN TO THE PHONE'S STORAGE (no localStorage key: nothing is added to KEEP_PREFIXES). Memory plus Firestore's own
// offline copy answer the listeners, like Food cost's categories — so an EMPTY answer from this phone's own database may be a
// phone that never synced: `cakesFromServer` says when the server has spoken, and only then is «this cake no longer exists» true.
//
// ⚠️ A CAKE IS READ HERE AND SAVED BY FOOD COST'S STORE (foodcostStore.saveProduct with a companion): this store has no cake write,
// so a cake and its Food cost card cannot be saved apart.
//
// ⚠️ THE REFERENCE GRAMS ARE LOCAL-FIRST (P20): memory and the screen move at once — offline too — and a write the database REFUSES
// is rolled back and said out loud.

import { normalizeCake, normalizeReference } from '@mise/shared/cake-model';
import type { Cake, ReferenceGrams } from '@mise/shared/cake-model';
import type { CakesSource } from './cakesSource';

export type CakesMessage =
  // The cakes' live stream died.
  | { readonly kind: 'cakes-stream-broken' }
  // The reference grams were refused: they are back as they were.
  | { readonly kind: 'reference-not-saved' };

export interface CakesSnapshot {
  // Every cake, through normalizeCake (a document that is not a cake at all, or has no id, is dropped).
  readonly cakes: readonly Cake[];
  // The cakes have answered once (this phone's own copy or the server's), or the stream failed: the list can be drawn.
  readonly cakesLoaded: boolean;
  // The SERVER has answered about the cakes once: only then is «this cake no longer exists» the truth.
  readonly cakesFromServer: boolean;
  // The venue's reference grams: null until they arrive, when there are none, and when they are not all eight and valid.
  readonly reference: ReferenceGrams | null;
  // The reference has answered once: the server's word, or a copy that exists. A «missing» from this phone's own database is not an
  // answer (a device that never read it), so a screen never starts a cake from «no reference» when there is one.
  readonly referenceLoaded: boolean;
  // Writes handed over and not yet answered.
  readonly unsent: boolean;
}

export interface CakesDeps {
  now(): number;
  warn(message: string, detail?: unknown): void;
}

export interface CakesStore {
  getSnapshot(): CakesSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: CakesMessage) => void): () => void;
  // Starts the listeners; stop() ends them. Safe to call start → stop → start (React's development mode does exactly that).
  start(): void;
  stop(): void;
  // The venue's reference grams, local-first; a refusal puts them back and says so. Whoever may not write them is refused by the rules.
  saveReference(grams: ReferenceGrams): void;
}

export function readCakes(list: unknown): Cake[] {
  if (!Array.isArray(list)) return [];
  const out: Cake[] = [];
  for (const item of list) {
    const cake = normalizeCake(item);
    if (cake && cake.id !== '') out.push(cake);
  }
  return out;
}

export function createCakesStore(source: CakesSource, deps: CakesDeps): CakesStore {
  let cakes: readonly Cake[] = [];
  let cakesLoaded = false;
  let cakesFromServer = false;
  let reference: ReferenceGrams | null = null;
  let referenceLoaded = false;
  let inFlight = 0;

  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: CakesMessage) => void>();
  let stops: Array<() => void> = [];
  let started = false;
  let snapshot = build();

  function build(): CakesSnapshot {
    return { cakes, cakesLoaded, cakesFromServer, reference, referenceLoaded, unsent: inFlight > 0 };
  }

  function changed(): void {
    snapshot = build();
    for (const listener of [...listeners]) listener();
  }

  function say(message: CakesMessage): void {
    for (const listener of [...messageListeners]) listener(message);
  }

  const sameGrams = (a: ReferenceGrams | null, b: ReferenceGrams | null) =>
    a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    onMessage(listener) {
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },

    start() {
      if (started) return;
      started = true;

      stops.push(source.watchCakes(
        (remote, meta) => {
          if (meta.fromServer) cakesFromServer = true;
          cakes = readCakes(remote);
          cakesLoaded = true;
          changed();
        },
        err => {
          deps.warn('Cakes live sync failed:', err);
          // A dead stream still ends the wait: the list shows what it has, and says why it may be old.
          cakesLoaded = true;
          changed();
          say({ kind: 'cakes-stream-broken' });
        },
      ));

      stops.push(source.watchReference((data, meta) => {
        // ⚠️ A «MISSING» FROM THIS PHONE'S OWN DATABASE IS NOT AN ANSWER: a device that never read the document has no copy of
        // it, and a cake started on «no reference» would copy nothing.
        if (!data && !meta.fromServer) return;
        // The document is { bakery, grams, updatedAt }: the figures are its `grams`.
        reference = normalizeReference(data ? data['grams'] : null);
        referenceLoaded = true;
        changed();
      }));
    },

    stop() {
      started = false;
      for (const stop of stops) stop();
      stops = [];
    },

    saveReference(grams) {
      const prev = reference;
      const next = normalizeReference(grams);
      if (!next) return;
      reference = next;
      changed();
      inFlight += 1;
      changed();
      source.saveReference(next, new Date(deps.now()).toISOString()).then(() => undefined, err => {
        deps.warn('The reference grams did not sync to Firestore:', err);
        // Only if nothing newer has arrived meanwhile (another save, or the listener).
        if (sameGrams(reference, next)) {
          reference = prev;
          changed();
        }
        say({ kind: 'reference-not-saved' });
      }).finally(() => {
        inFlight -= 1;
        changed();
      });
    },
  };
}

export function browserCakesDeps(): CakesDeps {
  return {
    now: () => Date.now(),
    warn: (message, detail) => console.warn(message, detail),
  };
}
