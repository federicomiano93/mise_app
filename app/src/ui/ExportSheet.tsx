import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { FileText, Table } from 'lucide-react';
import { exportErrorCode, exportErrorKey, exportFileName } from '@mise/shared/recipe-export';
import type { ExportModel } from '@mise/shared/recipe-export';
import { useT } from '../i18n/useT';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { buildPdfBlob, buildXlsxBlob } from './recipeExport';
import styles from './ExportSheet.module.css';

type Request = { model: ExportModel; totalLabel: string };
type Kind = 'pdf' | 'xlsx';

// «Export as PDF or Excel» for a recipe as the screen shows it (the Calculator's scaled dough, or a Recipe
// catalogue recipe at base or scaled). One dialog that changes its content: the choice, then «Preparing the
// file…», then «File ready» with a Download link. Port of js/export-sheet.js, state for state.
//
//   const [openExport, exportSheet] = useExportSheet();
//   openExport({ model, totalLabel });    // and put exportSheet in the component's output
//
// ⚠️ THE FILE IS NOT SAVED ON THE FIRST TAP, AND THAT IS DELIBERATE. The libraries load on the tap, so by the
// time the file exists the tap's «user activation» may have run out, and a browser then refuses a programmatic
// download or share. A fresh tap on a real <a download> always works, on a new phone and on an old Chrome
// alike. So the dialog makes the file first and asks for one more tap.
// ⚠️ SHARE IS OFFERED FOR THE PDF ONLY. Chrome's Web Share accepts .pdf but has no Office types in its
// allowlist, so an .xlsx can only be downloaded. canShare() is asked with the real file: a browser that cannot
// share it shows no Share button rather than one that fails.
// ⚠️ NOTHING LEAVES THE DEVICE. The recipe is turned into a file in this page; no request is made but the one
// that fetches the library the first time (there is no service worker yet, so that needs a connection).
// ⚠️ A FAILURE IS REPORTED WITH FIXED WORDS ONLY (which file, which stage), never the recipe, its name or the
// error's own message: console.error is what telemetry/errorReport.ts picks up.
//
// Escape, the backdrop and Cancel / Close end it; the focus is trapped inside and goes back to what opened it
// (React Aria's modal).
//
// ⚠️ The model is a COPY taken when Export was tapped. A screen whose data changes under an open sheet calls the
// third value, close(), so the person never downloads numbers the screen no longer shows.
export function useExportSheet(): readonly [(request: Request) => void, ReactNode, () => void] {
  const [request, setRequest] = useState<Request | null>(null);
  const open = useCallback((next: Request) => { setRequest(next); }, []);
  const close = useCallback(() => { setRequest(null); }, []);
  return [open, request === null ? null : <ExportSheet request={request} onClose={close} />, close];
}

// A download that has just been tapped may still be reading the blob: keep the address alive a while.
const REVOKE_DELAY_MS = 30000;

type State =
  | { readonly kind: 'choice' }
  | { readonly kind: 'working' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly url: string; readonly fileName: string; readonly file: File | null };

function ExportSheet({ request, onClose }: { request: Request; onClose: () => void }) {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: 'choice' });
  // Which build the screen is waiting for; a Cancel (or a second build) makes an older answer stale.
  const run = useRef(0);
  const url = useRef<string | null>(null);
  const first = useRef<HTMLElement | null>(null);

  // The first control of each state takes the focus (the dialog itself takes it only when it opens).
  useEffect(() => { first.current?.focus(); }, [state.kind]);

  // ⚠️ THE OWNER CAN UNMOUNT THE SHEET WITHOUT CLOSE (Back, a tab cleared, a recipe deleted elsewhere): a late
  // build must then make no address, and a ready file's address must not live until the page reloads. The page
  // of a dialog that is gone cannot be downloading from it, so the address is freed at once.
  useEffect(() => () => {
    run.current += 1;
    if (url.current !== null) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }
  }, []);

  const close = () => {
    run.current += 1;
    if (url.current !== null) {
      const stale = url.current;
      url.current = null;
      setTimeout(() => { URL.revokeObjectURL(stale); }, REVOKE_DELAY_MS);
    }
    onClose();
  };

  const build = (kind: Kind) => {
    const mine = ++run.current;
    setState({ kind: 'working' });
    // The words for a nameless recipe are read now, in the venue's language, never at module load.
    const fileName = exportFileName(request.model, kind, t('export.fileFallback'));
    const made = kind === 'pdf'
      ? buildPdfBlob(request.model)
      : buildXlsxBlob(request.model, request.totalLabel, t('export.sheetFallback'));
    made.then(blob => {
      if (run.current !== mine) return;
      url.current = URL.createObjectURL(blob);
      setState({ kind: 'ready', url: url.current, fileName, file: shareableFile(kind, blob, fileName) });
    }).catch((error: unknown) => {
      console.error('Recipe export failed:', kind, exportErrorCode(error));
      if (run.current === mine) setState({ kind: 'error', error });
    });
  };

  const cancel = (ref?: Ref<HTMLButtonElement>) => (
    <Button ref={ref} onPress={close}>{t('common.cancel')}</Button>
  );
  const asRef = (node: HTMLElement | null) => { first.current = node; };

  let body: ReactNode = null;
  let actions: ReactNode = null;
  let title = t('export.title');
  if (state.kind === 'choice') {
    body = (
      <div className={styles.kinds}>
        <Button variant="bare" className={styles.kind} ref={asRef} onPress={() => { build('pdf'); }}>
          <FileText aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.name}>{t('export.pdf')}</span>
            <span className={styles.note}>{t('export.pdfNote')}</span>
          </span>
        </Button>
        <Button variant="bare" className={styles.kind} onPress={() => { build('xlsx'); }}>
          <Table aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.name}>{t('export.excel')}</span>
            <span className={styles.note}>{t('export.excelNote')}</span>
          </span>
        </Button>
      </div>
    );
    actions = cancel();
  } else if (state.kind === 'working') {
    body = <Working />;
    actions = cancel(asRef);
  } else if (state.kind === 'error') {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    body = <p role="alert" className={styles.message}>{t(exportErrorKey(state.error, online))}</p>;
    actions = <Button variant="primary" ref={asRef} onPress={close}>{t('export.close')}</Button>;
  } else {
    title = t('export.ready');
    const { fileName, file } = state;
    body = <p className={styles.file}>{fileName}</p>;
    // Three actions do not fit side by side at 296px in Italian, so this state stacks them: the primary Download
    // on top, Share (when there is one) and Close below.
    actions = (
      <div className={styles.stack}>
        {/* A real link, not a click made by script: the browser downloads it on THIS tap. */}
        <a className={styles.download} href={state.url} download={fileName} ref={asRef}>{t('export.download')}</a>
        {file === null ? null : <Button onPress={() => { void shareFile(file, fileName); }}>{t('export.share')}</Button>}
        <Button onPress={close}>{t('export.close')}</Button>
      </div>
    );
  }

  return (
    <Dialog isOpen title={title} dismissable onClose={close} actions={actions}>
      {body}
    </Dialog>
  );
}

// ⚠️ The live region is in the page BEFORE its text is set: a screen reader announces a change to a region it
// already knows, not one that arrives with its words inside.
function Working() {
  const { t } = useT();
  const [text, setText] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setText(t('export.preparing')); }, 0);
    return () => { clearTimeout(timer); };
  }, [t]);
  return <p role="status" className={styles.message}>{text}</p>;
}

// The PDF as a File the browser agrees to share, or null (an .xlsx, or no Web Share for files).
function shareableFile(kind: Kind, blob: Blob, fileName: string): File | null {
  if (kind !== 'pdf') return null;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return null;
    const file = new File([blob], fileName, { type: 'application/pdf' });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

// Closing the phone's share sheet without choosing is not an error, so it says nothing.
async function shareFile(file: File, title: string): Promise<void> {
  try {
    await navigator.share({ files: [file], title });
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name !== 'AbortError') console.warn('export share failed');
  }
}
