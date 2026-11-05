import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export type ConfirmOptions = {
  title: string;
  // One paragraph each.
  message?: string | readonly string[];
  // More than paragraphs, drawn under the message: a list of what is about to change.
  body?: ReactNode;
  okLabel: string;
  cancelLabel: string;
  // Throwing something away: the OK button is drawn as a danger button.
  danger?: boolean;
};

type Question = { options: ConfirmOptions; settle: (answer: boolean) => void };

// A question that waits for an answer, for a handler that reads top to bottom:
//
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm({ title, message, okLabel, cancelLabel }))) return;
//
// The second value is the dialog itself and goes in the component's output, next to whatever
// the person pressed, so cancelling gives the focus back to it. Cancel, Escape and a component
// that goes away while the question is open all answer «no»; so does a second question asked
// while one is still open. The page behind the dialog is not dismissable by pressing outside it
// (Dialog.tsx): a question that needs an answer is never thrown away by a stray tap.
//
// ⚠️ NEVER THE BROWSER'S confirm() — it cannot be styled, translated or tested.
export function useConfirm(): readonly [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [question, setQuestion] = useState<Question | null>(null);
  // The same question, readable at once: the state is only read on the next render.
  const open = useRef<Question | null>(null);

  const answer = useCallback((value: boolean) => {
    const asked = open.current;
    if (!asked) return;
    open.current = null;
    setQuestion(null);
    asked.settle(value);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    open.current?.settle(false);
    const asked: Question = { options, settle: resolve };
    open.current = asked;
    setQuestion(asked);
  }), []);

  useEffect(() => () => {
    open.current?.settle(false);
    open.current = null;
  }, []);

  const dialog = question === null ? null : (
    <Dialog
      isOpen
      role="alertdialog"
      title={question.options.title}
      message={question.options.message}
      onClose={() => answer(false)}
      actions={
        <>
          {/* The safe choice takes the focus, as in the sign-out question. */}
          <Button key="cancel" autoFocus onPress={() => answer(false)}>{question.options.cancelLabel}</Button>
          <Button
            key="ok"
            variant={question.options.danger ? 'danger' : 'primary'}
            onPress={() => answer(true)}
          >
            {question.options.okLabel}
          </Button>
        </>
      }
    >
      {question.options.body}
    </Dialog>
  );

  return [confirm, dialog];
}
