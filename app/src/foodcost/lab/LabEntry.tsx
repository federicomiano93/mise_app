import { Scale, Timer } from 'lucide-react';
import { useT } from '../../i18n/useT';
import { useSession } from '../../session/SessionContext';
import { Button } from '../../ui/Button';
import { elapsedMs, formatClock } from './labClock';
import { labDraftKey, useLabDraft } from './labDraft';
import { useNow } from './useNow';
import styles from './LabEntry.module.css';

type Props = {
  productId: string;
  // Why the lab may not open yet (the same sentence that holds the pencil: a product saved before the switch waits for its recipes), or ''.
  held: string;
  onHeld: () => void;
  onOpen: () => void;
};

// The card's door to lab mode, right under the summary: a big full-width «Produci in laboratorio» and, when a production of this
// product is open on this tablet, a banner above it with the live clock and «Riprendi».
// ⚠️ THE BIG BUTTON NEVER STARTS A SECOND PRODUCTION OVER AN OPEN ONE: it opens the open one (the lab finds its draft). A new one is
// «Nuova produzione» after the save. ⚠️ HELD WITH aria-disabled, never `disabled`, like the pencil (ProductRead).
export function LabEntry({ productId, held, onHeld, onOpen }: Props) {
  const { t } = useT();
  const { locationId } = useSession();
  const draft = useLabDraft(labDraftKey(locationId ?? '', productId));
  const open = draft !== null && draft.startedAt !== null;
  const now = useNow(open);
  const press = held === '' ? onOpen : onHeld;
  return (
    <div className={styles.entry}>
      {open ? (
        <div className={styles.banner}>
          <Timer aria-hidden="true" />
          <span className={styles.bannerText}>{t('lab.banner', { time: formatClock(elapsedMs(draft.startedAt, now)) })}</span>
          <Button variant="secondary" aria-disabled={held !== ''} onPress={press}>{t('lab.resume')}</Button>
        </div>
      ) : null}
      <Button variant="secondary" block className={styles.big} aria-disabled={held !== ''} onPress={press}>
        <Scale aria-hidden="true" />
        <span>{t('lab.enter')}</span>
      </Button>
    </div>
  );
}
