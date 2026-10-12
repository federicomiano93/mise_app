import { useEffect, useId, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { getClientById, getProductById } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { useCalculator } from './CalculatorContext';
import { depthOf, fromParentAt } from './calculatorNav';
import { whatsappDirectAddPath, whatsappEntryAddPath, whatsappListPath, whatsappPath } from './calculatorPath';
import { SettingsPage } from './SettingsPage';
import { useWhatsappEditor } from './whatsappEditorContext';
import { isBlank, linesOf, withRenamedLine, withoutFreeLine, withoutProduct } from './whatsappModel';
import { WhatsappSaveButton } from './WhatsappSaveButton';
import styles from './WhatsappEditor.module.css';

// What one client sends (Level 2): the products it orders, picked from the whole address book, and the lines typed by
// hand. It is a client's ENTRY in a list (`clientId` — its name is the address book's, live) or a DIRECT client
// (`clientId` null — a name typed here is its own, so the screen has a field for it).
export function WhatsappLinesScreen({ clientId }: { clientId: string | null }) {
  const { t } = useT();
  const editor = useWhatsappEditor();
  const { config } = useCalculator();
  const navigate = useNavigate();
  const { state } = useLocation();
  const nameId = useId();
  const productsId = useId();
  const handId = useId();
  const form = useRef<HTMLDivElement>(null);
  const { working } = editor;

  // Save found a blank name and said so: the focus goes to the field.
  const seenTick = useRef(editor.checkTick);
  useEffect(() => {
    if (editor.checkTick === seenTick.current) return;
    seenTick.current = editor.checkTick;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [editor.checkTick]);

  const lines = linesOf(working, clientId);
  if (lines === undefined) {
    // A client that is not in the list (an address typed, or removed): back to the list, or the top.
    return <Navigate to={working.group === 'list' ? whatsappListPath(working.item.id) : whatsappPath} replace state={KEEP_FOCUS} />;
  }

  const direct = working.group === 'direct' ? working.item : null;
  const client = clientId === null ? null : getClientById(config, clientId);
  const title = direct
    ? t('calc.editClient')
    : (client ? (isBlank(client.name) ? t('calc.unnamedClient') : client.name) : t('calc.unknownClient'));
  const nameInvalid = direct !== null && editor.showErrors && isBlank(direct.name);

  // A product deleted from the address book since is simply not shown (the configuration prunes it on save).
  const products = lines.products.flatMap(id => {
    const product = getProductById(config, id);
    return product ? [{ id, name: product.name }] : [];
  });

  const addPath = direct ? whatsappDirectAddPath(direct.id) : whatsappEntryAddPath(working.item.id, clientId ?? '');

  return (
    <SettingsPage
      title={title}
      fallback={working.group === 'list' ? whatsappListPath(working.item.id) : whatsappPath}
      onBack={direct ? () => { void editor.leaveItem(); } : undefined}
      action={<WhatsappSaveButton />}
    >
      <div ref={form} className={styles.form}>
        {direct ? (
          <div className={styles.field}>
            <label htmlFor={nameId} className={styles.label}>{t('calc.clientName')}</label>
            <input
              id={nameId}
              type="text"
              className={nameInvalid ? `${styles.input} ${styles.invalid}` : styles.input}
              value={direct.name}
              placeholder={t('calc.clientName')}
              autoComplete="off"
              aria-invalid={nameInvalid ? true : undefined}
              onChange={event => { editor.rename(event.target.value); }}
            />
          </div>
        ) : null}

        <section className={styles.section} aria-labelledby={productsId}>
          <h3 id={productsId} className={styles.label}>{t('calc.productsToSend')}</h3>
          {products.length === 0 ? <p className={styles.hint}>{t('calc.noProductsYetAdd')}</p> : null}
          {products.map(product => (
            <div key={product.id} className={styles.lineRow}>
              <span className={styles.lineName}>{product.name}</span>
              <Button
                variant="bare"
                className={styles.del}
                aria-label={t('calc.removeProductNamed', { name: product.name })}
                onPress={() => { editor.editLines(clientId, known => withoutProduct(known, product.id)); }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button className={styles.add} onPress={() => { void navigate(addPath, { state: fromParentAt(depthOf(state) + 1) }); }}>
            {t('calc.addProduct')}
          </Button>
        </section>

        <section className={styles.section} aria-labelledby={handId}>
          <h3 id={handId} className={styles.label}>{t('calc.addedByHand')}</h3>
          <p className={styles.help}>{t('calc.byHand.help')}</p>
          {lines.extras.map((line, index) => (
            // Keyed by place, not by id: a line just added has none yet, and typing never gives it one.
            <div key={index} className={styles.lineRow}>
              <input
                type="text"
                className={styles.input}
                value={line.name}
                placeholder={t('calc.eGLoavesOf')}
                autoComplete="off"
                aria-label={t('calc.extraLineN', { i: index + 1 })}
                onChange={event => { editor.editLines(clientId, known => withRenamedLine(known, index, event.target.value)); }}
              />
              <Button
                variant="bare"
                className={styles.del}
                aria-label={t('calc.removeLineN', { i: index + 1 })}
                onPress={() => { editor.editLines(clientId, known => withoutFreeLine(known, index)); }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </section>
      </div>
    </SettingsPage>
  );
}
