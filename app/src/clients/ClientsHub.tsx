import { useId, useLayoutEffect } from 'react';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useCalculator } from '../calculator/CalculatorContext';
import { Door } from '../calculator/Door';
import { CLIENTS_OPENER, CLIENT_ORDERS_OPENER, ORDERING_OPENER, useHandBack } from '../calculator/handBack';
import { OrdersBanner } from '../calculator/OrdersBanner';
import { clientsPaths } from './clientsPath';
import styles from './ClientsHub.module.css';

// The Clients page (a port of clients.html): the three doors the sales owner works through, under the line that says
// clients' orders are waiting.
//
// ⚠️ THE CLIENTS DOOR STAYS DISABLED UNTIL THE SERVER HAS ANSWERED, and says why when it will not open: on a fresh phone the
// store holds only the empty default until then, and an address book typed over it and saved would replace the real one. And
// the rules let this role CHANGE the Calculator's document, never START it (or move it out of an old shape): a venue
// that has none yet hears so here, before somebody types an address book that could not be saved.
export function ClientsHub() {
  const { t } = useT();
  const handBack = useHandBack();
  const { configFromServer, configShape, configFailed } = useCalculator();
  const headId = useId();
  // The root of the section: whatever screen was open below it hands the focus to the door that opened it.
  useLayoutEffect(() => { handBack.deliver(true); }, [handBack]);

  const waiting = configFromServer && (configShape === 'missing' || configShape === 'retired');
  const ready = configFromServer && configShape === 'ready';
  // A stream that broke before the server's first answer would leave «Loading…» for ever: say it could not load.
  const clientsSub = waiting
    ? t('clients.noConfigYet')
    : ready ? t('ui.clientsAndTheProducts') : !configFromServer && configFailed ? t('clients.couldNotLoad') : t('calc.loading');

  return (
    <div className={styles.hub}>
      {/* ⚠️ A throw in the banner (a malformed order) must not take the doors down. */}
      <PartBoundary>
        <OrdersBanner />
      </PartBoundary>
      <section className={styles.card} aria-labelledby={headId}>
        <div className={styles.head}>
          <h2 id={headId} className={styles.headTitle}>{t('settings.calc.clients')}</h2>
        </div>
        <Door opener={CLIENTS_OPENER} to={clientsPaths.list} title={t('ui.clients')} sub={clientsSub} disabled={!ready} />
        <Door opener={CLIENT_ORDERS_OPENER} to={clientsPaths.orders} title={t('ui.ordersReceived')} sub={t('clients.received.sub')} />
        <Door opener={ORDERING_OPENER} to={clientsPaths.ordering} title={t('ui.clientOrdering')} sub={t('ui.whenOrdersSentFrom')} />
      </section>
    </div>
  );
}
