import { useEffect, useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Navigate } from 'react-router';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { ClientsSaveButton } from './ClientsSaveButton';
import { useClientsEditor } from './clientsEditorContext';
import { isBlank, isEmptyClient } from './clientsModel';
import { clientsPath } from './calculatorPath';
import { ADD_CLIENT_OPENER, clientOpener, useHandBack } from './handBack';
import { OrderingLink } from './OrderingLink';
import { ProductCard } from './ProductCard';
import { SettingsPage } from './SettingsPage';
import styles from './ClientScreen.module.css';

// One client: its name, the products it orders (each a card), and a way to add one (a port of `renderClientDetail`
// in js/calculator-settings.js). The edits go to the working copy held by ClientsEditor; Save and Back are the
// bar's.
//
// ⚠️ A CLIENT JUST ADDED AND LEFT UNTOUCHED IS NOT KEPT: leaving it (Back, or the browser's) asks «discard this new
// client?» and drops it. An address whose client the working copy does not have goes back to the list.
export function ClientScreen({ clientId }: { clientId: string }) {
  const { t } = useT();
  const editor = useClientsEditor();
  const handBack = useHandBack();
  const nameId = useId();
  const productsId = useId();
  const form = useRef<HTMLDivElement>(null);
  const client = editor.clients.find(known => known.id === clientId);
  // The title is what the client was called when the screen opened: it does not follow every keystroke.
  const [title] = useState(() => (isBlank(client?.name) ? t('calc.newClient') : (client?.name ?? '')));
  const [added, setAdded] = useState<string | null>(null);
  const leaving = useRef(false);

  // Save found a blank name and said so: the focus goes to the first marked field of the client it opened.
  const seenTick = useRef(editor.checkTick);
  useEffect(() => {
    if (editor.checkTick === seenTick.current) return;
    seenTick.current = editor.checkTick;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [editor.checkTick]);

  function dropClient() {
    leaving.current = true;
    editor.removeClient(clientId);
    handBack.expect(ADD_CLIENT_OPENER);
  }

  // The bar's Back. The browser's own Back is the editor's blocker (ClientsEditor).
  async function back() {
    if (leaving.current) return;
    if (editor.freshId === clientId && isEmptyClient(client)) {
      leaving.current = true;
      const discard = await editor.askDiscardNewClient();
      leaving.current = false;
      if (!discard) return;
      dropClient();
    } else {
      leaving.current = true;
      editor.keep();
      handBack.expect(clientOpener(clientId));
    }
    editor.leaveToList();
  }

  async function deleteClient() {
    if (leaving.current) return;
    const ok = await editor.confirm({
      title: t('calc.deleteThisClientAnd'),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    dropClient();
    editor.leaveToList();
  }

  if (!client) return editor.wasDropped(clientId) ? null : <Navigate to={clientsPath} replace state={KEEP_FOCUS} />;

  const products = client.products ?? [];
  const nameInvalid = editor.showErrors && isBlank(client.name);
  const shownName = isBlank(client.name) ? t('calc.unnamedClient') : client.name;

  return (
    <SettingsPage
      title={title}
      fallback={clientsPath}
      onBack={() => { void back(); }}
      action={<ClientsSaveButton />}
    >
      <div ref={form} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>{t('calc.clientName')}</label>
          <div className={styles.nameRow}>
            <input
              id={nameId}
              type="text"
              className={nameInvalid ? `${styles.input} ${styles.invalid}` : styles.input}
              value={client.name}
              placeholder={t('calc.clientName')}
              autoComplete="off"
              aria-invalid={nameInvalid ? true : undefined}
              onChange={event => { editor.rename(clientId, event.target.value); }}
            />
            <Button
              variant="bare"
              className={styles.del}
              aria-label={t('calc.deleteClientNamed', { name: shownName })}
              onPress={() => { void deleteClient(); }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>

        <section className={styles.field} aria-labelledby={productsId}>
          <h3 id={productsId} className={styles.label}>{t('calc.productsOrdered')}</h3>
          {products.map(product => (
            <ProductCard key={product.id} client={client} product={product} autoFocus={added === product.id} />
          ))}
          <Button className={styles.add} onPress={() => { setAdded(editor.addProduct(clientId)); }}>
            {t('calc.addProduct')}
          </Button>
        </section>

        <OrderingLink client={client} dirty={editor.dirty} />
      </div>
    </SettingsPage>
  );
}
