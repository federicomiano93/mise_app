import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export type AlertOptions = {
  // The sentence, or sentences (one paragraph each). It names the dialog when there is no title.
  message: string | readonly string[];
  okLabel: string;
  title?: string;
};

type Notice = { options: AlertOptions; settle: () => void };

// A notice that must be read before the screen goes on: one paragraph and ONE button, for a
// handler that reads top to bottom (the sibling of useConfirm, which asks a question):
//
//   const [alert, alertDialog] = useAlert();
//   await alert({ message, okLabel });
//
// The second value is the dialog itself and goes in the component's output. The promise settles
// when the notice is dismissed — OK, Escape, a second notice replacing it, or the component going
// away — and carries no answer: there is nothing to decide.
//
// ⚠️ A SEPARATE HOOK AND NOT A useConfirm WITH NO CANCEL, on purpose: a question whose Cancel was
// forgotten would silently become a notice, and nobody could say no to it.
//
// ⚠️ NEVER THE BROWSER'S alert() — it cannot be styled, translated or tested.
export function useAlert(): readonly [(options: AlertOptions) => Promise<void>, ReactNode] {
  const [notice, setNotice] = useState<Notice | null>(null);
  // The same notice, readable at once: the state is only read on the next render.
  const open = useRef<Notice | null>(null);

  const dismiss = useCallback(() => {
    const shown = open.current;
    if (!shown) return;
    open.current = null;
    setNotice(null);
    shown.settle();
  }, []);

  const alert = useCallback((options: AlertOptions) => new Promise<void>(resolve => {
    open.current?.settle();
    const shown: Notice = { options, settle: resolve };
    open.current = shown;
    setNotice(shown);
  }), []);

  useEffect(() => () => {
    open.current?.settle();
    open.current = null;
  }, []);

  const dialog = notice === null ? null : (
    <Dialog
      isOpen
      role="alertdialog"
      title={notice.options.title}
      message={notice.options.message}
      onClose={dismiss}
      actions={<Button key="ok" variant="primary" autoFocus onPress={dismiss}>{notice.options.okLabel}</Button>}
    />
  );

  return [alert, dialog];
}
