import { useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Navigate } from 'react-router';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { useCalculator } from './CalculatorContext';
import { useLeave } from './calculatorNav';
import { whatsappDirectPath, whatsappEntryPath, whatsappListPath, whatsappPath } from './calculatorPath';
import { SettingsPage } from './SettingsPage';
import { useWhatsappEditor } from './whatsappEditorContext';
import { linesOf, pickerGroups, targetClient, tryAddFreeLine, withProduct } from './whatsappModel';
import type { PickerRow } from './whatsappModel';
import styles from './WhatsappEditor.module.css';

// «Add to the message» (Level 3). Three ways in, in the order somebody looks for them: this client's own products first,
// then everything else in the address book, and last a box for a name that is in neither — the escape hatch that makes
// the WhatsApp side independent of the Clients screen. Choosing or adding steps back to the client's lines.
//
// ⚠️ THE TYPING BOX IS LAST ON PURPOSE. At the top it would be the first thing reached, and half the free lines would be
// hand-typed copies of products that were already there two rows below — two rows in one message for the same thing.
export function WhatsappPicker({ clientId }: { clientId: string | null }) {
  const { t } = useT();
  const editor = useWhatsappEditor();
  const { config } = useCalculator();
  const { working } = editor;
  const linesPath = working.group === 'direct' ? whatsappDirectPath(working.item.id) : whatsappEntryPath(working.item.id, clientId ?? '');
  const leave = useLeave(linesPath);
  const inputId = useId();
  const warningId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const [warning, setWarning] = useState('');

  const lines = linesOf(working, clientId);
  if (lines === undefined) {
    return <Navigate to={working.group === 'list' ? whatsappListPath(working.item.id) : whatsappPath} replace state={KEEP_FOCUS} />;
  }

  // A direct client is a typed name with no address-book entry: it has no products «of its own».
  const client = working.group === 'direct' ? null : targetClient(config, clientId);
  const { own, others, total } = pickerGroups(config, client, lines);

  function pick(row: PickerRow) {
    editor.editLines(clientId, known => withProduct(known, row.id));
    leave();
  }

  function addTyped() {
    if (lines === undefined) return;
    const result = tryAddFreeLine(config, lines, typed);
    if (result.kind === 'blank') {
      input.current?.focus();
      return;
    }
    // Said out loud: silently ignoring the tap would read as a broken button.
    if (result.kind === 'duplicate') {
      setWarning(t('calc.alreadyInMessage', { name: result.name }));
      return;
    }
    editor.editLines(clientId, () => result.lines);
    leave();
  }

  const group = (heading: string, rows: readonly PickerRow[], help?: string) => (
    <section className={styles.section}>
      <h3 className={styles.label}>{heading}</h3>
      {help === undefined ? null : <p className={styles.help}>{help}</p>}
      {rows.map(row => (
        <Button key={row.id} variant="bare" className={styles.pick} onPress={() => { pick(row); }}>
          <span className={styles.pickName}>{row.name}</span>
          <Plus aria-hidden="true" className={styles.plus} />
        </Button>
      ))}
    </section>
  );

  return (
    <SettingsPage title={t('calc.addToTheMessage')} fallback={linesPath}>
      <div className={styles.form}>
        {own.length > 0
          ? group(client ? t('calc.clientsProducts', { name: client.name }) : t('calc.itsProducts'), own)
          : null}
        {others.length > 0
          ? group(own.length > 0 ? t('calc.otherProducts') : t('calc.productsHeading'), others, t('calc.otherProducts.help'))
          : null}
        {own.length === 0 && others.length === 0 ? (
          <p className={styles.hint}>{total > 0 ? t('calc.everythingInTheAddress') : t('calc.noProductsInThe')}</p>
        ) : null}

        <section className={styles.section} aria-labelledby={`${inputId}-title`}>
          <h3 id={`${inputId}-title`} className={styles.label}>{t('calc.notInTheAddress')}</h3>
          <p className={styles.help}>{t('calc.typeItHere.help')}</p>
          <input
            ref={input}
            id={inputId}
            type="text"
            className={styles.input}
            value={typed}
            placeholder={t('calc.eGLoavesOf')}
            autoComplete="off"
            aria-label={t('calc.addALineBy')}
            aria-describedby={warningId}
            onChange={event => { setTyped(event.target.value); setWarning(''); }}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addTyped();
            }}
          />
          {/* A live region that exists before it speaks (rendered empty first). */}
          <p id={warningId} role="status" className={styles.warning}>{warning}</p>
          <Button className={styles.add} onPress={addTyped}>{t('calc.addThisLine')}</Button>
        </section>
      </div>
    </SettingsPage>
  );
}
