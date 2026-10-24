import { useCallback, useEffect, useId, useRef } from 'react';
import type { RefObject } from 'react';
import { Trash2 } from 'lucide-react';
import { LOG_VISIBLE_DAYS, isLogVisible, sortLogs } from '@mise/shared/pastries-log-model';
import type { PastryLog } from '@mise/shared/pastries-log-model';
import { useLocation } from 'react-router';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { usePastries, usePastriesStore } from './PastriesContext';
import { cameFromDay, useLeave } from './pastriesNav';
import { spellDate } from './spellDate';
import { PASTRIES_PATH, weekdayLabel } from './weekdays';
import styles from './Records.module.css';

type Props = {
  // Set when the person is handed back to the day, so the pencil takes the focus (DayPanel).
  handBackFocus: RefObject<boolean>;
};

// What was actually put to prove, night by night. Read-only apart from the bin.
//
// ⚠️ THE LINE UNDER THE LIST SAYS THE FIFTEEN DAYS ARE A WINDOW, NOT A LIFESPAN. This screen used to
// delete a record once it was old enough; nothing does now, and a sentence that still promised a
// deletion nobody performs would be worse than one that never mentioned it.
//
// ⚠️ UP TO 120 DOCUMENTS ARE READ LIVE, SO ONLY WHILE THIS SCREEN IS ON SHOW: the listener starts
// here and stops when Records goes away, however it goes (P14, seven reads for the day screen).
export function Records({ handBackFocus }: Props) {
  const { t } = useT();
  const store = usePastriesStore();
  const { logs } = usePastries();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const { state } = useLocation();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const asking = useRef(false);

  useEffect(() => {
    store.startLogs();
    return () => store.stopLogs();
  }, [store]);

  // Arriving from the day, the page does not move the focus (FROM_DAY): it goes to this title.
  useEffect(() => {
    if (cameFromDay(state)) title.current?.focus();
  }, []);

  const handBack = useCallback(() => { handBackFocus.current = true; }, [handBackFocus]);
  const leave = useLeave(PASTRIES_PATH, handBack);

  // The last fifteen days, newest first. A record nobody can date is shown, so is one dated ahead
  // of this clock (isLogVisible).
  const now = Date.now();
  const visible = sortLogs(logs.filter(log => isLogVisible(log, now)));

  async function remove(log: PastryLog) {
    if (asking.current) return;
    asking.current = true;
    try {
      const day = log.day === '' ? '' : weekdayLabel(t, log.day);
      const date = spellDate(t, log.date);
      const ok = await confirm({
        title: t('past.removeThisRecord'),
        message: t('past.removeRecordForQ', { day, date }),
        okLabel: t('ui.remove'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
      if (await store.removeLog(log.id)) {
        say(t('past.recordRemoved'));
        // The bin that was pressed is gone with its card: the focus goes to the title, not to <body>.
        title.current?.focus();
      }
    } finally {
      asking.current = false;
    }
  }

  return (
    <section className={styles.records} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('past.records')}
        titleId={titleId}
        titleRef={title}
        sub={<p className={styles.sub}>{t('past.lastNDays', { n: LOG_VISIBLE_DAYS })}</p>}
      />

      <div className={styles.body}>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{t('past.noRecordsYet')}</p>
            <p className={styles.emptyHint}>{t('past.tapConfirmAtThe')}</p>
          </div>
        ) : (
          <>
            <ul className={styles.list}>
              {visible.map(log => {
                const day = log.day === '' ? '' : weekdayLabel(t, log.day);
                const date = spellDate(t, log.date);
                return (
                  <li key={log.id} className={styles.card}>
                    <div className={styles.cardHead}>
                      {/* The DATE it was proved on and WHICH list it was are different things: a
                          Wednesday list is confirmed on Tuesday night. */}
                      <h3 className={styles.date}>{date}</h3>
                      <span className={styles.badge}>{day}</span>
                    </div>

                    {log.items.length === 0 ? (
                      <p className={styles.nothing}>{t('past.nothingWasProved')}</p>
                    ) : (
                      <dl className={styles.items}>
                        {log.items.map((item, index) => (
                          <div key={`${item.name}#${index}`} className={styles.item}>
                            <dt className={styles.name}>{item.name}</dt>
                            <dd className={styles.qty}>{item.qty}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {log.note === '' ? null : <p className={styles.note}>{log.note}</p>}

                    <div className={styles.foot}>
                      <Button
                        variant="bare"
                        className={styles.bin}
                        aria-label={t('past.removeRecordFor', { day, date })}
                        onPress={() => { void remove(log); }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className={styles.kept}>{t('past.olderRecordsKept', { n: LOG_VISIBLE_DAYS })}</p>
          </>
        )}
      </div>

      {confirmDialog}
    </section>
  );
}
