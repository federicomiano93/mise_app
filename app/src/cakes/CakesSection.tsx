import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { FoodcostProvider, useFoodcostStore } from '../foodcost/FoodcostContext';
import { messageText } from '../foodcost/foodcostMessages';
import { FROM_LIST } from '../foodcost/foodcostNav';
import { HandBackProvider, NEW_OPENER, SETTINGS_OPENER, productOpener, useHandBackState } from '../foodcost/handBack';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { Page } from '../shell/Page';
import { SettingsGear } from '../shell/SettingsGear';
import { useOwnScrollArea } from '../shell/scrollArea';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import type { ParkedCake } from './cakeParking';
import { CakesProvider, useCakesStore } from './CakesContext';
import { CakesDetail } from './CakesDetail';
import { CakesList } from './CakesList';
import { cakesMessageText } from './cakesMessages';
import { CAKES_PATH, cakePath, newCakePath, parseCakesPath, referencePath } from './cakesPath';
import type { CakeStart, CakesView } from './cakesPath';
import styles from './CakesSection.module.css';

// Cakes: the cakes by name, and ONE LEVEL AT A TIME at every width: a cake, a new cake or the settings open over the whole page, and
// Back steps up to the list (his call, 21 Nov 2026 — the editor is the work, it gets all the room). Loaded only when somebody opens it (shell/sectionScreens.ts), and only for a person the venue shows Food cost to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: the two providers start their listeners on mount and stop them on unmount (P14).
// Cakes need the Food cost tables for every figure (a cake is costed as the product it stands for), so Food cost's provider is the
// outer one — and the one that saves a cake, in one batch with its card.
export default function CakesSection() {
  return (
    <FoodcostProvider>
      <CakesProvider>
        <StatusMessageProvider>
          <StoreMessages />
          <CakesScreen />
        </StatusMessageProvider>
      </CakesProvider>
    </FoodcostProvider>
  );
}

// What the stores report (a refused save, a broken stream) goes to the status message.
function StoreMessages() {
  const { t } = useT();
  const foodcost = useFoodcostStore();
  const cakes = useCakesStore();
  const say = useStatusMessage();
  useEffect(() => foodcost.onMessage(message => { say(messageText(t, message)); }), [foodcost, say, t]);
  useEffect(() => cakes.onMessage(message => { say(cakesMessageText(t, message)); }), [cakes, say, t]);
  return null;
}

function CakesScreen() {
  const { pathname } = useLocation();
  // The address as it is written (cakesPath.ts): anything unknown reads as the list.
  const view = parseCakesPath(pathname.slice(CAKES_PATH.length));
  return <CakesLayout view={view} />;
}

function CakesLayout({ view }: { view: CakesView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const handBack = useHandBackState();

  // ⚠️ CAKES OWNS THE SCROLL for the moves inside itself (shell/scrollArea.tsx), as Food cost does: its list and its screens are separate
  // addresses, and the shell's reset to the top at every address would bring Back to the top of the list while the focus went to a
  // row far below. The effects below handle every move.
  const scrollArea = useOwnScrollArea();
  // Where the list was scrolled to when a screen opened over it, until Back restores it.
  const listTop = useRef<number | null>(null);

  // A cake, a new cake or the settings opens one level down, so Back steps up to the list. The list is hidden behind what opens, and
  // the page shrinks to it: the place in the list is written down now.
  const openScreen = (to: string, extra: object = {}) => {
    if (view.kind === 'list') listTop.current = scrollArea()?.scrollTop ?? null;
    void navigate(to, { state: { ...FROM_LIST, ...extra } });
  };
  const openCake = (id: string) => {
    handBack.expect(productOpener(id));
    openScreen(cakePath(id));
  };
  // How the new cake starts (the list's question) travels in the state, so the editor needs no address of its own for it.
  const openNew = (start: CakeStart) => {
    handBack.expect(NEW_OPENER);
    openScreen(newCakePath, { cakeStart: start });
  };
  // «Resume» on an unsaved cake set aside by «Open in Recipes»: its editor opens and takes the copy back (the copy's key rides in the
  // navigation state, which is how a NEW cake, whose address is always /cakes/new, finds its own).
  const resume = (copy: ParkedCake) => {
    handBack.expect(copy.savedId === null ? NEW_OPENER : productOpener(copy.savedId));
    openScreen(copy.savedId === null ? newCakePath : cakePath(copy.savedId), { parkedCake: copy.key });
  };
  const openReference = () => {
    handBack.expect(SETTINGS_OPENER);
    openScreen(referencePath);
  };

  // Where the scroll area goes at every move inside the section. Before the hand-back below, so the place is back when the row's button
  // takes the focus: focusing a row that is in view scrolls nothing.
  //  - Back to the list restores the place written down when a screen opened; any other move is a new screen at the top.
  //  - The first render does nothing: the shell reset the area when the section was entered.
  const shown = useRef<{ place: string; kind: CakesView['kind'] } | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { place: pathname, kind: view.kind };
    const area = scrollArea();
    if (before === null || before.place === pathname || area === null) return;
    if (view.kind === 'list' && before.kind !== 'list' && listTop.current !== null) {
      area.scrollTop = listTop.current;
      listTop.current = null;
    } else {
      area.scrollTop = 0;
    }
  }, [pathname]);

  // Back out of a screen (its own Back, or the phone's back gesture): the button that opened it takes the focus, once the list is on
  // screen again (it was hidden behind the screen, not unmounted).
  useLayoutEffect(() => {
    if (view.kind === 'list') handBack.deliver();
  }, [view.kind, handBack]);

  // The reference grams' settings: the gear beside the title (21 Nov 2026), on the list only; Back from them hands the focus back to it.
  const gearNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);

  return (
    <HandBackProvider value={handBack}>
      <Page
        title={t('section.cakes')}
        gear={view.kind === 'list' ? <SettingsGear ref={gearNode} onPress={openReference} /> : null}
      >
        <div className={styles.layout} data-view={view.kind === 'list' ? 'list' : 'detail'}>
          <div className={styles.list}>
            <PartBoundary>
              <CakesList onOpenCake={openCake} onOpenNew={openNew} onResume={resume} />
            </PartBoundary>
          </div>
          <div className={styles.detail}>
            <PartBoundary resetKey={pathname}>
              <CakesDetail view={view} />
            </PartBoundary>
          </div>
        </div>
      </Page>
    </HandBackProvider>
  );
}
