import { ChevronRight } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { getClients } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { useCalculator } from './CalculatorContext';
import { whatsappEntryPath, whatsappListPath, whatsappPath } from './calculatorPath';
import { useHandBack, whatsappEntryOpener } from './handBack';
import { SettingsPage } from './SettingsPage';
import { useWhatsappEditor } from './whatsappEditorContext';
import { clientsToAdd, isBlank } from './whatsappModel';
import styles from './WhatsappEditor.module.css';

// Which address-book client to add to the list (Level 1b). Only clients not already in the list are offered, so a client
// is never in it twice. Picking one adds it, empty, and REPLACES this address with the client's own lines (Level 2), so
// Back from there returns to the list and not to this chooser.
export function WhatsappClientChooser() {
  const { t } = useT();
  const editor = useWhatsappEditor();
  const { config } = useCalculator();
  const navigate = useNavigate();
  const { state } = useLocation();
  const handBack = useHandBack();
  const { working } = editor;

  if (working.group !== 'list') return <Navigate to={whatsappPath} replace state={KEEP_FOCUS} />;
  const list = working.item;
  const book = getClients(config);
  const available = clientsToAdd(list, book);

  function pick(clientId: string) {
    editor.addEntry(clientId);
    handBack.expect(whatsappEntryOpener(clientId));
    void navigate(whatsappEntryPath(list.id, clientId), { replace: true, state });
  }

  return (
    <SettingsPage title={t('calc.addClient2')} fallback={whatsappListPath(list.id)}>
      {book.length === 0 ? <p className={styles.hint}>{t('calc.noClientsYetAdd')}</p> : null}
      {book.length > 0 && available.length === 0 ? <p className={styles.hint}>{t('calc.allClientsAreAlready')}</p> : null}
      {available.length > 0 ? (
        <div className={styles.form}>
          <p className={styles.help}>{t('calc.pickAClientTo')}</p>
          <ul className={styles.rows}>
            {available.map(client => (
              <li key={client.id}>
                <Button variant="bare" className={styles.pick} onPress={() => { pick(client.id); }}>
                  <span className={styles.pickName}>{isBlank(client.name) ? t('calc.unnamedClient') : client.name}</span>
                  <ChevronRight aria-hidden="true" className={styles.plus} />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SettingsPage>
  );
}
