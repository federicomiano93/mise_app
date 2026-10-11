import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { provingDayFor } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { DayPanel } from './DayPanel';
import { DaysNav } from './DaysNav';
import { PastriesProvider, usePastriesStore } from './PastriesContext';
import { EditorSoon, RecordsSoon } from './PastriesSoon';
import { messageText } from './pastriesMessages';
import { parsePastriesPath } from './pastriesPath';
import type { PastriesView } from './pastriesPath';
import { PANEL_ID, PASTRIES_PATH, dayPath } from './weekdays';
import styles from './PastriesSection.module.css';

type ShownView = Exclude<PastriesView, { kind: 'unknown' }>;

// Pastries: the seven days (a strip above the day on a phone, a list on its left from 1000px) and
// the chosen day. Loaded only when somebody opens it (shell/sectionScreens.ts), and only for a
// person the venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: PastriesProvider starts the seven-day
// listener and tonight's confirmations on mount and stops them on unmount (P14).
export default function PastriesSection() {
  // ⚠️ THE OPENING DAY IS WORKED OUT ONCE, WHEN PASTRIES OPENS, and kept while it stays open.
  // Recomputed on a redraw it would let the marked day jump under somebody's finger at 4am — the
  // one minute of the day they are most likely to be looking at it.
  const [opening] = useState(() => provingDayFor(Date.now()));

  return (
    <PastriesProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <PastriesScreen opening={opening} />
      </StatusMessageProvider>
    </PastriesProvider>
  );
}

// What the store reports (a refused save, a broken stream) goes to the status message.
function StoreMessages() {
  const { t } = useT();
  const store = usePastriesStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => say(messageText(t, message))), [store, say, t]);
  return null;
}

function PastriesScreen({ opening }: { opening: Weekday }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const view = parsePastriesPath(useParams()['*']);

  // A day that is not a weekday, or an address that leads nowhere: back to the start of Pastries.
  if (view.kind === 'unknown') return <Navigate to={PASTRIES_PATH} replace state={KEEP_FOCUS} />;

  const selected = view.kind === 'records' ? null : (view.day ?? opening);

  // ⚠️ PICKING A DAY IS LATERAL: it replaces the address, so Back does not walk through every day
  // that was looked at. KEEP_FOCUS: the focus stays on the day that was pressed (see DaysNav).
  const pick = (day: Weekday) => {
    if (day === selected) return;
    void navigate(dayPath(day), { replace: true, state: KEEP_FOCUS });
  };

  return (
    <Page title={t('section.pastries')}>
      <div className={styles.layout} data-view={view.kind}>
        <div className={styles.days}>
          <PartBoundary>
            <DaysNav
              selected={selected}
              opening={opening}
              onPick={pick}
              panelId={view.kind === 'day' ? PANEL_ID : undefined}
            />
          </PartBoundary>
        </div>
        <div className={styles.detail}>
          <PartBoundary resetKey={pathname}>
            <Detail view={view} opening={opening} />
          </PartBoundary>
        </div>
      </div>
    </Page>
  );
}

function Detail({ view, opening }: { view: ShownView; opening: Weekday }) {
  switch (view.kind) {
    case 'day':
      return <DayPanel day={view.day ?? opening} opening={opening} />;
    case 'editor':
      return <EditorSoon day={view.day} />;
    case 'records':
      return <RecordsSoon />;
  }
}
