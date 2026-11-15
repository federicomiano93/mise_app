import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { todayISO } from '@mise/shared/day';
import { outputLanguage } from '@mise/shared/market';
import { sendOffers, settleOnce } from '@mise/shared/send-chooser';
import type { SendOffer } from '@mise/shared/send-chooser';
import type { EditorAnswer, EditorJob } from '@mise/shared/send-editor';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { useOrders, useOrdersStore } from './OrdersContext';
import { RoadChooser } from './RoadChooser';
import { SendEditorDialog } from './SendEditorDialog';
import { recordDateFor } from './orderDay';
import { canSharePhotos } from './orderImage';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import { openWindow, sendTranslate, takeRoad } from './sendFlow';
import type { RoadResult, SendRow, SendUi } from './sendFlow';
import { unitConflictText } from './unitConflictText';
import { LONG_MS } from './useClearQuantities';

export interface SendRequest {
  // The suppliers to send to and their lines (draftSendRows, or confirmedSendRows for «Send it now»).
  readonly rows: readonly SendRow[];
  // One message for all the rows (a WhatsApp chat) or one per supplier. A road to the supplier is always one each.
  readonly grouped: boolean;
  // «Send it now»: only the roads that put the order in a SUPPLIER's hands.
  readonly supplierRoadsOnly: boolean;
  // A recorded order sent again from History (step 3f-4): it will not be recorded again, so today's record cannot clash with
  // it and the same-day unit check is skipped. Left out: checked.
  readonly resend?: boolean;
}

type Offer = SendOffer<StoredDoc>;
type Chooser = { offers: readonly Offer[]; pick: (offer: Offer) => void; cancel: () => void };
type EditorAsk = { job: EditorJob; i: number; n: number; photo: boolean; answer: (answer: EditorAnswer) => void };

// Sending an order, from the send screen and from «Send it now» on the confirm screen — ONE flow, so the two can never behave
// differently:
//
//   const [send, sendDialogs] = useSendOrder(lens);
//   const result = await send({ rows, grouped, supplierRoadsOnly });   // null: nothing was sent (a notice said why, or it was backed out of)
//
// The second value is every dialog the flow may open and goes in the component's output.
//
// ⚠️ `send` IS CALLED SYNCHRONOUSLY FROM THE PRESS OF THE BUTTON THE PERSON TAPPED. With one road open it takes that
// road in the same tick; with several it draws the chooser, and the road's own button takes the road in ITS press. Either way
// takeRoad does its unit check in that tick. Since the send editor (sendFlow.ts) a window or the share sheet opens in the EDITOR's own
// «Send» press, one editor per message, so a message never needs the first tap.
//
// ⚠️ THE IN-APP «TO THE MANAGER» LIST IS A ROAD LIKE THE OTHERS (step 3f-7) EXCEPT IN TWO PLACES. «Send it now» never offers it (sendOffers:
// it puts the order in a SUPPLIER's hands), and a recorded order sent again from History never offers it either: the list is a
// photograph of the SHARED ORDER, and a past day is not that. It opens no editor and no window, and it is asked
// «nobody will be told?» first.
export function useSendOrder(lens: OrdersLens): readonly [(request: SendRequest) => Promise<RoadResult | null>, ReactNode] {
  const { t } = useT();
  const session = useSession();
  const store = useOrdersStore();
  const { config, draft } = useOrders();
  const [alert, alertDialog] = useAlert();
  const [confirm, confirmDialog] = useConfirm();
  const [chooser, setChooser] = useState<Chooser | null>(null);
  const [editor, setEditor] = useState<EditorAsk | null>(null);
  // What is waiting for an answer, so a screen that goes away leaves nothing hanging.
  const waiting = useRef(new Set<() => void>());

  // The latest of everything `send` reads: it is called from a press and must never close over an old render.
  const tell = useStatusMessage();
  const latest = useRef({ t, session, store, config, draft, lens, alert, confirm, tell });
  latest.current = { t, session, store, config, draft, lens, alert, confirm, tell };

  useEffect(() => {
    const pending = waiting.current;
    return () => {
      [...pending].forEach(giveUp => { giveUp(); });
      pending.clear();
    };
  }, []);

  // ⚠️ WHETHER THE SCREEN THAT USES THIS HOOK IS STILL THERE: the flow waits on reads before it writes, and a person who went Back
  // meanwhile must not get a list they have left behind (sending again would make two). SET ON EVERY MOUNT: StrictMode runs the
  // cleanup and then the effect again.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The sender's name is one document read: started now, it has had the time the person spends ticking suppliers by the tap.
  const signedInUid = session.user?.uid ?? '';
  useEffect(() => {
    if (signedInUid !== '') store.prepareSender(signedInUid);
  }, [store, signedInUid]);

  // A question to the person: `show` draws it, the dialog's `answer` settles it once, and a screen that goes away answers
  // `ifLeft` for it.
  const ask = useCallback(<A, Q extends { answer: (value: A) => void }>(
    show: (question: Q | null) => void, build: (answer: (value: A) => void) => Q, ifLeft: A,
  ): Promise<A> => new Promise<A>(resolve => {
    const settle = settleOnce<A>(resolve, () => { show(null); });
    const giveUp = () => { settle(ifLeft); };
    waiting.current.add(giveUp);
    show(build(value => {
      waiting.current.delete(giveUp);
      settle(value);
    }));
  }), []);

  const send = useCallback((request: SendRequest): Promise<RoadResult | null> => {
    const { t: say, session: who, store: orders, config: cfg, draft: current, lens: view } = latest.current;
    const words = sendTranslate(say);
    const suppliers = request.rows.map(row => view.supplierById(row.id)).filter((s): s is StoredDoc => s !== undefined);
    const offers = sendOffers({
      settings: cfg.sendSettings, canManage: who.canManage, suppliers, supplierRoadsOnly: request.supplierRoadsOnly, t: words,
    }).filter(offer => !(request.resend && offer.route === 'manager'));

    if (offers.length === 0) {
      return latest.current.alert({ message: say('ord.send.noRouteAvailable'), okLabel: say('common.ok') }).then(() => null);
    }

    const language = outputLanguage(who.location);
    const ui: SendUi = {
      alert: message => latest.current.alert({ message, okLabel: latest.current.t('common.ok') }),
      canSharePhotos,
      askEditor: question => ask<EditorAnswer, EditorAsk>(setEditor, answer => ({ ...question, answer }), { outcome: 'cancelled', text: question.job.text }),
      confirmText: () => latest.current.confirm({
        message: latest.current.t('ord.sendFormat.photoFailed'),
        okLabel: latest.current.t('common.ok'),
        cancelLabel: latest.current.t('common.cancel'),
      }),
      sendList: async rows => {
        const uid = who.user?.uid ?? '';
        // ⚠️ NEVER BLOCKS, ONLY REFUSES TO BE SILENT: the list still belongs in the app. A failed read answers «go ahead» (the store).
        // ⚠️ SAID BEFORE THE READ: on a bad connection the reads take over ten seconds, and a tap that answers nothing gets tapped again.
        latest.current.tell(say('ord.request.sending'), LONG_MS);
        const away = await orders.whoIsAway(uid);
        // ⚠️ LEFT DURING THE READ: nothing is written, and «Sending…» does not stay up over the screen they went to.
        if (!mounted.current) {
          latest.current.tell('');
          return null;
        }
        if (away.nobody) {
          // ⚠️ «Sending…» MUST NOT STAY UP ABOVE THE QUESTION: the person is being asked, nothing is being sent yet.
          latest.current.tell('');
          const names = away.names.map(name => name || say('ord.request.someone'));
          const goAhead = await latest.current.confirm({
            title: say('ord.away.nobodyTitle'),
            // ⚠️ `n` IS THE COUNT, so the verb agrees.
            message: names.length > 0
              ? say('ord.away.nobodyMessage', { names: names.join(', '), n: names.length })
              : say('ord.away.nobodyMessagePlain'),
            okLabel: say('ord.away.sendAnyway'),
            cancelLabel: say('common.cancel'),
          });
          if (!goAhead) return null;
        }
        latest.current.tell(say('ord.request.sending'), LONG_MS);
        return orders.sendList(rows.map(row => row.id), uid, say('ord.noSupplier'), () => mounted.current);
      },
    };
    // The same-day unit check, from the live records (a read would be an await, and a window must open inside the tap).
    const unitRefusal = (rows: readonly SendRow[]): string => {
      const checks = orders.conflictsNow(
        rows.map(row => ({ supplierId: row.id, date: recordDateFor(current, row.id, todayISO()) })),
        say('ord.noSupplier'),
      );
      const groups = checks
        .filter(check => check.conflicts.length > 0)
        .map(check => ({
          supplierName: supplierLabel(view.supplierById(check.supplierId)) || check.supplierId,
          date: check.date,
          conflicts: check.conflicts,
        }));
      return unitConflictText({ groups, several: rows.length > 1, recording: false, now: new Date(), t: say });
    };
    const take = (offer: Offer): Promise<RoadResult> => takeRoad({
      offer,
      rows: request.rows,
      settings: { grouped: request.grouped, locationName: who.name, language },
      unitRefusal: request.resend ? () => '' : unitRefusal,
      open: openWindow,
      t: words,
    }, ui);

    const [only] = offers;
    // ⚠️ ONE ROAD: taken in THIS tick. No chooser, no await.
    if (offers.length === 1 && only) return take(only);

    return new Promise<RoadResult | null>(resolve => {
      const settle = settleOnce<Promise<RoadResult | null> | null>(resolve, () => { setChooser(null); });
      const giveUp = () => { settle(null); };
      waiting.current.add(giveUp);
      setChooser({
        offers,
        // ⚠️ THE ROAD'S OWN PRESS: the chooser closes and the road is taken here, in the same handler, never in an effect.
        // ⚠️ ONLY WHILE THE CHOOSER IS STILL WAITING: `take` opens windows, and a second press (or one after Cancel) must find the
        // question already answered, never open them again — settleOnce alone would ignore the answer AFTER `take` had run.
        pick: offer => {
          if (!waiting.current.has(giveUp)) return;
          waiting.current.delete(giveUp);
          settle(take(offer));
        },
        cancel: () => {
          waiting.current.delete(giveUp);
          settle(null);
        },
      });
    });
  }, [ask]);

  const dialogs = (
    <>
      {chooser ? <RoadChooser offers={chooser.offers} onPick={chooser.pick} onCancel={chooser.cancel} /> : null}
      {editor ? <SendEditorDialog key={editor.i} job={editor.job} i={editor.i} n={editor.n} photo={editor.photo} language={outputLanguage(session.location)} answer={editor.answer} /> : null}
      {confirmDialog}
      {alertDialog}
    </>
  );
  return [send, dialogs];
}
