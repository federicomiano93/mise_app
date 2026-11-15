import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export type SentAnswer = 'yes' | 'sendNow' | 'cancel';

export type SentQuestion = {
  title: string;
  yesLabel: string;
  // Left out where no road puts the order in a supplier's hands: «Send it now» is then not offered at all.
  sendNowLabel?: string;
  cancelLabel: string;
};

type Open = { question: SentQuestion; settle: (answer: SentAnswer) => void };

// «Did you send the order?» with its THREE answers (parity X4): Yes, sent · Send it now · Cancel. The sibling of useConfirm for
// the one question that has a third way out:
//
//   const [askSent, sentDialog] = useSentCheck();
//   const answer = await askSent({ title, yesLabel, sendNowLabel, cancelLabel });
//
// The second value is the dialog itself and goes in the component's output. Cancel, Escape and a screen that goes away all
// answer 'cancel'; the backdrop does not close it (a question that needs an answer is never thrown away by a stray tap).
// «Yes» takes the focus, as the primary answer of this question always has: opening WhatsApp is not sending, and the person who
// did send it taps one thing.
export function useSentCheck(): readonly [(question: SentQuestion) => Promise<SentAnswer>, ReactNode] {
  const [shown, setShown] = useState<Open | null>(null);
  // The same question, readable at once: the state is only read on the next render.
  const open = useRef<Open | null>(null);

  const answer = useCallback((value: SentAnswer) => {
    const asked = open.current;
    if (!asked) return;
    open.current = null;
    setShown(null);
    asked.settle(value);
  }, []);

  const ask = useCallback((question: SentQuestion) => new Promise<SentAnswer>(resolve => {
    open.current?.settle('cancel');
    const asked: Open = { question, settle: resolve };
    open.current = asked;
    setShown(asked);
  }), []);

  useEffect(() => () => {
    open.current?.settle('cancel');
    open.current = null;
  }, []);

  const dialog = shown === null ? null : (
    <Dialog
      isOpen
      role="alertdialog"
      title={shown.question.title}
      onClose={() => { answer('cancel'); }}
      actions={
        <>
          <Button key="cancel" onPress={() => { answer('cancel'); }}>{shown.question.cancelLabel}</Button>
          {shown.question.sendNowLabel === undefined ? null : (
            <Button key="sendNow" onPress={() => { answer('sendNow'); }}>{shown.question.sendNowLabel}</Button>
          )}
          <Button key="yes" variant="primary" autoFocus onPress={() => { answer('yes'); }}>{shown.question.yesLabel}</Button>
        </>
      }
    />
  );

  return [ask, dialog];
}
