import { useCallback, useRef } from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button, DropIndicator, GridList, GridListItem, I18nProvider, useDragAndDrop } from 'react-aria-components';
import { useT } from '../i18n/useT';
import { Button as UiButton } from '../ui/Button';
import { ClientsSaveButton } from './ClientsSaveButton';
import { useClientsEditor } from './clientsEditorContext';
import { FROM_PARENT } from './calculatorNav';
import { SETTINGS_PATH, clientPath } from './calculatorPath';
import { ADD_CLIENT_OPENER, clientOpener, useHandBack } from './handBack';
import { SettingsPage } from './SettingsPage';
import { Help } from './SettingsParts';
import styles from './ClientList.module.css';

// The address book: one row per client, in the order the Calculator uses them. A row opens the client; with two or
// more, each has a handle to drag it (React Aria brings the mouse, the long-press on a touch screen, the keyboard
// and the screen reader). Reordering is an edit of the working copy: it enables Save like any other.
export function ClientList() {
  const { t, lang } = useT();
  const editor = useClientsEditor();
  const navigate = useNavigate();
  const handBack = useHandBack();
  const { clients } = editor;
  const reorderable = clients.length > 1;
  const nameOf = (name: string): string => (name.trim() === '' ? t('calc.unnamedClient') : name);

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: keys => [...keys].map(key => ({
      'text/plain': nameOf(clients.find(client => client.id === key)?.name ?? ''),
    })),
    onReorder: event => {
      editor.reorder(new Set([...event.keys].map(String)), String(event.target.key), event.target.dropPosition);
    },
    renderDropIndicator: target => <DropIndicator target={target} className={styles.indicator} />,
  });

  const openClient = (id: string) => {
    editor.keep();
    handBack.expect(clientOpener(id));
    void navigate(clientPath(id), { state: FROM_PARENT });
  };

  const addClient = () => {
    const id = editor.addClient();
    void navigate(clientPath(id), { state: FROM_PARENT });
  };

  // ⚠️ THE ROWS OF A GridList ARE BUILT AFTER THE FIRST LAYOUT (React Aria collects them in a hidden pass), so the
  // page's own hand-back, which runs in its layout effect, finds no row yet: each row asks for the focus as it
  // appears. The callback of a row is the SAME function every render (a new one would be called with null and never
  // again with the row).
  const rowRefs = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const rowRef = (id: string) => {
    let ref = rowRefs.current.get(id);
    if (!ref) {
      ref = node => {
        handBack.register(clientOpener(id), node);
        if (node) handBack.deliver();
      };
      rowRefs.current.set(id, ref);
    }
    return ref;
  };

  const registerAdd = useCallback((node: HTMLButtonElement | null) => { handBack.register(ADD_CLIENT_OPENER, node); }, [handBack]);

  return (
    <SettingsPage
      title={t('ui.clients')}
      fallback={SETTINGS_PATH}
      onBack={() => { void editor.leaveEditor(); }}
      action={<ClientsSaveButton />}
    >
      {clients.length === 0 ? <Help>{t('calc.noClientsYet')}</Help> : null}
      {clients.length > 0 ? (
        <I18nProvider locale={lang}>
          <GridList
            aria-label={t('calc.clientsOrder')}
            className={styles.list}
            items={clients}
            onAction={key => { openClient(String(key)); }}
            {...(reorderable ? { dragAndDropHooks } : {})}
          >
            {client => (
              <GridListItem
                id={client.id}
                textValue={nameOf(client.name)}
                className={reorderable ? `${styles.row} ${styles.withHandle}` : styles.row}
                ref={rowRef(client.id)}
              >
                {reorderable ? (
                  <Button slot="drag" className={styles.handle} aria-label={t('calc.dragClient', { name: nameOf(client.name) })}>
                    <GripVertical aria-hidden="true" />
                  </Button>
                ) : null}
                <span className={styles.name}>{nameOf(client.name)}</span>
                <ChevronRight aria-hidden="true" className={styles.chevron} />
              </GridListItem>
            )}
          </GridList>
        </I18nProvider>
      ) : null}
      <UiButton ref={registerAdd} className={styles.add} onPress={addClient}>{t('calc.addClient')}</UiButton>
    </SettingsPage>
  );
}
