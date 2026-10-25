import { useEffect, useId, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { isValidOrderClientId } from '@mise/shared/client-order-model';
import type { Client } from '@mise/shared/calculator-config';
import { countryOf } from '@mise/shared/market';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { useSendSheet } from '../ui/SendSheet';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { useClientOrders, useClientOrdersStore } from './CalculatorContext';
import { orderingLinkFor } from './clientOrdersSource';
import { copyToClipboard } from './clipboard';
import styles from './ClientOrdering.module.css';

// A client's ordering link, on the client's screen (a port of `orderingLinkField` in js/calculator-settings.js): one
// link per client, which they open to type their order straight into the app.
//
// ⚠️ EVERY BUTTON HERE ACTS ON THE DATABASE AT ONCE, unlike the rest of the Clients editor, which works on a copy: a link
// is an account and a permission, not a field, and there is no honest way to «un-save» one by tapping Back. That is why
// the group refuses to do anything while the editor holds unsaved changes — the link publishes the products AS SAVED, so
// minting one from an edited client would send a customer a list the bakery has not agreed to yet.
//
// ⚠️ «COULD NOT READ» IS NOT «NO LINK»: when the links could not be read there is no Create button (it would mint a
// second account for a client whose link works, and cut it off).
//
// ⚠️ THE WHOLE GROUP IS FOR THOSE WHO CAN MANAGE (firestore.rules gates the account on canManage, so a manager can too) —
// minting, replacing and turning off, and since the audit of 25 Oct 2026 copying and sending as well, and even READING the
// links: the link's secret is the ordering account's password, so the rules let only the people who mint and revoke links
// read them, and an employee who copied one kept a way to order as that client after leaving. Anybody else is never made
// to ask (no refused read) and gets one sentence that names who looks after the link, promising neither answer.
export function OrderingLink({ client, dirty }: { client: Client; dirty: boolean }) {
  const { t } = useT();
  const session = useSession();
  const store = useClientOrdersStore();
  const { accounts, accountsState } = useClientOrders();
  const [alert, alertDialog] = useAlert();
  const [confirm, confirmDialog] = useConfirm();
  const [send, sendSheet] = useSendSheet();
  const [working, setWorking] = useState(false);
  const labelId = useId();

  // The links are read when the client's screen opens, and again when the editor's save completes, so a client that was
  // just saved is known to the store's list.
  const canManage = session.canManage;
  const wasDirty = useRef(dirty);
  useEffect(() => { if (canManage) void store.loadAccounts(); }, [store, canManage]);
  useEffect(() => {
    if (canManage && wasDirty.current && !dirty) void store.loadAccounts();
    wasDirty.current = dirty;
  }, [dirty, store, canManage]);

  const name = client.name.trim() === '' ? t('calc.unnamedClient') : client.name;
  const account = accounts[client.id];
  const canOrder = isValidOrderClientId(client.id);
  const link = account?.linkToken && session.locationId
    ? orderingLinkFor(account.linkToken, session.locationId, window.location.href)
    : '';

  // ⚠️ THE CLIPBOARD IS RACED AGAINST A CLOCK (clipboard.ts): whatever happens this ends with the link on screen —
  // copied if the clipboard took it, spelled out (and selectable) if it did not.
  async function copy(text: string) {
    const copied = await copyToClipboard(text);
    await alert({
      message: copied
        ? t('calc.linkCopiedFor', { client: name })
        : t('calc.copyThisLinkFor', { client: name, link: text }).split('\n\n'),
      okLabel: t('common.ok'),
    });
  }

  async function create() {
    if (working) return;
    // ⚠️ REPLACING IS THE DESTRUCTIVE ONE, and the tap most likely made by mistake — somebody looking for «send it
    // again» finds this first. The old link stops working the moment it is replaced, so it is spelled out.
    if (account && !(await confirm({
      title: t('calc.replaceThisLink'),
      message: t('calc.replaceLinkWarning', { client: name }),
      okLabel: t('ui.replace'),
      cancelLabel: t('common.cancel'),
      danger: true,
    }))) return;
    setWorking(true);
    let created: Awaited<ReturnType<typeof store.createLink>>;
    try {
      created = await store.createLink(client, { name: session.name, country: countryOf(session.location) });
    } catch (error) {
      console.error('Could not create the ordering link:', error);
      setWorking(false);
      await alert({ message: t('calc.couldNotCreateThe'), okLabel: t('common.ok') });
      return;
    }
    setWorking(false);
    if (session.locationId) await copy(orderingLinkFor(created.token, session.locationId, window.location.href));
  }

  async function turnOff() {
    if (working) return;
    if (!(await confirm({
      title: t('calc.stopClientOrdering', { client: name }),
      okLabel: t('calc.turnOff'),
      cancelLabel: t('common.cancel'),
      danger: true,
    }))) return;
    setWorking(true);
    try {
      await store.revokeLink(client.id);
    } catch (error) {
      console.error('Could not revoke the ordering link:', error);
      await alert({ message: t('calc.couldNotTurnIt'), okLabel: t('common.ok') });
    } finally {
      setWorking(false);
    }
  }

  function body() {
    if (!canManage) return <p className={styles.hint}>{t('calc.orderingLinkManagersOnly')}</p>;
    // A link publishes the products AS SAVED.
    if (dirty) return <p className={styles.hint}>{t('calc.saveYourChangesFirst')}</p>;
    if (accountsState === 'failed') return <p className={styles.hint}>{t('calc.orderingLink.failed')}</p>;
    if (accountsState !== 'ready') return <p className={styles.hint}>{t('calc.loading')}</p>;
    return (
      <>
        <p className={styles.hint}>
          {account
            ? t('calc.clientCanSendOrders', { client: name })
            : !canOrder ? t('calc.thisClientCannotHave') : t('calc.createALinkAnd')}
        </p>
        <div className={styles.actions}>
          {link ? (
            <>
              <Button onPress={() => { void copy(link); }}>{t('calc.copyLink')}</Button>
              <Button
                onPress={() => {
                  send({
                    subject: name,
                    // ⚠️ THE VENUE'S OWN NAME, NEVER THE PRODUCT'S: this goes to a customer's customer.
                    text: t('calc.shareText', { client: name, from: session.name || t('calc.us'), link }),
                  });
                }}
              >
                <Send aria-hidden="true" />
                {t('ui.send')}
              </Button>
            </>
          ) : null}
          {canOrder ? (
            <Button isDisabled={working} onPress={() => { void create(); }}>
              {account ? t('calc.replaceWithANew') : t('calc.createOrderingLink')}
            </Button>
          ) : null}
        </div>
        {account ? (
          <Button variant="quiet" className={styles.turnOff} isDisabled={working} onPress={() => { void turnOff(); }}>
            {t('calc.turnOffOrdering')}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div role="group" aria-labelledby={labelId} className={styles.field}>
      <h3 id={labelId} className={styles.label}>{t('calc.orderingLink')}</h3>
      {body()}
      {alertDialog}
      {confirmDialog}
      {sendSheet}
    </div>
  );
}
