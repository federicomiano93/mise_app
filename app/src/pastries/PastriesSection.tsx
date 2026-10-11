import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { provingDayFor } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { DayPanel } from './DayPanel';
import { DaysNav } from './DaysNav';
import { Editor } from './Editor';
import { PastriesProvider, usePastriesStore } from './PastriesContext';
import { messageText } from './pastriesMessages';
import { parsePastriesPath } from './pastriesPath';
import type { PastriesView } from './pastriesPath';
import { Records } from './Records';
import { PANEL_ID, PASTRIES_PATH, dayPath } from './weekdays';
import styles from './PastriesSection.module.css';

type ShownView = Exclude<PastriesView, { kind: 'unknown' }>;

// Pastries: the seven days (a strip above the day on a phone, a list on its left from 1000px) and
// the chosen day, its editor, or Records. Loaded only when somebody opens it (shell/sectionScreens.ts), and only for a
// person the venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: PastriesProvider starts the seven-day
// listener and tonight's confirmations on mount and stops them on unmount (P14).
export default function PastriesSection() {
  // ⚠️ THE OPENING DAY IS WORKED OUT WHEN PASTRIES OPENS, and kept while the app is on screen.
  // Recomputed on a redraw it would let the marked day jump under somebody's finger at 4am — the
  // one minute of the day they are most likely to be looking at it.
  //
  // ⚠️ BUT NOT FOR EVER: Mise 2 never reloads by itself, so a tablet left open on the bench across
  // days would still say «Tomorrow» of the day it was opened on, and `/pastries` would still land
  // there. When the app COMES BACK to the foreground (the screen woken, the tab switched back to)
  // nobody was looking at it a moment ago, so nothing can jump under a finger: the day is worked
  // out again, and it moves only if the work day has rolled over at 4am since. It is the same moment
  // at which the store asks again who is confirmed.
  const [opening, setOpening] = useState(() => provingDayFor(Date.now()));
  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === 'visible') setOpening(provingDayFor(Date.now()));
    };
    document.addEventListener('visibilitychange', onForeground);
    return () => document.removeEventListener('visibilitychange', onForeground);
  }, []);

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
  // Set by the editor and Records when they hand the person back to the day, read once by the day
  // panel that mounts next (it gives the focus back to the pencil).
  const handBackFocus = useRef(false);

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
            <Detail view={view} opening={opening} handBackFocus={handBackFocus} />
          </PartBoundary>
        </div>
      </div>
    </Page>
  );
}

type DetailProps = { view: ShownView; opening: Weekday; handBackFocus: RefObject<boolean> };

function Detail({ view, opening, handBackFocus }: DetailProps) {
  switch (view.kind) {
    case 'day':
      return <DayPanel day={view.day ?? opening} opening={opening} handBackFocus={handBackFocus} />;
    // Keyed on the day: another day's editor is a fresh working copy, never the old one renamed.
    case 'editor':
      return <Editor key={view.day} day={view.day} handBackFocus={handBackFocus} />;
    case 'records':
      return <Records handBackFocus={handBackFocus} />;
  }
}
