import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { cameFromList } from './bookingsNav';
import { BOOKINGS_PATH } from './bookingsPath';
import { isPrinterHost } from './printerHost';
import { readPrinterSetting, sendToPrinter, testPage, writePrinterSetting } from './receiptPrinter';
import type { PrintOutcome } from './receiptPrinter';
import { printOutcomeText } from './printWords';
import { reloadPage } from './reloadPage';
import styles from './PrinterScreen.module.css';

// «Stampante scontrini» (bookings step 3, 18 Nov 2026): the receipt printer THIS device prints the booking slips on — the Epson
// FP-81 II RT on the shop's network, reached directly from the tablet (the owner's choice: no computer in between).
//
// Three things, in the order they are needed: the printer's address (saved on this device; the page then loads again, because
// its security policy names the printer only from the next load: csp-plugin.ts); opening the printer once to accept its own
// certificate; and a TEST PAGE, which is step 0 of the bookings plan — it shows at once whether this printer answers a secure
// page, and whether it prints accents, € and bold right.
//
// A setting of this device, not of the venue: every tablet or phone that prints says where the printer is, and accepts its
// certificate, for itself. Any role that takes bookings may set it.
export function PrinterScreen() {
  const { t } = useT();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const { state } = useLocation();
  const ids = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const [stored] = useState(() => readPrinterSetting());
  const [host, setHost] = useState(stored?.host ?? '');
  const [plain, setPlain] = useState(stored?.plain ?? false);
  const [wrong, setWrong] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null);
  const dirty = host.trim() !== (stored?.host ?? '') || plain !== (stored?.plain ?? false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leaving = useRef(false);

  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  // Leaving with an address typed and not saved asks, on every way out (the router's blocker).
  const shouldBlock: BlockerFunction = ({ currentLocation, nextLocation }) =>
    !leaving.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname;
  const blocker = useBlocker(shouldBlock);
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    void confirm({
      title: t('bookings.discard.title'),
      message: t('bookings.printer.discardBody'),
      okLabel: t('ui.discard'),
      cancelLabel: t('common.cancel'),
      danger: true,
    }).then(discard => {
      asking.current = false;
      if (blocker.state !== 'blocked') return;
      if (discard) blocker.proceed(); else blocker.reset();
    });
  }, [blocker, confirm, t]);

  const back = () => {
    if (cameFromList(state)) void navigate(-1);
    else void navigate(BOOKINGS_PATH, { replace: true });
  };

  async function save() {
    const typed = host.trim();
    if (typed !== '' && !isPrinterHost(typed)) {
      setWrong(true);
      document.getElementById(`${ids}-host`)?.focus();
      return;
    }
    setWrong(false);
    const ok = await confirm({
      title: t('bookings.printer.saveQ'),
      message: typed === '' ? t('bookings.printer.saveNone') : t('bookings.printer.saveBody', { host: typed }),
      okLabel: t('ui.save'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    if (!writePrinterSetting(typed === '' ? null : { host: typed, plain })) {
      say(t('bookings.printer.notSaved'), 5000);
      return;
    }
    leaving.current = true;
    // ⚠️ THE PAGE LOADS AGAIN: its security policy names the printer only from a load that finds the address saved.
    reloadPage();
  }

  async function test() {
    if (stored === null || testing) return;
    setTesting(true);
    setOutcome(null);
    const now = new Date();
    const result = await sendToPrinter(stored, testPage({
      title: t('bookings.printer.testTitle'),
      bold: t('bookings.printer.testBold'),
      big: t('bookings.printer.testBig'),
      accents: 'àèéìòù ÀÈÉÌÒÙ € «» ×',
      when: now.toLocaleString(),
    }));
    setOutcome(result);
    setTesting(false);
  }

  return (
    <section className={styles.screen} aria-labelledby={`${ids}-title`}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={back}
        title={t('bookings.printer.title')}
        titleId={`${ids}-title`}
        titleRef={title}
        action={<Button variant="primary" className={styles.save} onPress={() => { void save(); }}>{t('ui.save')}</Button>}
      />
      <div className={styles.body}>
        <p className={styles.intro}>{t('bookings.printer.intro')}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-host`}>{t('bookings.printer.host')}</label>
          <input
            id={`${ids}-host`}
            className={styles.input}
            value={host}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            placeholder="192.168.1.50"
            aria-invalid={wrong ? true : undefined}
            aria-describedby={`${ids}-host-hint${wrong ? ` ${ids}-host-error` : ''}`}
            onChange={event => { setHost(event.currentTarget.value); setWrong(false); }}
          />
          <p id={`${ids}-host-hint`} className={styles.hint}>{t('bookings.printer.hostHint')}</p>
          {wrong ? <p id={`${ids}-host-error`} className={styles.error}>{t('bookings.printer.hostWrong')}</p> : null}
        </div>

        <label className={styles.check}>
          <input type="checkbox" checked={plain} onChange={event => { setPlain(event.currentTarget.checked); }} />
          <span>{t('bookings.printer.plain')}</span>
        </label>

        {stored !== null && !dirty ? (
          <div className={styles.steps}>
            <h3 className={styles.stepsTitle}>{t('bookings.printer.testHeading')}</h3>
            <p className={styles.hint}>{t('bookings.printer.certificate')}</p>
            <a className={styles.open} href={`https://${stored.host}/`} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              <span>{t('bookings.printer.open', { host: stored.host })}</span>
            </a>
            <Button variant="secondary" className={styles.test} isPending={testing} onPress={() => { void test(); }}>
              {t('bookings.printer.test')}
            </Button>
            <p className={styles.outcome} role="status" data-ok={outcome?.ok ? 'true' : outcome === null ? undefined : 'false'}>
              {outcome === null ? '' : outcome.ok ? t('bookings.printer.testOk') : printOutcomeText(t, outcome)}
            </p>
          </div>
        ) : null}
      </div>
      {confirmDialog}
    </section>
  );
}
