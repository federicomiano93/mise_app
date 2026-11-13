import { LIST_STATUS } from '@mise/shared/list-status';
import type { ListStatus } from '@mise/shared/list-status';
import { useT } from '../i18n/useT';
import styles from './NoAnswerYet.module.css';

// What stands in for the rows of a list that has not answered yet (the current app's appendNoRows in js/orders/registry.js):
// «Loading…» while it waits, and after 10 s without an answer (or with the phone offline and only an empty copy) that the list
// has not arrived, with what to check. It goes the moment the list answers: the caller draws this only while it is not loaded.
//
// ⚠️ ONE STATUS REGION FOR «LOADING» AND «NOT ARRIVED», THE SAME ELEMENT ACROSS BOTH (architecture rule 6): a live region that
// arrives already filled is not read by many screen readers, so the change after 10 s happens inside one that is already there.
// `roomy` is the padding of a whole panel (the list's, or a supplier waiting to be found); the default is a short list inside a card.
export function NoAnswerYet({ status, roomy = false }: { status: ListStatus; roomy?: boolean }) {
  const { t } = useT();
  const unreachable = status === LIST_STATUS.unreachable;
  return (
    <div role="status" aria-busy={unreachable ? undefined : 'true'} className={unreachable ? styles.empty : roomy ? styles.roomy : styles.loading}>
      {unreachable ? (
        <>
          <p className={styles.title}>{t('sup.notArrived.title')}</p>
          <p className={styles.sub}>{t('sup.notArrived.sub')}</p>
        </>
      ) : (
        <p>{t('session.loading')}</p>
      )}
    </div>
  );
}
