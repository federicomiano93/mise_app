import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { historyDocId, ingredientDisplayLabel } from '@mise/shared/archive';
import { dayWhen, localDayOf, todayISO } from '@mise/shared/day';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { unitConflictOfLines } from './unitConflictText';
import { useOrders, useOrdersStore } from './OrdersContext';
import {
  answerAwaiting, awaitingEntry, awaitingList, isAwaiting, putQuestionBack, shouldAskBeforeRecording,
} from './awaitingSent';
import type { AwaitingEntry, SentLines } from './awaitingSent';
import { dayTranslate } from './dayWords';
import { recordDateFor } from './orderDay';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';

// One supplier's part of a send that was handed over: exactly what went. `draft`: what the draft said for it at the send, when the
// numbers that went differ («Send it now» sends the confirmed ones): «Yes» clears those lines too.
export interface HandedOver extends SentLines {
  readonly supplierId: string;
  readonly date?: string;
  readonly draft?: SentLines;
}

export interface AwaitingApi {
  // Handed over: every device now asks «did it go?» about exactly what went. `handOff` 'share': the share sheet answered, the person
  // is back here already, so this device asks at once; 'text': a window opened, it asks when the page comes back.
  wait(sent: readonly HandedOver[], options: { handOff: 'share' | 'text' }): void;
  // «Yes» / «No» from the banner (or the dialog), about the send `at`.
  answer(supplierId: string, answer: 'yes' | 'no', at: string): Promise<void>;
  // The banners to draw: one per waiting supplier the venue still has, oldest first.
  readonly list: ReadonlyArray<AwaitingEntry & { readonly supplier: StoredDoc }>;
  // The sentence of one banner.
  question(supplier: StoredDoc, entry: AwaitingEntry): string;
  // This device is answering for that supplier: both buttons wait.
  busy(supplierId: string): boolean;
}

const AwaitingContext = createContext<AwaitingApi | null>(null);

export function useAwaitingSent(): AwaitingApi {
  const api = useContext(AwaitingContext);
  if (!api) throw new Error('useAwaitingSent outside AwaitingSentProvider');
  return api;
}

type Asking = { supplierId: string; entry: AwaitingEntry; title: string };

// «Order to Bruno sent at 10:42: did it go?» — the current app's PR #554, wired for Mise 2 (orders-main.js waitForAnswer,
// maybeAskHere, answerAwaitingSent). The rules are awaitingSent.ts; the writes the store's askDidItGo / claimDidItGo / placeSent.
//
// ⚠️⚠️ HANDED OVER IS NOT «GONE». The question is written into the shared draft (drafts/current.awaitingSent), so EVERY device shows it
// (AwaitingBanner) until somebody answers, and whoever answers first records it — or not. The device that sent it also asks with a
// dialog as soon as it is back from WhatsApp (or at once, after the share sheet answered). Escape leaves it to the banner.
// ⚠️ A QUESTION THAT COULD NOT BE SHARED (the write refused) STAYS ON THIS DEVICE, and is answered here without a claim: an order
// handed over must never be left with nobody asking. So does one the recording could not put back (offline: a transaction is never
// queued), until the network returns.
export function AwaitingSentProvider({ lens, children }: { lens: OrdersLens; children: ReactNode }) {
  const { t, locale } = useT();
  const store = useOrdersStore();
  const { draft } = useOrders();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  // The questions THIS device sent: supplierId → { at, seen } (`seen` once the draft has shown the key, so its later absence means
  // somebody answered).
  const askHere = useRef(new Map<string, { at: string; seen: boolean }>());
  // The questions this device could not share, answered here without a claim.
  const [local, setLocal] = useState<ReadonlyMap<string, AwaitingEntry>>(new Map());
  const localRef = useRef(local);
  localRef.current = local;
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const busySet = useRef(new Set<string>());
  const askingBefore = useRef(new Set<string>());
  const wanted = useRef(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const askingRef = useRef(false);
  const retry = useRef(new Map<string, AwaitingEntry>());
  const yesButton = useRef<HTMLButtonElement>(null);

  const latest = useRef({ t, locale, lens, draft, say, confirm, alert, store });
  latest.current = { t, locale, lens, draft, say, confirm, alert, store };

  const setLocalEntry = useCallback((id: string, entry: AwaitingEntry | null) => {
    const next = new Map(localRef.current);
    if (entry) next.set(id, entry); else next.delete(id);
    localRef.current = next;
    setLocal(next);
  }, []);

  // The questions as the screen shows them: the draft's, plus any this device could not share.
  const currentAwaiting = useCallback((): Record<string, unknown> => {
    const all: Record<string, unknown> = { ...latest.current.store.getSnapshot().draft.awaitingSent };
    localRef.current.forEach((entry, id) => { if (!isAwaiting(all[id])) all[id] = entry; });
    return all;
  }, []);

  // «Order to Bruno sent at 10:42: did it go?» — with the day too when it was not today.
  const question = useCallback((supplier: StoredDoc, entry: AwaitingEntry): string => {
    const { t: say2, locale: loc } = latest.current;
    const when = new Date(entry.at);
    const valid = !Number.isNaN(when.getTime());
    const time = valid ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(when) : '';
    const day = valid ? localDayOf(entry.at) : '';
    return day && day !== todayISO()
      ? say2('ord.awaiting.questionDay', { supplier: supplierLabel(supplier), when: dayWhen(day, new Date(), dayTranslate(say2)), time })
      : say2('ord.awaiting.question', { supplier: supplierLabel(supplier), time });
  }, []);

  const nameOf = (id: string) => {
    const supplier = latest.current.lens.supplierById(id);
    return supplier ? supplierLabel(supplier) : '';
  };

  // On the device that sent it, once the page is back: the same question as a dialog, one supplier after the other.
  const maybeAsk = useCallback(() => {
    if (!wanted.current || askingRef.current || document.visibilityState !== 'visible') return;
    // ⚠️ NEVER OVER ANOTHER DIALOG (a send editor still going through its suppliers, a confirmation): the next snapshot or the page
    // coming back asks again, and the banner asks meanwhile.
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const all = currentAwaiting();
    const next = [...askHere.current].find(([id, mine]) => {
      const live = all[id];
      return mine.seen && isAwaiting(live) && live.at === mine.at;
    });
    if (!next) {
      if (![...askHere.current.values()].some(mine => !mine.seen)) wanted.current = false;
      return;
    }
    const [supplierId] = next;
    askHere.current.delete(supplierId);
    const supplier = latest.current.lens.supplierById(supplierId);
    const entry = all[supplierId];
    if (!supplier || !isAwaiting(entry)) { maybeAsk(); return; }
    askingRef.current = true;
    setAsking({ supplierId, entry, title: question(supplier, entry) });
  }, [currentAwaiting, question]);

  // A question the recording could not put back (offline) stays on THIS device and goes back to the shared draft when the network
  // returns — unless a newer send already stands there, which then keeps its own.
  const retryQuestions = useCallback(async () => {
    for (const [id, entry] of [...retry.current]) {
      if (localRef.current.get(id) !== entry) { retry.current.delete(id); continue; }
      try {
        await latest.current.store.restoreDidItGo(id, entry);
      } catch { continue; }
      retry.current.delete(id);
      setLocalEntry(id, null);
    }
    if (!retry.current.size) window.removeEventListener('online', onOnline.current);
  }, [setLocalEntry]);
  const onOnline = useRef(() => { void retryQuestions(); });
  useEffect(() => {
    const listener = onOnline.current;
    return () => { window.removeEventListener('online', listener); };
  }, []);

  const keepHere = useCallback((id: string, entry: AwaitingEntry) => {
    setLocalEntry(id, entry);
    askHere.current.set(id, { at: entry.at, seen: true });
    latest.current.say(latest.current.t('ord.awaiting.notShared', { supplier: nameOf(id) }), LONG_MS);
  }, [setLocalEntry]);

  const wait = useCallback((sent: readonly HandedOver[], { handOff }: { handOff: 'share' | 'text' }) => {
    const at = new Date().toISOString();
    const current = latest.current.store.getSnapshot().draft;
    for (const { supplierId, quantities, units, date, draft: before } of sent) {
      const entry = awaitingEntry({ at, date: date ?? recordDateFor(current, supplierId, todayISO()), quantities, units, draft: before ?? null });
      if (!entry) continue;
      askHere.current.set(supplierId, { at: entry.at, seen: false });
      setLocalEntry(supplierId, null);
      void latest.current.store.askDidItGo(supplierId, entry).then(shared => {
        if (shared) return;
        // Refused (rules not yet deployed, a revoked session): the other devices will never see it, so the question stays HERE.
        keepHere(supplierId, entry);
        maybeAsk();
      });
    }
    if (handOff === 'share' && document.visibilityState === 'visible') wanted.current = true;
    // After the editor's own dialog has left the page.
    requestAnimationFrame(() => { maybeAsk(); });
  }, [keepHere, maybeAsk, setLocalEntry]);

  // A draft snapshot arrived: a question this device sent is «seen» once the draft holds it, and forgotten once the draft no longer does
  // (somebody answered) or holds a newer send.
  useEffect(() => {
    const all = currentAwaiting();
    askHere.current.forEach((mine, id) => {
      const live = all[id];
      if (isAwaiting(live) && live.at === mine.at) { mine.seen = true; return; }
      if (mine.seen || (isAwaiting(live) && live.at !== mine.at)) askHere.current.delete(id);
    });
    maybeAsk();
  }, [draft.awaitingSent, local, currentAwaiting, maybeAsk]);

  // ⚠️ RECORDED ANOTHER WAY («Order placed», «Yes, sent», «Placed yesterday»): a question about that supplier held only on this device is
  // answered by that very recording (the store removes the shared key itself). Left standing, a later «Yes» would record it twice.
  useEffect(() => store.onMessage(message => {
    if (message.kind !== 'order-recorded') return;
    askHere.current.delete(message.supplierId);
    retry.current.delete(message.supplierId);
    if (localRef.current.has(message.supplierId)) setLocalEntry(message.supplierId, null);
  }), [store, setLocalEntry]);

  // Back from WhatsApp (or the mail app) after a send: «did it go?» at once, on THIS device.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible' || !askHere.current.size) return;
      wanted.current = true;
      maybeAsk();
    };
    document.addEventListener('visibilitychange', back);
    return () => { document.removeEventListener('visibilitychange', back); };
  }, [maybeAsk]);

  const answer = useCallback(async (supplierId: string, given: 'yes' | 'no', at: string) => {
    const { t: say2, store: orders, confirm: ask } = latest.current;
    const tell = latest.current.say;
    const localEntry = localRef.current.get(supplierId) ?? null;
    const stored = orders.getSnapshot().draft.awaitingSent[supplierId];
    const entry = localEntry ?? (isAwaiting(stored) ? stored : null);
    if (!entry || (at && entry.at !== at)) {
      tell(say2('ord.awaiting.elsewhere'), 4000);
      return;
    }
    // A transaction and a record both need the network (placing says the same).
    if (given === 'yes' && navigator.onLine === false) {
      tell(say2('ord.offline.place'), LONG_MS);
      return;
    }
    let choice = given;
    let notRecorded = false;
    // ⚠️ «YES» WHEN HISTORY ALREADY HOLDS THIS ORDER (that supplier, that day, every stored line at least as large): another device (one
    // still on an older version records without knowing of this question) has probably recorded it, and recording again doubles it.
    // Ask first; «Don't record» goes the very same road as «No».
    const snapshot = orders.getSnapshot();
    const date = entry.date || recordDateFor(snapshot.draft, supplierId, todayISO());
    const filed = snapshot.history.find(record => record.id === historyDocId(date, supplierId)) ?? null;
    if (choice === 'yes' && shouldAskBeforeRecording(entry, filed)) {
      if (askingBefore.current.has(supplierId)) return;
      askingBefore.current.add(supplierId);
      let record: boolean;
      try {
        record = await ask({
          title: say2('ord.awaiting.maybeRecorded.title'),
          message: say2('ord.awaiting.maybeRecorded.body', { supplier: nameOf(supplierId) }),
          okLabel: say2('ord.awaiting.maybeRecorded.yes'),
          cancelLabel: say2('ord.awaiting.maybeRecorded.no'),
        });
      } finally {
        askingBefore.current.delete(supplierId);
      }
      // Answered on another device while the question was open.
      const now = orders.getSnapshot().draft.awaitingSent[supplierId];
      if (!localEntry && (!isAwaiting(now) || now.at !== entry.at)) {
        tell(say2('ord.awaiting.elsewhere'), 4000);
        return;
      }
      if (!record) { choice = 'no'; notRecorded = true; }
    }
    askHere.current.delete(supplierId);
    const name = nameOf(supplierId);
    const answering = answerAwaiting(choice, supplierId, entry, {
      busy: busySet.current,
      claim: (id, sendAt) => orders.claimDidItGo(id, sendAt),
      // ⚠️ THE STORED QUANTITIES, on the day they were for: this IS the answer to «did you send it?». Only the lines that went are cleared.
      record: async (id, sent) => {
        const outcome = await orders.placeSent(id, sent, say2('ord.noSupplier'));
        if (outcome.kind === 'saved') {
          announceAction('order-sent');
          tell(say2('ord.savedToHistory', { names: name }), 5000);
          return true;
        }
        if (outcome.kind === 'not-cleared') {
          announceAction('order-sent');
          tell(say2('ord.savedNotCleared', { name }), LONG_MS);
          return true;
        }
        if (outcome.kind === 'unit-conflict') {
          // Today's record holds these lines in a unit this order cannot be added to: said with the lines, as placing says it.
          const lines = latest.current.lens.linesOf(id);
          const names = outcome.ids.map(line => {
            const card = lines.find(candidate => candidate.id === line);
            return (card && ingredientDisplayLabel(card)) || line;
          });
          void latest.current.alert({
            message: unitConflictOfLines({ date: sent.date || todayISO(), names, now: new Date(), t: say2 }),
            okLabel: say2('common.ok'),
          });
          return false;
        }
        tell(`${say2('ord.notRecorded', { names: name })} ${say2('ord.tryAgain')}`, LONG_MS);
        return false;
      },
      // Not awaited: the answer is not held open by a write. Only if no question stands for this supplier now (a newer send by another
      // device keeps its own); offline the transaction rejects, and the question then stays on THIS device.
      restore: (id, sent) => {
        void putQuestionBack(id, sent, {
          write: (qid, value) => orders.restoreDidItGo(qid, value),
          keepHere: (qid, value, err) => {
            console.error('Putting the question back failed:', err);
            keepHere(qid, value);
            retry.current.set(qid, value);
            if (retry.current.size === 1) window.addEventListener('online', onOnline.current);
          },
        });
      },
      drop: id => { void orders.dropDidItGo(id); },
    }, { local: localEntry !== null });
    // The banner's two buttons go quiet while this answer is under way.
    setBusyIds(new Set(busySet.current));
    const result = await answering;
    setBusyIds(new Set(busySet.current));
    if (localEntry && (result === 'recorded' || result === 'dropped')) setLocalEntry(supplierId, null);
    if (result === 'dropped') tell(notRecorded ? say2('ord.awaiting.notRecorded') : say2('ord.awaiting.kept', { supplier: name }), 5000);
    else if (result === 'elsewhere') tell(say2('ord.awaiting.elsewhere'), 4000);
    else if (result === 'claimFailed') tell(say2('ord.couldNotSaveOrder'), LONG_MS);
  }, [keepHere, setLocalEntry]);

  const list = useMemo(() => {
    const all: Record<string, unknown> = { ...draft.awaitingSent };
    local.forEach((entry, id) => { if (!isAwaiting(all[id])) all[id] = entry; });
    return awaitingList(all, lens.suppliers);
  }, [draft.awaitingSent, local, lens.suppliers]);

  const api = useMemo<AwaitingApi>(() => ({
    wait, answer, list, question, busy: id => busyIds.has(id),
  }), [wait, answer, list, question, busyIds]);

  // ⚠️ THE FOCUS GOES TO «YES» EVEN WHEN A DIALOG THAT JUST CLOSED (the send editor) HANDS ITS OWN BACK A FRAME LATER: that hand-back
  // would leave the question open with the focus on the page behind it, where Escape and the keyboard cannot reach it.
  useEffect(() => {
    if (!asking) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const box = yesButton.current?.closest('[role="alertdialog"]');
        if (box && !box.contains(document.activeElement)) yesButton.current?.focus();
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [asking]);

  const settle = (given: 'yes' | 'no' | null) => {
    const asked = asking;
    askingRef.current = false;
    setAsking(null);
    if (asked && given) void answer(asked.supplierId, given, asked.entry.at).then(() => { maybeAsk(); });
    else requestAnimationFrame(() => { maybeAsk(); });
  };

  return (
    <AwaitingContext.Provider value={api}>
      {children}
      {asking ? (
        <Dialog
          isOpen
          role="alertdialog"
          title={asking.title}
          // Escape leaves it to the banner: nothing is answered.
          onClose={() => { settle(null); }}
          actions={(
            <>
              <Button onPress={() => { settle('no'); }}>{t('ord.awaiting.no')}</Button>
              <Button ref={yesButton} variant="primary" autoFocus onPress={() => { settle('yes'); }}>{t('ord.awaiting.yes')}</Button>
            </>
          )}
        />
      ) : null}
      {confirmDialog}
      {alertDialog}
    </AwaitingContext.Provider>
  );
}
