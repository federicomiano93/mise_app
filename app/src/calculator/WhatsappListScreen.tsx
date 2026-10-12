import { useCallback, useEffect, useId, useRef } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { getClientById } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { useCalculator } from './CalculatorContext';
import { deeperState } from './calculatorNav';
import { whatsappEntryPath, whatsappListAddPath, whatsappPath } from './calculatorPath';
import { useHandBack, whatsappEntryOpener } from './handBack';
import { SettingsPage } from './SettingsPage';
import { useWhatsappEditor } from './whatsappEditorContext';
import { isBlank, lineNames } from './whatsappModel';
import { WhatsappSaveButton } from './WhatsappSaveButton';
import styles from './WhatsappEditor.module.css';

// One list (Level 1): its name, a card per client, and a way to add a client. The edits go to the working copy held by
// WhatsappItemEditor; Save and Back are the bar's.
export function WhatsappListScreen() {
  const { t } = useT();
  const editor = useWhatsappEditor();
  const { config } = useCalculator();
  const navigate = useNavigate();
  const { state } = useLocation();
  const nameId = useId();
  const clientsId = useId();
  const form = useRef<HTMLDivElement>(null);
  const { working } = editor;

  // Save found a blank name and said so: the focus goes to the field.
  const seenTick = useRef(editor.checkTick);
  useEffect(() => {
    if (editor.checkTick === seenTick.current) return;
    seenTick.current = editor.checkTick;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [editor.checkTick]);

  if (working.group !== 'list') return <Navigate to={whatsappPath} replace state={KEEP_FOCUS} />;
  const list = working.item;
  const nameInvalid = editor.showErrors && isBlank(list.title);

  return (
    <SettingsPage
      title={t('calc.editList')}
      fallback={whatsappPath}
      onBack={() => { void editor.leaveItem(); }}
      action={<WhatsappSaveButton />}
    >
      <div ref={form} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>{t('calc.listName')}</label>
          <input
            id={nameId}
            type="text"
            className={nameInvalid ? `${styles.input} ${styles.invalid}` : styles.input}
            value={list.title}
            placeholder={t('calc.listName')}
            autoComplete="off"
            aria-invalid={nameInvalid ? true : undefined}
            onChange={event => { editor.rename(event.target.value); }}
          />
        </div>

        <section className={styles.section} aria-labelledby={clientsId}>
          <h3 id={clientsId} className={styles.label}>{t('calc.clientsInThisList')}</h3>
          {list.clients.length === 0 ? <p className={styles.hint}>{t('calc.addAClientThen')}</p> : (
            <ul className={styles.rows}>
              {list.clients.map(entry => {
                // The name is the address book's, live; a client deleted since reads «Unknown client».
                const client = getClientById(config, entry.clientId);
                const names = lineNames(config, entry);
                return (
                  <EntryCard
                    key={entry.clientId}
                    listId={list.id}
                    clientId={entry.clientId}
                    name={client ? (isBlank(client.name) ? t('calc.unnamedClient') : client.name) : t('calc.unknownClient')}
                    summary={names.length > 0 ? names.join(', ') : t('calc.nothingToSendYet')}
                  />
                );
              })}
            </ul>
          )}
          <Button className={styles.add} onPress={() => { void navigate(whatsappListAddPath(list.id), { state: deeperState(state) }); }}>
            {t('calc.addClient')}
          </Button>
        </section>
      </div>
    </SettingsPage>
  );
}

// A client's card: its name live from the address book, what it sends, a tap target that opens its lines, and a small
// icon that takes it out of the list (after a question).
function EntryCard({ listId, clientId, name, summary }: {
  listId: string; clientId: string; name: string; summary: string;
}) {
  const { t } = useT();
  const editor = useWhatsappEditor();
  const navigate = useNavigate();
  const { state } = useLocation();
  const handBack = useHandBack();
  const opener = whatsappEntryOpener(clientId);
  const register = useCallback((node: HTMLButtonElement | null) => { handBack.register(opener, node); }, [handBack, opener]);

  async function remove() {
    const ok = await editor.confirm({
      title: t('calc.removeThisClientFrom'),
      okLabel: t('ui.remove'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (ok) editor.removeEntry(clientId);
  }

  return (
    <li className={styles.card}>
      <Button
        ref={register}
        variant="bare"
        className={styles.open}
        onPress={() => {
          handBack.expect(opener);
          void navigate(whatsappEntryPath(listId, clientId), { state: deeperState(state) });
        }}
      >
        <span className={styles.text}>
          <span className={styles.name}>{name}</span>
          <span className={styles.sub}>{summary}</span>
        </span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </Button>
      <Button variant="bare" className={styles.del} aria-label={t('calc.removeClientNamed', { name })} onPress={() => { void remove(); }}>
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}
