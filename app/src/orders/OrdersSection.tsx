import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { todayISO } from '@mise/shared/day';
import { mayEditRecords } from '@mise/shared/records';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { useOnline } from '../shell/useOnline';
import { useSession } from '../session/SessionContext';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { CardDoorsProvider } from './CardDoors';
import type { CardDoor } from './CardDoors';
import { NoticesBell } from './NoticesBell';
import { NoticesProvider } from './NoticesContext';
import { OrdersProvider, useOrders, useOrdersStore } from './OrdersContext';
import { IngredientsList } from './IngredientsList';
import { OrdersList } from './OrdersList';
import { DaySendScreen } from './DaySendScreen';
import { HistoryEditScreen } from './HistoryEditScreen';
import { IncomingMissingScreen } from './IncomingMissingScreen';
import { IncomingScreen } from './IncomingScreen';
import { OrderListScreen } from './OrderListScreen';
import { OrderListsScreen } from './OrderListsScreen';
import { HistoryScreen } from './HistoryScreen';
import { ReorderScreen } from './ReorderScreen';
import { SendScreen } from './SendScreen';
import { SettingsScreen } from './SettingsScreen';
import { SupplierSequenceScreen } from './SupplierSequenceScreen';
import { PlaceAllConfirmScreen, SupplierConfirmScreen } from './PlaceConfirmScreen';
import { SupplierItemsScreen } from './SupplierItemsScreen';
import { SupplierOrderScreen } from './SupplierOrderScreen';
import { SupplierPicker } from './SupplierPicker';
import { LATCH_GRACE_MS, PendingLatchProvider, latchCanLook, pendingNow, usePendingLatch } from './pendingLatch';
import { LONG_MS } from './useClearQuantities';
import { carriedTrip, carryTrip, forgetTrip } from './cardTrip';
import type { TripPlace } from './cardTrip';
import {
  ADD_DOOR, CLEAR_OPENER, HandBackProvider, SEARCH_BOX, SUPPLIER_DOOR, SUPPLIER_TITLE, cardDoor, HISTORY_DOOR, INCOMING_DOOR, ITEMS_DOOR, LISTS_DOOR, PLACE_ALL_OPENER, PLACE_DOOR, REORDER_DOOR, SEND_OPENER,
  SETTINGS_OPENER, SUPPLIER_ORDER_DOOR, SWAP_OPENER, arrivalOpener, correctOpener, itemsOpener, listOpener, pendingFallback, pendingOpener, sendDayOpener, supplierOpener,
  useHandBackState,
} from './handBack';
import { FROM_LIST, cameFromList, replacedState } from './ordersNav';
import {
  CLEAR_PATH, HISTORY_PATH, INCOMING_PATH, INGREDIENTS_PATH, LISTS_PATH, ORDERS_PATH, PLACE_ALL_PATH, REORDER_PATH, SEND_PATH, SETTINGS_PATH, SUPPLIER_ORDER_PATH, historyDayPath, historyEditPath,
  incomingMissingPath, parseOrdersPath, requestPath, supplierConfirmPath, supplierItemsPath, supplierPath,
} from './ordersPath';
import type { OrdersView } from './ordersPath';
import { buildOrdersLens } from './ordersLens';
import { useListCopy } from './useListCopy';
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
// The wait on the list copy is said at every tap and taken away the moment it stops being true: this only bounds a wait that
// never ends (an offline device whose draft is not on it). A dimmed row goes on telling it, and the next tap says it again.
const WAIT_MS = 60_000;

function StatusLine() {
  const { t } = useT();
  const snapshot = useOrders();
  const lost = [
    snapshot.draftBroken ? t('ord.live.draft') : '',
    snapshot.suppliersBroken ? t('ord.live.suppliers') : '',
    snapshot.ingredientsBroken ? t('ord.live.ingredients') : '',
    snapshot.historyBroken ? t('ord.live.history') : '',
    snapshot.requestsBroken ? t('ord.live.lists') : '',
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
  const location = useLocation();
  const { pathname, state } = location;
  const navigationType = useNavigationType();
  const split = useMediaQuery(SPLIT_QUERY);
  const { canManage, location: venue } = useSession();
  // ⚠️ WHICH VIEW THE LIST COLUMN IS: «by supplier» or the flat view, whichever the person was on last at the list's level. On a phone a
  // screen opened from the flat view (History, the send screen, the settings) hides the column behind it, so the flat view must stay the
  // one mounted there: its search text and its place are still there on Back. On the split a screen opened from it sits beside the
  // supplier list instead (the flat view takes the whole width, so it has no room for a pane next to it).
  const [lastList, setLastList] = useState<'suppliers' | 'ingredients'>(view.kind === 'ingredients' ? 'ingredients' : 'suppliers');
  if (view.kind === 'list' && lastList !== 'suppliers') setLastList('suppliers');
  if (view.kind === 'ingredients' && lastList !== 'ingredients') setLastList('ingredients');
  const flatColumn = view.kind === 'ingredients' || (!split && lastList === 'ingredients' && view.kind !== 'list');
  // The two views of the list's level: a screen opens one level down from either.
  const atList = view.kind === 'list' || view.kind === 'ingredients';
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

  // ⚠️ WHAT THE LIST DRAWS BEFORE `ready` (`earlyLens`): THE LOCAL COPY OF THE LAST GOOD LISTS (useListCopy.ts). On the lab tablet
  // the live lists take seconds, and the copy fills that gap. It is a SECOND lens, never `lens`: the notices, the bell, «Order
  // today», the debt doors, the pending latch and every supplier screen read the live one, so none of them can act on an old list.
  // «On the copy» means `earlyLens !== null`; with it null the section behaves exactly as before the copy existed.
  //  - ONCE SUPPLIERS AND INGREDIENTS HAVE LANDED (only the draft is pending) the rows are the LIVE lens, so a supplier deleted
  //    meanwhile does not linger.
  //  - NOT ONCE A STREAM FAILED: no live list will ever replace an old one that looks real, so the copy leaves the screen at once,
  //    even while the other streams are still on their way, and the status line tells what happened.
  //  - NOT WHEN IT HAS NO SUPPLIER: an empty result paints nothing, so «No suppliers yet» never flashes.
  //  - NOT BEFORE THE FIRST WORD ABOUT `config/orders`: the venue's supplier order and favourites live there, not in the copy, and rows
  //    that reorder a second after they appear make a finger land on the wrong supplier (measured). The store starts that listener
  //    first. Any word will do (`configAnswered`): a venue with no such document must not wait for the server, offline least of all.
  //  - A SUPPLIER TAPPED ON THE COPY IS HELD, NOT OPENED (openOrHold below): the address does not change, so no quantity box,
  //    items list or settings page can appear from an old list, and the supplier opens by itself once everything is live. (A screen
  //    opened BY ITS ADDRESS, a reload on a supplier's page, still waits behind `Detail`'s `ready` gate.) The doors that open
  //    anything else are shut on the copy (whenLive): a tap only says the wait.
  const copy = useListCopy();
  const draftBroken = snapshot.draftBroken;
  const earlyLens = useMemo(() => {
    if (copy === null || ready || !snapshot.configAnswered || snapshot.suppliersBroken || snapshot.ingredientsBroken || draftBroken) return null;
    const early = snapshot.suppliersLoaded && snapshot.ingredientsLoaded ? lens : buildOrdersLens({
      suppliers: copy.suppliers,
      suppliersLoaded: true,
      ingredients: copy.ingredients,
      entries: snapshot.draft.entries,
      supplierOrder: snapshot.config.supplierOrder,
      noSupplierName,
    });
    return early.suppliers.length === 0 ? null : early;
  }, [copy, ready, lens, snapshot.configAnswered, snapshot.suppliersLoaded, snapshot.ingredientsLoaded, snapshot.suppliersBroken, snapshot.ingredientsBroken,
    draftBroken, snapshot.draft.entries, snapshot.config.supplierOrder, noSupplierName]);

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

  // ⚠️ THE TRIP TO A CARD (cardTrip.ts): Orders is unmounted while the person is on a card of «Ingredients & suppliers», so the place is
  // kept in a module. Back (a POP) to the very history entry the trip started from takes it; it is forgotten on every mount, taken or not.
  const trip = useRef<TripPlace | null>(
    navigationType === 'POP' && carriedTrip()?.pathname === pathname && carriedTrip()?.key === location.key ? carriedTrip() : null,
  );
  useEffect(() => { forgetTrip(); }, []);
  const cardDoors = {
    // The same question as the Suppliers section's gate, asked on every render so it follows the venue's switch live — except that with no
    // venue document it says no (the safe direction: a door that is not drawn cannot bounce).
    may: mayEditRecords(venue, canManage),
    open: (door: CardDoor) => {
      carryTrip({
        key: location.key,
        pathname,
        target: door.target,
        query: door.flat?.query ?? '',
        only: door.flat?.only ?? null,
        area: scrollArea()?.scrollTop ?? null,
        pane: detail.current?.scrollTop ?? null,
      });
      void navigate(door.address, { state: door.state });
    },
  };

  // A screen opens one level down, so Back steps up to the list. On the split, with one already open beside the list, picking
  // another is lateral and replaces it — and keeps whatever the entry it replaces knew about where Back goes.
  const open = (opener: string, path: string) => {
    handBack.expect(opener);
    if (split && !atList) {
      void navigate(path, { replace: true, state: replacedState(state) });
    } else {
      // On a phone the list is hidden behind the screen: the place in it is written down now, while it is what is on screen.
      if (!split && atList) listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(path, { state: FROM_LIST });
    }
  };
  const openSupplier = (id: string) => { open(supplierOpener(id), supplierPath(id)); };
  const openItems = (id: string) => { open(itemsOpener(id), supplierItemsPath(id)); };
  const openPlaceAll = () => { open(PLACE_ALL_OPENER, PLACE_ALL_PATH); };
  const openClear = () => { open(CLEAR_OPENER, CLEAR_PATH); };
  const openSend = () => { open(SEND_OPENER, SEND_PATH); };
  // ⚠️ THE SWAP IS A MOVE AT THE LIST'S LEVEL, NOT A STEP DOWN: it REPLACES the entry, so Back never walks through the views, and the
  // new view starts at the top (the scroll effect below). The focus goes to the swap button of the view that arrives.
  const swap = () => {
    handBack.expect(SWAP_OPENER);
    void navigate(view.kind === 'ingredients' ? ORDERS_PATH : INGREDIENTS_PATH, { replace: true, state: KEEP_FOCUS });
  };
  // «Placed yesterday» on a pending banner: the supplier's confirm screen, recording under the banner's day without asking whether it
  // was sent (it was: that is what the button says). The list is right behind the screen, so Back and a recorded order both go to it.
  const openPending = (id: string, day: string) => {
    handBack.expect(pendingOpener(id));
    if (split && !atList) {
      // ⚠️ THE CONFIRM SCREEN WALKS BACK TO THE LIST by `toList` after recording; without it the list would be pushed again on top
      // of the one already in the history (review of step 3f-6). The screen it replaces knew how far the list is.
      const kept = replacedState(state);
      const toList = cameFromList(state) ? ('stepsUp' in kept ? kept.stepsUp : 1) : undefined;
      void navigate(supplierConfirmPath(id), { replace: true, state: { ...kept, ...(toList === undefined ? {} : { toList }), pendingDay: day } });
    } else {
      if (!split && atList) listTop.current = scrollArea()?.scrollTop ?? null;
      void navigate(supplierConfirmPath(id), { state: { ...FROM_LIST, toList: 1, pendingDay: day } });
    }
  };
  // ⚠️ ON THE COPY THESE DOORS ARE SHUT: a tap only says the wait, and the address does not change. Nothing they open can be
  // drawn from an old list, and a screen that opened by itself later, long after a tap, would surprise. Off the copy they are
  // today's doors.
  // A count, not a flag: every tap says the wait again, so a door tapped after the message has timed out is never a dead button.
  const [waitTaps, setWaitTaps] = useState(0);
  const whenLive = (action: () => void) => () => {
    if (earlyLens !== null) setWaitTaps(n => n + 1);
    else action();
  };
  const openSettings = whenLive(() => { open(SETTINGS_OPENER, SETTINGS_PATH); });
  // Settings' «Supplier order» door: one level down, so Back is the browser's Back and the door takes the focus again.
  const openSupplierOrder = () => {
    handBack.expect(SUPPLIER_ORDER_DOOR);
    void navigate(SUPPLIER_ORDER_PATH, { state: FROM_LIST });
  };
  const openHistory = whenLive(() => {
    // ⚠️ THE SPLIT KEEPS THIS DOOR ON SCREEN BELOW HISTORY TOO. From its editor or day screen it is one step up, like their Back: a
    // replace would leave History twice in a row, and the next Back would seem to do nothing.
    if ((view.kind === 'history-edit' || view.kind === 'history-day') && cameFromList(state)) {
      handBack.expect(view.kind === 'history-edit' ? correctOpener(view.id) : sendDayOpener(view.date));
      void navigate(-1);
      return;
    }
    // ⚠️ A NEW VISIT STARTS AT THE TOP: the place written down belongs to whichever screen wrote it, Incoming or the order lists too,
    // and Settings no longer stands in between to forget it. Today's orders would open scrolled out of sight.
    historyPlace.current = null;
    open(HISTORY_DOOR, HISTORY_PATH);
  });
  // Back from Incoming and from «To re-order» gives the focus to the list's door (the debt banner opens Incoming the same way).
  const openIncoming = whenLive(() => { open(INCOMING_DOOR, INCOMING_PATH); });
  const openReorder = whenLive(() => { open(REORDER_DOOR, REORDER_PATH); });
  const openLists = whenLive(() => { open(LISTS_DOOR, LISTS_PATH); });
  const openItemsWhenLive = (id: string) => { whenLive(() => { openItems(id); })(); };

  // ⚠️ THE HOLD: a supplier tapped on the copy (a row, an «Order today» chip, the notices panel) waits for the live data and then
  // opens by itself. The path is where the tap happened: if the person moves anywhere else the tap is dropped, and the last supplier
  // tapped wins (a shut door only says the wait and the All/Ordering filter only filters: both leave the hold alone, as in the current
  // app). It is also dropped when a stream fails (nothing will ever make the wait end well), when the notices panel opens and when
  // the search box takes the focus or changes (`onLookingElsewhere`) — and a supplier gone from the live list opens nothing.
  const [held, setHeld] = useState<{ id: string; path: string } | null>(null);
  const openOrHold = (id: string) => {
    if (earlyLens === null) {
      openSupplier(id);
      return;
    }
    setHeld({ id, path: pathname });
    setWaitTaps(n => n + 1);
  };
  const dropHold = () => {
    setHeld(null);
    setWaitTaps(0);
  };
  const streamBroke = snapshot.suppliersBroken || snapshot.ingredientsBroken || draftBroken;
  useEffect(() => {
    if (held === null) return;
    if (pathname !== held.path || streamBroke) {
      dropHold();
      return;
    }
    if (!ready) return;
    dropHold();
    if (lens.supplierById(held.id)) openSupplier(held.id);
  }, [held, pathname, streamBroke, ready, lens]);
  // The wait is said while it is true AND the copy is still on screen (derived, so it cannot be left behind); a move to another
  // address ends it for good.
  useEffect(() => { setWaitTaps(0); }, [pathname]);
  const waiting = waitTaps > 0 && earlyLens !== null;
  // ⚠️ A MESSAGE OVER THE CONTENT, NOT A LINE ABOVE IT: a line that appears on the first tap pushes every row down, so a second
  // tap lands on another supplier; and on a list scrolled down it would be out of sight.
  const waitIsSaid = useRef(false);
  useEffect(() => {
    if (waiting) say(t('ord.copy.wait'), WAIT_MS);
    else if (waitIsSaid.current) say('');
    waitIsSaid.current = waiting;
  }, [waiting, waitTaps, say, t]);

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
  // From the order lists to one list: the same one level down, with the place in the lists written down.
  const openRequest = (id: string) => { openFromHistory(listOpener(id), requestPath(id)); };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so the place is back when the row
  // takes the focus: focusing a row that is in view scrolls nothing.
  //  - On the split the list keeps its place (the right-hand side starts at its own top, below).
  //  - On a phone, Back to the list restores the place written down when a screen opened; any other move starts at the top.
  //  - The first render does nothing: the shell reset the area when the section was entered.
  const shown = useRef<string | null>(null);
  const shownKind = useRef(view.kind);
  useLayoutEffect(() => {
    const before = shown.current;
    const kindBefore = shownKind.current;
    shown.current = pathname;
    shownKind.current = view.kind;
    const area = scrollArea();
    // The same address twice is StrictMode running the effect again, not a move.
    if (before === null || before === pathname || area === null) return;
    if (split) {
      listTop.current = null;
      // The swap between the two views is a new list, not Back to one: it starts at the top.
      if (atList && kindBefore !== view.kind && (kindBefore === 'list' || kindBefore === 'ingredients')) area.scrollTop = 0;
    } else if (atList && listTop.current !== null) {
      area.scrollTop = listTop.current;
      listTop.current = null;
    } else if ((view.kind === 'history' || view.kind === 'incoming' || view.kind === 'lists') && historyPlace.current?.area != null) {
      area.scrollTop = historyPlace.current.area;
    } else {
      area.scrollTop = 0;
    }
  }, [pathname]);

  // Back out of a supplier (its own Back, or the phone's back gesture): the button that opened it takes the focus, once the
  // list is on screen again (on a phone it was hidden behind the supplier, not unmounted).
  useLayoutEffect(() => {
    if (atList) handBack.deliver(pendingFallback);
    // Back from the editor or the day screen to History: the card button or the day's «Send all».
    else if (view.kind === 'history') handBack.deliverWhere(name => name.startsWith('correct:') || name.startsWith('send-day:'));
    // Back from «What arrived?» to Incoming: the row that opened it (gone when the order was answered: the title takes the focus).
    else if (view.kind === 'incoming') handBack.deliverWhere(name => name.startsWith('arrival:'));
    // Back from one order list to the lists: its card (gone when the list was deleted: the title takes the focus).
    else if (view.kind === 'lists') handBack.deliverWhere(name => name.startsWith('list:'));
    // Back from the supplier order to the settings: the door that opened it.
    else if (view.kind === 'settings') handBack.deliverIf(SUPPLIER_ORDER_DOOR);
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
      || view.kind === 'incoming' || view.kind === 'incoming-missing' || view.kind === 'lists' || view.kind === 'request';
    detail.current.scrollTop = view.kind === 'history' || view.kind === 'incoming' || view.kind === 'lists' ? historyPlace.current?.pane ?? 0 : 0;
    // The place is only owed to History while it is the screen in play; leaving it for good forgets it.
    if (!inHistory) historyPlace.current = null;
  }, [pathname]);

  // Back from a card: once the screen is drawn (its data arrives after the section does, and a scroll box cannot be scrolled past
  // content that is not there yet) the scroll goes back and the focus to the door that was pressed; a door that is gone (the ingredient
  // deleted or moved, the gate now off) leaves the focus on the search box or the supplier's title.
  const tripDone = useRef(false);
  useLayoutEffect(() => {
    const place = trip.current;
    if (place === null || tripDone.current || !ready) return;
    tripDone.current = true;
    trip.current = null;
    const area = scrollArea();
    if (area !== null && place.area !== null) area.scrollTop = place.area;
    if (detail.current !== null && place.pane !== null) detail.current.scrollTop = place.pane;
    const door = place.target.kind === 'name' ? cardDoor(place.target.ingredientId) : place.target.kind === 'add' ? ADD_DOOR : SUPPLIER_DOOR;
    if (!handBack.focus(door)) handBack.focus(view.kind === 'ingredients' ? SEARCH_BOX : SUPPLIER_TITLE);
  }, [ready]);

  // ⚠️ WITH THE VENUE'S SWITCH OFF the three delivery addresses do not exist (decision F4): a bookmark, or a phone that was on
  // Incoming when somebody turned it off, goes to the list. Only once config/orders has answered (before that the switch reads on).
  const deliveryAddress = view.kind === 'incoming' || view.kind === 'incoming-missing' || view.kind === 'reorder';
  if (deliveryAddress && snapshot.configLoaded && !snapshot.deliveryCheck.on) {
    return <Navigate to={ORDERS_PATH} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }

  return (
    <HandBackProvider value={handBack}>
      <CardDoorsProvider value={cardDoors}>
      {/* The bell and its panel share one state, kept above the page: the number and what it opens cannot disagree (step 3f-6). */}
      <NoticesProvider lens={lens} ready={ready} onPanelOpen={dropHold}>
      <Page
        title={t('section.orders')}
        // The bell, only where the panel it opens can be seen: the list on a phone, every screen on the split. In a part of its own:
        // a failure in the bell must not take the page down.
        action={view.kind === 'list' || split ? <PartBoundary><NoticesBell /></PartBoundary> : undefined}
      >
        <StatusLine />
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : view.kind === 'ingredients' ? 'ingredients' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              {flatColumn ? (
                <IngredientsList lens={lens} ready={ready} onSwap={swap} onSend={openSend} onSettings={openSettings} onHistory={openHistory} initial={trip.current === null ? undefined : { query: trip.current.query, only: trip.current.only }} />
              ) : (
              <OrdersList
                lens={lens}
                earlyLens={earlyLens}
                ready={ready}
                openId={'id' in view && view.kind !== 'request' ? view.id : null}
                heldId={held?.id ?? null}
                onLookingElsewhere={dropHold}
                onOpenSupplier={openOrHold}
                onOpenItems={openItemsWhenLive}
                onPlaceAll={openPlaceAll}
                onClearAll={openClear}
                onSwap={swap}
                onSend={openSend}
                onSettings={openSettings}
                onHistory={openHistory}
                onIncoming={openIncoming}
                onReorder={openReorder}
                onLists={openLists}
                onOpenPending={openPending}
              />
              )}
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <Detail view={view} lens={lens} ready={ready} onOpenSupplierOrder={openSupplierOrder} onOpenEdit={openEdit} onOpenDay={openDay} onOpenMissing={openMissing} onOpenRequest={openRequest} />
            </PartBoundary>
          </div>
        </div>
      </Page>
      </NoticesProvider>
      </CardDoorsProvider>
    </HandBackProvider>
  );
}

// The right-hand side of the split — and, on a phone, the whole screen when a supplier is open. With nothing chosen it says
// what to do.
//
// (No `key` on the screens: the section keeps one from one supplier to the next on the split, so the focus stays on the row
// that was pressed.)
function Detail({ view, lens, ready, onOpenSupplierOrder, onOpenEdit, onOpenDay, onOpenMissing, onOpenRequest }: {
  view: ShownView;
  lens: ReturnType<typeof buildOrdersLens>;
  ready: boolean;
  onOpenSupplierOrder: () => void;
  onOpenRequest: (id: string) => void;
  onOpenEdit: (id: string) => void;
  onOpenDay: (date: string) => void;
  onOpenMissing: (id: string) => void;
}) {
  const { t } = useT();
  const { configLoaded } = useOrders();
  // The flat view takes the whole width: there is no pane beside it.
  if (view.kind === 'ingredients') return null;
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
  // ⚠️ THE LISTS STAY MOUNTED UNDER ONE LIST (hidden, not drawn), like History under its editor: Back finds the old lists that were
  // asked for as they were left. The lists need only their own stream; one list also reads the lens (names, units), so it waits.
  if (view.kind === 'lists' || view.kind === 'request') {
    return (
      <>
        <OrderListsScreen hidden={view.kind !== 'lists'} onOpen={onOpenRequest} />
        {view.kind !== 'request' ? null : ready
          ? <OrderListScreen key={view.id} id={view.id} lens={lens} />
          : <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>}
      </>
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
  if (view.kind === 'settings') return <SettingsScreen onOpenSupplierOrder={onOpenSupplierOrder} />;
  if (view.kind === 'supplier-order') return <SupplierSequenceScreen />;
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
