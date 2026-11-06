import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { Page } from '../shell/Page';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { TodoCard } from './TodoCard';
import { TodosProvider, useTodosStore } from './TodosContext';
import styles from './HomeSection.module.css';

// The Home (step 3g-1): where the app opens, for everybody who has the venue open. Today it holds the
// venue's «Da fare» card; later slices of 3g may add to it. Loaded only when somebody opens it
// (shell/sectionScreens.ts).
//
// Its data lives exactly as long as it is on screen: TodosProvider starts the one listener on mount and
// stops it on unmount (P14).
export default function HomeSection() {
  const { t } = useT();
  const { pathname } = useLocation();
  // The Home has no address below it: anything typed after /home goes back to the Home, as the other sections send a junk
  // address back to their list (nothing is started for it).
  if (pathname !== '/home') return <Navigate to="/home" replace />;
  return (
    <Page title={t('section.home')}>
      <TodosProvider>
        <StatusMessageProvider>
          <StoreMessages />
          <div className={styles.column}>
            <PartBoundary>
              <TodoCard />
            </PartBoundary>
          </div>
        </StatusMessageProvider>
      </TodosProvider>
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
