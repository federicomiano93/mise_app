import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigationType } from 'react-router';
import { CalculatorProvider, useCalculator } from '../calculator/CalculatorContext';
import { ClientsEditor } from '../calculator/ClientsEditor';
import { ClientsPathsProvider } from '../calculator/clientsPaths';
import { CutoffEditor } from '../calculator/CutoffEditor';
import { HandBackProvider, useHandBackState } from '../calculator/handBack';
import { OrdersReceived } from '../calculator/OrdersReceived';
import { SettingsPage } from '../calculator/SettingsPage';
import { Empty } from '../calculator/SettingsParts';
import { StoreMessages } from '../calculator/StoreMessages';
import { TabStateProvider } from '../calculator/TabStateContext';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { StatusMessageProvider } from '../ui/StatusMessage';
import { ClientsHub } from './ClientsHub';
import { CLIENTS_PATH, clientsPaths, resolveClientsPath } from './clientsPath';

// The Clients section: the sales owner's page (Titolare vendita, a port of clients.html). That role runs the clients but has
// no Calculator, so this is their one way to the address book, the orders clients sent and the deadline for them.
//
// ⚠️ IT DRAWS THE CALCULATOR'S OWN CLIENT SCREENS, NOT COPIES, over a Calculator store in its «only the address book» mode
// (`clientsOnly`): it watches the configuration alone and saves the clients alone, because the rules refuse this role the
// dough logs, the linked recipes and every other key of config/calculator. So nothing drawn here may call what the store
// still exposes for the others (confirming a dough, writing a log, listing the catalogue, stamping a row) or wait for the
// logs. The client screens do none of it (Orders received is drawn read-only: no «put in the Calculator»), and the specs
// pin that. WhatsApp is not here: its lists are a field the rules refuse this role.
//
// Loaded only for the person the venue shows the section to (SectionRoute): the sales owner and nobody else.
export default function ClientsSection() {
  return (
    <CalculatorProvider clientsOnly>
      <ClientsPathsProvider value={clientsPaths}>
        <TabStateProvider>
          <StatusMessageProvider>
            <StoreMessages />
            <ClientsScreen />
          </StatusMessageProvider>
        </TabStateProvider>
      </ClientsPathsProvider>
    </CalculatorProvider>
  );
}

function ClientsScreen() {
  const { t } = useT();
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBackState();
  // The address as it is written, not React Router's «*»: a client id is split before it is decoded.
  const resolved = resolveClientsPath(pathname.slice(CLIENTS_PATH.length));

  // ⚠️ THE REDIRECT KEEPS THE MEANING OF THE MOVE THAT CAUSED IT (see CalculatorSection): on a POP the app is arranging
  // itself, so KEEP_FOCUS; on any other move the state of the address being replaced is passed on.
  if ('redirect' in resolved) {
    return <Navigate to={resolved.redirect} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }

  return (
    <HandBackProvider value={handBack}>
      <Page title={t('section.clients')}>
        {'list' in resolved ? (
          <PartBoundary resetKey={pathname}>
            <ConfigGate>
              <ClientsEditor target={resolved.list} />
            </ConfigGate>
          </PartBoundary>
        ) : 'orders' in resolved ? (
          <PartBoundary resetKey="orders">
            <OrdersReceived view={resolved.orders} readOnly />
          </PartBoundary>
        ) : 'ordering' in resolved ? (
          <PartBoundary resetKey="ordering">
            <CutoffEditor />
          </PartBoundary>
        ) : (
          <PartBoundary resetKey="hub">
            <ClientsHub />
          </PartBoundary>
        )}
      </Page>
    </HandBackProvider>
  );
}

// ⚠️ THE ADDRESS BOOK OPENS ONLY ON A DOCUMENT THE SERVER HAS ANSWERED AND THAT A CLIENTS-ONLY SAVE CAN TAKE. The editor copies
// the clients once, when it opens, so it must not be made from the empty default or from this phone's yesterday's copy; and a
// venue with no Calculator document (or one still in an old shape) cannot be saved to by this role, so the editor is not
// opened at all — the door is disabled for the same reason (ClientsHub), and this is the same answer for an address
// typed by hand.
function ConfigGate({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { configFromServer, configFailed, configShape } = useCalculator();
  if (configFromServer && configShape === 'ready') return children;
  const waiting = configFromServer && (configShape === 'missing' || configShape === 'retired');
  return (
    <SettingsPage title={t('ui.clients')} fallback={CLIENTS_PATH}>
      <Empty>{waiting ? t('clients.noConfigYet') : configFailed ? t('clients.couldNotLoad') : t('calc.loading')}</Empty>
    </SettingsPage>
  );
}
