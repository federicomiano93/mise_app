import { useId, useRef } from 'react';
import { CircleHelp } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useAwaitingSent } from './useAwaitingSent';
import { useKeepFocus } from './useKeepFocus';
import styles from './AwaitingBanner.module.css';

// The search box of the list's head, where the focus goes when the last question it was on is answered (no row left to go to).
const searchBox = { get current() { return document.querySelector<HTMLElement>('input[type="search"]'); } };

// «Order to Bruno sent at 10:42: did it go?» — one banner per supplier whose order was handed over and not answered yet (the current
// app's PR #554, reminder-view.js renderAwaiting). On EVERY device, until somebody answers: «Yes» records what went, «No» leaves the
// quantities in the order. Persistent on purpose — nothing to dismiss: an order handed over and never answered is exactly the order that
// used to go unrecorded.
//
// ⚠️ aria-disabled, NOT disabled, while this device is answering: a disabled button cannot hold the focus, and the one just tapped must
// keep it (the tap is ignored meanwhile, and answerAwaiting's busy guard would refuse it anyway). Rows are keyed by supplier, so a
// snapshot from another phone never rebuilds the button under the finger; a row that goes hands the focus to the next one (useKeepFocus).
// ⚠️ THE LIVE REGION IS THERE FROM THE START: a question that arrives from another device is announced, politely.
export function AwaitingBanner() {
  const { t } = useT();
  const awaiting = useAwaitingSent();
  const box = useRef<HTMLDivElement>(null);
  const base = useId();
  const signature = awaiting.list.map(entry => `${entry.supplier.id}:${entry.at}:${String(awaiting.busy(entry.supplier.id))}`).join('|');
  const onFocusCapture = useKeepFocus(box, searchBox, signature);

  return (
    <div ref={box} className={styles.stack} aria-live="polite" onFocusCapture={onFocusCapture}>
      {awaiting.list.map(entry => {
        const id = entry.supplier.id;
        const sentenceId = `${base}-${id}`;
        const waiting = awaiting.busy(id);
        return (
          <div key={id} className={styles.banner} data-keep={id}>
            <p className={styles.question} id={sentenceId}>
              <CircleHelp aria-hidden="true" className={styles.icon} />
              <span>{awaiting.question(entry.supplier, entry)}</span>
            </p>
            {/* The two answers are named by their own word AND described by the question, so a screen reader moving from button to
                button hears which order «Yes» is about. */}
            <div className={styles.actions}>
              <Button
                variant="primary"
                aria-describedby={sentenceId}
                aria-disabled={waiting || undefined}
                onPress={() => { if (!waiting) void awaiting.answer(id, 'yes', entry.at); }}
              >
                {t('ord.awaiting.yes')}
              </Button>
              <Button
                aria-describedby={sentenceId}
                aria-disabled={waiting || undefined}
                onPress={() => { if (!waiting) void awaiting.answer(id, 'no', entry.at); }}
              >
                {t('ord.awaiting.no')}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
