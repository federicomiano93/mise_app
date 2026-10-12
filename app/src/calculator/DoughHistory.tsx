import { useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { Log } from '@mise/shared/log-model';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { FROM_PARENT, cameFromParent } from './calculatorNav';
import { logViewPath, newLogPath } from './calculatorPath';
import type { DrawnLogView } from './calculatorPath';
import {
  ADD_LOG_OPENER, DOUGH_HISTORY_OPENER, HandBackProvider, isListOpener, logOpener, useHandBack,
} from './handBack';
import { LogDraft } from './LogDraft';
import { LogList } from './LogList';
import { LogOne } from './LogOne';
import { LogHistory, LogVersionScreen } from './LogHistoryScreens';
import styles from './DoughHistory.module.css';

// The Dough history: the list of logs and, beside it from 1000px, the log that is open (one log, its history, one
// version of it; later Add and Edit). On a phone one level at a time: the list, and over it whatever it opened.
//
// ⚠️ THIS SCREEN OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx, architecture rule 9), because
// the list and the log are separate addresses: the shell's reset to the top at every address would send the list
// back to the top at each log on the split, and bring Back on a phone to the top of a list whose row has the focus.
// The effects below handle every move; entering from the work view is one of them (the shell does not reset for an
// owner), and leaving is the shell's again (an owner that has gone is not an owner).
export function DoughHistory({ view }: { view: DrawnLogView }) {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBack();
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a log opened over it on a phone, until Back restores it.
  const listTop = useRef<number | null>(null);
  const openId = 'id' in view ? view.id : null;
  // ⚠️ THE SCREENS OF A LOG APPEAR BESIDE A LIST THAT STAYS MOUNTED, and the list's buttons are registered: without
  // this, the log that has just opened would hand the focus to the card that opened it. The list asks for its own
  // buttons through the frame's effect below.
  const detailHandBack = useMemo(
    () => ({ ...handBack, deliver: (root?: boolean) => { handBack.deliver(root, name => !isListOpener(name)); } }),
    [handBack],
  );

  // Opening a log (or Add) is one level down, so Back steps up to the list. On the split, with a log already open
  // beside the list, picking another is lateral: it REPLACES the entry, and the focus is owed to the new row only.
  const open = (to: string, opener: string) => {
    if (split && view.kind !== 'list') {
      handBack.forget();
      handBack.expect(DOUGH_HISTORY_OPENER);
      handBack.expect(opener);
      // ⚠️ Back from the log that replaces ONE LOG goes where the replaced one went (the list); from anything
      // deeper (its history, a version) there is nothing behind it that is the list, so Back lands on the list by
      // replacing itself.
      const behindIsList = view.kind === 'one' && cameFromParent(state);
      void navigate(to, { replace: true, state: behindIsList ? FROM_PARENT : KEEP_FOCUS });
      return;
    }
    // On a phone the list is hidden behind what opens, and the page shrinks to it: the place in the list is written
    // down now, while the list is what is on screen.
    if (!split && view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
    handBack.expect(opener);
    void navigate(to, { state: FROM_PARENT });
  };
  const openLog = (log: Log) => { open(logViewPath(log.id), logOpener(log.id)); };
  const addLog = () => { open(newLogPath, ADD_LOG_OPENER); };

  // Where the scroll area goes at every move inside the section.
  //  - Entering from the work view: the top (the shell leaves it alone while this screen owns it).
  //  - On the split the list keeps its place (the right-hand side starts at its own top, below).
  //  - On a phone, Back to the list restores the place written down when a log opened; any other move is a new
  //    screen and starts at the top.
  const shown = useRef<{ pathname: string; kind: DrawnLogView['kind'] } | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { pathname, kind: view.kind };
    const area = scrollArea();
    if (area === null) return;
    if (before === null) {
      area.scrollTop = 0;
      return;
    }
    // The same address twice is StrictMode running the effect again, not a move.
    if (before.pathname === pathname) return;
    if (split) {
      listTop.current = null;
    } else if (view.kind === 'list' && before.kind !== 'list' && listTop.current !== null) {
      area.scrollTop = listTop.current;
      listTop.current = null;
    } else {
      area.scrollTop = 0;
    }
  }, [pathname]);

  // Back to the list (its own Back, or the phone's back gesture): the button that opened the log takes the focus,
  // once the list is on screen again (on a phone it was hidden behind the log, not unmounted).
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver();
  }, [view.kind, handBack]);

  // On the split the right-hand side scrolls on its own (DoughHistory.module.css) and stays mounted from one log to
  // the next: another one starts at its top instead of where the last was left. On a phone this is a no-op.
  const detail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [pathname]);

  return (
    <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : 'detail'}>
      <div className={styles.list}>
        <PartBoundary>
          <LogList openId={openId} onOpen={openLog} onAdd={addLog} />
        </PartBoundary>
      </div>
      <div ref={detail} className={styles.detail}>
        <HandBackProvider value={detailHandBack}>
          <PartBoundary resetKey={pathname}>
            <LogDetail view={view} />
          </PartBoundary>
        </HandBackProvider>
      </div>
    </div>
  );
}

// The right-hand side of the split — and, on a phone, the whole screen when a log is open. With nothing open it says
// what to do (a phone never draws this: the list is the screen).
function LogDetail({ view }: { view: DrawnLogView }) {
  const { t } = useT();
  switch (view.kind) {
    case 'list':
      return (
        <div className={styles.prompt}>
          <p>{t('calc.logPickPrompt')}</p>
        </div>
      );
    case 'one':
      return <LogOne id={view.id} />;
    case 'history':
      return <LogHistory id={view.id} />;
    case 'version':
      return <LogVersionScreen id={view.id} n={view.n} />;
    case 'new':
    case 'edit':
      return <LogDraft view={view} />;
  }
}
