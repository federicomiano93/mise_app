import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { todayISO } from '@mise/shared/day';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { useOnline } from '../shell/useOnline';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { NoticesBell } from './NoticesBell';
import { NoticesProvider } from './NoticesContext';
import { OrdersProvider, useOrders, useOrdersStore } from './OrdersContext';
import { OrdersList } from './OrdersList';
import { DaySendScreen } from './DaySendScreen';
import { HistoryEditScreen } from './HistoryEditScreen';
import { IncomingMissingScreen } from './IncomingMissingScreen';
import { IncomingScreen } from './IncomingScreen';
import { HistoryScreen } from './HistoryScreen';
import { ReorderScreen } from './ReorderScreen';
import { SendScreen } from './SendScreen';
import { SettingsScreen } from './SettingsScreen';
import { PlaceAllConfirmScreen, SupplierConfirmScreen } from './PlaceConfirmScreen';
import { SupplierItemsScreen } from './SupplierItemsScreen';
import { SupplierOrderScreen } from './SupplierOrderScreen';
import { SupplierPicker } from './SupplierPicker';
import { LATCH_GRACE_MS, PendingLatchProvider, latchCanLook, pendingNow, usePendingLatch } from './pendingLatch';
import { LONG_MS } from './useClearQuantities';
import {
  CLEAR_OPENER, HandBackProvider, HISTORY_DOOR, INCOMING_DOOR, ITEMS_DOOR, PLACE_ALL_OPENER, PLACE_DOOR, REORDER_DOOR, SEND_OPENER,
  SETTINGS_OPENER, arrivalOpener, correctOpener, itemsOpener, pendingFallback, pendingOpener, sendDayOpener, supplierOpener,
  useHandBackState,
} from './handBack';
import { FROM_LIST, cameFromList, replacedState } from './ordersNav';
import {
  CLEAR_PATH, INCOMING_PATH, ORDERS_PATH, PLACE_ALL_PATH, REORDER_PATH, SEND_PATH, SETTINGS_PATH, historyDayPath, historyEditPath,
  incomingMissingPath, parseOrdersPath, supplierConfirmPath, supplierItemsPath, supplierPath,
} from './ordersPath';
import type { OrdersView } from './ordersPath';
import { buildOrdersLens } from './ordersLens';
import styles from './OrdersSection.module.css';

// «Orders»: the supplier list and, beside it from 1000px, the chosen supplier's order. Loaded only when somebody opens it
// (shell/sectionScreens.ts), and only for a person the venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: OrdersProvider starts the four listeners on mount and stops them on
// unmount (P14), sending a change still waiting for the autosave at once.
//
// Step 3f-1: the list and the shared order in progress (docs/parity/orders.md). Nothing in it is role-gated: every member
// with the section types quantities (L2). Step 3f-2 adds the day line, recording an order and clearing quantities; their short
// sentences ("Quantities cleared ✓") come through the StatusMessageProvider above, which outlives the screen that spoke.
export default function OrdersSection() {
  return (
    <OrdersProvider>
      <StatusMessageProvider>
        <PendingLatchProvider>
          <OrdersScreen />
        </PendingLatchProvider>
      </StatusMessageProvider>
    </OrdersProvider>
  );
}

type ShownView = Exclude<OrdersView, { kind: 'unknown' }>;

function OrdersScreen() {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  // The address as it is written, not React Router's «*»: a supplier id is split before it is decoded (ordersPath.ts).
  const view = parseOrdersPath(pathname.slice(ORDERS_PATH.length));
  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT: on a POP the app is arranging itself, so KEEP_FOCUS.
  if (view.kind === 'unknown') {
    return <Navigate to={ORDERS_PATH} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }
  return <OrdersLayout view={view} />;
}

// The page's status line: a stream that died, and an order that could not be saved. The live region is on the page BEFORE it
// speaks (an element inserted already filled is announced unreliably); only its text comes and goes. Derived from the
// store, so «could not be saved» goes the moment a later save lands (parity L5, L37).
function StatusLine() {
  const { t } = useT();
  const snapshot = useOrders();
  const lost = [
    snapshot.draftBroken ? t('ord.live.draft') : '',
    snapshot.suppliersBroken ? t('ord.live.suppliers') : '',
    snapshot.ingredientsBroken ? t('ord.live.ingredients') : '',
    snapshot.historyBroken ? t('ord.live.history') : '',
  ].filter(what => what !== '');
  return (
    <div role="status" className={styles.status}>
      {lost.map(what => <p key={what} className={styles.problem}>{t('ord.liveLost', { what })}</p>)}
      {snapshot.draftSaveFailed ? <p className={styles.problem}>{t('ord.saveFailed')}</p> : null}
    </div>
  );
}

function OrdersLayout({ view }: { view: ShownView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBackState();
  const snapshot = useOrders();
  const noSupplierName = t('ord.noSupplier');
  const store = useOrdersStore();
  const say = useStatusMessage();

  // The day chosen on a supplier's day line was refused: the line is back on the stored day, and the person is told. Here, not
  // in the line, so it is said even when the screen was left meanwhile.
  useEffect(() => store.onMessage(message => {
    if (message.kind === 'day-not-saved') say(t('ord.day.notSaved'), LONG_MS);
  }), [store, say, t]);

  // ⚠️ THE LENS IS THE ONE PLACE THAT DECIDES AN INGREDIENT'S SUPPLIER (ordersLens.ts): the list, a supplier's screen and
  // «What they sell» all read this one, so they can never disagree.
  const lens = useMemo(() => buildOrdersLens({
    suppliers: snapshot.suppliers,
    suppliersLoaded: snapshot.suppliersLoaded,
    ingredients: snapshot.ingredients,
    entries: snapshot.draft.entries,
    supplierOrder: snapshot.config.supplierOrder,
    noSupplierName,
  }), [snapshot.suppliers, snapshot.suppliersLoaded, snapshot.ingredients, snapshot.draft.entries, snapshot.config.supplierOrder, noSupplierName]);
  const ready = snapshot.suppliersLoaded && snapshot.ingredientsLoaded && snapshot.draftLoaded;

  // ⚠️ LOOK FOR ORDERS TYPED ON AN EARLIER DAY AND NEVER PLACED ONCE PER OPENING, once the suppliers, the ingredients and the draft
  // have ALL arrived (any of them missing would make every supplier look empty). The set found is kept above the routes, so it
  // survives the confirm screen and back (pendingLatch.tsx). ⚠️ From the server's answer, not the copy on the phone (latchCanLook).
  const pendingLatch = usePendingLatch();
  const online = useOnline();
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => { setGraceOver(true); }, LATCH_GRACE_MS);
    return () => { window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!ready || pendingLatch.latched !== null || !latchCanLook(snapshot.serverSeen, online, graceOver)) return;
    pendingLatch.latch(pendingNow(lens, snapshot.draft, todayISO()).map(row => row.supplier.id as string));
  }, [ready, pendingLatch, lens, snapshot.draft, snapshot.serverSeen, online, graceOver]);

  // ⚠️ THIS SECTION OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx): its list and its suppliers are
  // separate addresses, so the shell's reset to the top at every address would send the list back to the top at each supplier
  // on the split, and bring Back on a phone to the top of the list while the focus went to a row far below.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a screen opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  // A screen opens one level down, so Back steps up to the list. On the split, with one already open beside the list, picking
  // another is lateral and replaces it — and keeps whatever the entry it replaces knew about where Back goes.
  const open = (opener: string, path: string) => {
    handBack.expect(opener);
    if (split && view.kind !== 'list') {
      void navigate(path, { replace: true, state: replacedState(state) });
    } else {
      // On a phone the list is hidden behind the screen: the place in it is written down now, while it is what is on screen.
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(path, { state: FROM_LIST });
    }
  };
  const openSupplier = (id: string) => { open(supplierOpener(id), supplierPath(id)); };
  const openItems = (id: string) => { open(itemsOpener(id), supplierItemsPath(id)); };
  const openPlaceAll = () => { open(PLACE_ALL_OPENER, PLACE_ALL_PATH); };
  const openClear = () => { open(CLEAR_OPENER, CLEAR_PATH); };
  const openSend = () => { open(SEND_OPENER, SEND_PATH); };
  // «Placed yesterday» on a pending banner: the supplier's confirm screen, recording under the banner's day without asking whether it
  // was sent (it was: that is what the button says). The list is right behind the screen, so Back and a recorded order both go to it.
  const openPending = (id: string, day: string) => {
    handBack.expect(pendingOpener(id));
    if (split && view.kind !== 'list') {
      // ⚠️ THE CONFIRM SCREEN WALKS BACK TO THE LIST by `toList` after recording; without it the list would be pushed again on top
      // of the one already in the history (review of step 3f-6). The screen it replaces knew how far the list is.
      const kept = replacedState(state);
      const toList = cameFromList(state) ? ('stepsUp' in kept ? kept.stepsUp : 1) : undefined;
      void navigate(supplierConfirmPath(id), { replace: true, state: { ...kept, ...(toList === undefined ? {} : { toList }), pendingDay: day } });
    } else {
      if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(supplierConfirmPath(id), { state: { ...FROM_LIST, toList: 1, pendingDay: day } });
    }
  };
  const openSettings = () => { open(SETTINGS_OPENER, SETTINGS_PATH); };
  // Back from Incoming and from «To re-order» gives the focus to the list's door (the debt banner opens Incoming the same way).
  const openIncoming = () => { open(INCOMING_DOOR, INCOMING_PATH); };
  const openReorder = () => { open(REORDER_DOOR, REORDER_PATH); };

  // From History to the editor or the day screen, and from Incoming to the screen for one order: one level down, so Back is the
  // browser's Back. The place in the screen above is written down now, while it is what is on screen, and put back when Back
  // returns to it (History and Incoming can be long lists).
  const historyPlace = useRef<{ area: number | null; pane: number } | null>(null);
  const openFromHistory = (opener: string, path: string) => {
    handBack.expect(opener);
    historyPlace.current = { area: scrollArea()?.scrollTop ?? null, pane: detail.current?.scrollTop ?? 0 };
    void navigate(path, { state: FROM_LIST });
  };
  const openMissing = (id: string) => { openFromHistory(arrivalOpener(id), incomingMissingPath(id)); };
  const openEdit = (id: string) => { openFromHistory(correctOpener(id), historyEditPath(id)); };
  const openDay = (date: string) => { openFromHistory(sendDayOpener(date), historyDayPath(date)); };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so the place is back when the row
  // takes the focus: focusing a row that is in view scrolls nothing.
  //  - On the split the list keeps its place (the right-hand side starts at its own top, below).
  //  - On a phone, Back to the list restores the place written down when a screen opened; any other move starts at the top.
  //  - The first render does nothing: the shell reset the area when the section was entered.
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = pathname;
    const area = scrollArea();
    // The same address twice is StrictMode running the effect again, not a move.
    if (before === null || before === pathname || area === null) return;
    if (split) {
      listTop.current = null;
    } else if (view.kind === 'list' && listTop.current !== null) {
      area.scrollTop = listTop.current;
      listTop.current = null;
    } else if ((view.kind === 'history' || view.kind === 'incoming') && historyPlace.current?.area != null) {
      area.scrollTop = historyPlace.current.area;
    } else {
      area.scrollTop = 0;
    }
  }, [pathname]);

  // Back out of a supplier (its own Back, or the phone's back gesture): the button that opened it takes the focus, once the
  // list is on screen again (on a phone it was hidden behind the supplier, not unmounted).
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver(pendingFallback);
    // Back from History to the settings: the door that opened it. Back from the editor or the day screen to History: the card
    // button or the day's «Send all». ⚠️ NOT deliver(): History opened from the settings expects the DOOR, which is not on screen.
    else if (view.kind === 'settings') handBack.deliverIf(HISTORY_DOOR);
    else if (view.kind === 'history') handBack.deliverWhere(name => name.startsWith('correct:') || name.startsWith('send-day:'));
    // Back from «What arrived?» to Incoming: the row that opened it (gone when the order was answered: the title takes the focus).
    else if (view.kind === 'incoming') handBack.deliverWhere(name => name.startsWith('arrival:'));
    // The supplier's screen coming back from «What they sell»: only its own button is owed the focus. ⚠️ NOT deliver(): a
    // supplier opened from the list expects the list row, which must keep its focus (phone: the title takes it; split: the row).
    else if (view.kind === 'supplier') {
      handBack.deliverIf(ITEMS_DOOR);
      handBack.deliverIf(PLACE_DOOR);
    }
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own and stays mounted from one supplier to the next: another supplier
  // starts at its top instead of where the last one was left. On a phone it is not a scroll area and this is a no-op.
  useLayoutEffect(() => {
    if (!detail.current) return;
    const inHistory = view.kind === 'history' || view.kind === 'history-edit' || view.kind === 'history-day'
      || view.kind === 'incoming' || view.kind === 'incoming-missing';
    detail.current.scrollTop = view.kind === 'history' || view.kind === 'incoming' ? historyPlace.current?.pane ?? 0 : 0;
    // The place is only owed to History while it is the screen in play; leaving it for good forgets it.
    if (!inHistory) historyPlace.current = null;
  }, [pathname]);

  // ⚠️ WITH THE VENUE'S SWITCH OFF the three delivery addresses do not exist (decision F4): a bookmark, or a phone that was on
  // Incoming when somebody turned it off, goes to the list. Only once config/orders has answered (before that the switch reads on).
  const deliveryAddress = view.kind === 'incoming' || view.kind === 'incoming-missing' || view.kind === 'reorder';
  if (deliveryAddress && snapshot.configLoaded && !snapshot.deliveryCheck.on) {
    return <Navigate to={ORDERS_PATH} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }

  return (
    <HandBackProvider value={handBack}>
      {/* The bell and its panel share one state, kept above the page: the number and what it opens cannot disagree (step 3f-6). */}
      <NoticesProvider lens={lens} ready={ready}>
      <Page
        title={t('section.orders')}
        // The bell, only where the panel it opens can be seen: the list on a phone, every screen on the split. In a part of its own:
        // a failure in the bell must not take the page down.
        action={view.kind === 'list' || split ? <PartBoundary><NoticesBell /></PartBoundary> : undefined}
      >
        <StatusLine />
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <OrdersList
                lens={lens}
                ready={ready}
                openId={'id' in view ? view.id : null}
                onOpenSupplier={openSupplier}
                onOpenItems={openItems}
                onPlaceAll={openPlaceAll}
                onClearAll={openClear}
                onSend={openSend}
                onSettings={openSettings}
                onIncoming={openIncoming}
                onReorder={openReorder}
                onOpenPending={openPending}
              />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <Detail view={view} lens={lens} ready={ready} onOpenEdit={openEdit} onOpenDay={openDay} onOpenMissing={openMissing} />
            </PartBoundary>
          </div>
        </div>
      </Page>
      </NoticesProvider>
    </HandBackProvider>
  );
}

// The right-hand side of the split — and, on a phone, the whole screen when a supplier is open. With nothing chosen it says
// what to do.
//
// (No `key` on the screens: the section keeps one from one supplier to the next on the split, so the focus stays on the row
// that was pressed.)
function Detail({ view, lens, ready, onOpenEdit, onOpenDay, onOpenMissing }: {
  view: ShownView;
  lens: ReturnType<typeof buildOrdersLens>;
  ready: boolean;
  onOpenEdit: (id: string) => void;
  onOpenDay: (date: string) => void;
  onOpenMissing: (id: string) => void;
}) {
  const { t } = useT();
  const { configLoaded } = useOrders();
  if (view.kind === 'list') {
    // ⚠️ NOT BESIDE «NO SUPPLIERS YET»: a prompt to tap a row, next to a list that says there are none, would send somebody
    // looking for what is not there.
    if (!ready || lens.suppliers.length === 0) return null;
    return (
      <div className={styles.prompt}>
        <p className={styles.promptTitle}>{t('ord.pane.title')}</p>
        <p>{t('ord.pane.text')}</p>
      </div>
    );
  }
  if (!ready) {
    return <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>;
  }
  if (view.kind === 'items') return <SupplierItemsScreen id={view.id} lens={lens} />;
  if (view.kind === 'confirm') return <SupplierConfirmScreen id={view.id} lens={lens} />;
  if (view.kind === 'place-all') return <SupplierPicker mode="place-all" lens={lens} />;
  if (view.kind === 'place-all-confirm') return <PlaceAllConfirmScreen lens={lens} />;
  if (view.kind === 'clear') return <SupplierPicker mode="clear" lens={lens} />;
  if (view.kind === 'send') return <SendScreen lens={lens} />;
  if (view.kind === 'settings') return <SettingsScreen />;
  // The three delivery screens wait for config/orders: it holds the switch that decides whether they exist at all.
  if ((view.kind === 'incoming' || view.kind === 'incoming-missing' || view.kind === 'reorder') && !configLoaded) {
    return <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>;
  }
  if (view.kind === 'reorder') return <ReorderScreen />;
  if (view.kind === 'incoming' || view.kind === 'incoming-missing') {
    // ⚠️ INCOMING STAYS MOUNTED UNDER THE SCREEN FOR ONE ORDER (hidden, not drawn), like History under its editor: Back finds it, and
    // the place in it, as it was left.
    return (
      <>
        <IncomingScreen hidden={view.kind !== 'incoming'} onOpenMissing={record => { onOpenMissing(record.id); }} />
        {view.kind === 'incoming-missing' ? <IncomingMissingScreen key={view.id} id={view.id} /> : null}
      </>
    );
  }
  if (view.kind === 'history' || view.kind === 'history-day' || view.kind === 'history-edit') {
    // ⚠️ HISTORY STAYS MOUNTED UNDER THE EDITOR AND THE DAY SCREEN (hidden, not drawn): the cards that were opened and the older days
    // that were asked for are still there when Back returns to it.
    return (
      <>
        <HistoryScreen lens={lens} hidden={view.kind !== 'history'} onOpenEdit={record => { onOpenEdit(record.id); }} onOpenDay={onOpenDay} />
        {view.kind === 'history-day' ? <DaySendScreen key={view.date} date={view.date} lens={lens} /> : null}
        {view.kind === 'history-edit' ? <HistoryEditScreen key={view.id} id={view.id} /> : null}
      </>
    );
  }
  return <SupplierOrderScreen id={view.id} lens={lens} />;
}
