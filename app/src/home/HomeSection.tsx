import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { Page } from '../shell/Page';
import { useFocusOnBack } from '../shell/away/useFocusOnBack';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { AwayBand } from './AwayBand';
import { BookingsTodayPart } from './BookingsTodayPart';
import { CalculatorCard } from './CalculatorCard';
import { InstallHint } from './InstallHint';
import { OrdersDuePart } from './OrdersDuePart';
import { TodoCard } from './TodoCard';
import { TodosProvider, useTodosStore } from './TodosContext';
import styles from './HomeSection.module.css';

// The Home (step 3g-1): where the app opens, for everybody who has the venue open. It holds the venue's «Da fare» card and, since
// the Orders redesign of 16 Nov 2026 (item 7), «Ordini da fare» beside it on a tablet (under it on a phone): the suppliers still to
// order today, for somebody the venue shows Orders to. Loaded only when somebody opens it (shell/sectionScreens.ts).
//
// Its data lives exactly as long as it is on screen: TodosProvider starts the to-do listener on mount and stops it on unmount, and the
// orders card its own three (useOrdersDue, inside OrdersDuePart) (P14).
export default function HomeSection() {
  const { t } = useT();
  const { pathname } = useLocation();
  // After «I am back» from the band (which then goes away) the focus goes to the card's «Add», or to its title when Add is absent.
  const armFocus = useFocusOnBack(() => document.getElementById('home-todo-add') ?? document.getElementById('home-todo-title'));
  // ⚠️ THE PAGE IS LAID OUT BY WHETHER THE ORDERS CARD IS DRAWN (review of PR #565): two columns only while it is, so on most days — and
  // always for somebody without Orders — «Da fare» keeps its readable width instead of a half page beside an empty one. The card's
  // data lives in its own part, which reports only this boolean: the Home is not redrawn by every snapshot of it.
  // Since «Bookings» (18 Nov 2026) the right-hand column also holds «Prenotazioni di oggi»: two columns while either card is drawn.
  const [ordersShown, setOrdersShown] = useState(false);
  const [bookingsShown, setBookingsShown] = useState(false);
  const two = ordersShown || bookingsShown;
  // The Home has no address below it: anything typed after /home goes back to the Home, as the other sections send a junk
  // address back to their list (nothing is started for it: the redirect returns before the parts, and their listeners, are drawn).
  if (pathname !== '/home') return <Navigate to="/home" replace />;
  return (
    <Page title={t('section.home')}>
      <TodosProvider>
        <StatusMessageProvider>
          <StoreMessages />
          <div className={styles.column} data-two={two ? 'true' : undefined}>
            <PartBoundary>
              <AwayBand onBack={armFocus} />
            </PartBoundary>
            {/* «Calcolatrice»: one row above the cards, in a part of its own. */}
            <div className={styles.tool}>
              <PartBoundary>
                <CalculatorCard />
              </PartBoundary>
            </div>
            {/* Two columns from the split's width: «Da fare» on the left, «Ordini da fare» on the right; one under the other on a phone.
                Each in a part of its own: one failing must not take the other down. */}
            <div className={styles.cards} data-two={two ? 'true' : undefined}>
              <PartBoundary>
                <TodoCard />
              </PartBoundary>
              {/* The right-hand column: «Ordini da fare», then «Prenotazioni di oggi», each in a part of its own. Never hidden by a flag:
                  a part that failed must still show its box. */}
              <div className={styles.side}>
                <PartBoundary>
                  <OrdersDuePart onShownChange={setOrdersShown} />
                </PartBoundary>
                <PartBoundary>
                  <BookingsTodayPart onShownChange={setBookingsShown} />
                </PartBoundary>
              </div>
            </div>
          </div>
        </StatusMessageProvider>
      </TodosProvider>
      {/* After a join, once: the install guide (staff slice 2). It draws nothing but its question, and guards itself. */}
      <InstallHint />
    </Page>
  );
}

// What the store reports (a refused or failed write) goes to the status message, which sits above the form's
// modal too, so it is seen whichever way the form went.
function StoreMessages() {
  const { t } = useT();
  const store = useTodosStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => {
    say(message.kind === 'no-access' ? t('home.err.noAccess') : t('home.err.notSaved'));
  }), [store, say, t]);
  return null;
}
