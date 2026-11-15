import { Scale, Timer } from 'lucide-react';
import { useT } from '../../i18n/useT';
import { useSession } from '../../session/SessionContext';
import { Button } from '../../ui/Button';
import { formatClock } from './labClock';
import { useConfirm } from '../../ui/useConfirm';
import { clearDraft, labDraftKey, useLabDraft } from './labDraft';
import { labourMs } from './labModel';
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
  const key = labDraftKey(locationId ?? '', productId);
  const draft = useLabDraft(key);
  const [confirm, confirmDialog] = useConfirm();
  const open = draft !== null && draft.startedAt !== null;
  const now = useNow(open);
  const press = held === '' ? onOpen : onHeld;
  // A started production can be given up: a small, low-key action that asks first. The card is not touched.
  const abandon = async () => {
    const ok = await confirm({
      title: t('lab.cancel.title'),
      message: t('lab.cancel.message'),
      okLabel: t('lab.cancel.action'),
      cancelLabel: t('lab.cancel.no'),
      danger: true,
    });
    if (ok) clearDraft(key);
  };
  return (
    <div className={styles.entry}>
      {open ? (
        <div className={styles.banner}>
          <Timer aria-hidden="true" />
          <span className={styles.bannerText}>{t(draft.ovenSince === null ? 'lab.banner' : 'lab.bannerOven', { time: formatClock(labourMs(draft, now)) })}</span>
          <Button variant="secondary" aria-disabled={held !== ''} onPress={press}>{t('lab.resume')}</Button>
          <Button variant="bare" className={styles.abandon} onPress={() => { void abandon(); }}>{t('lab.cancel.action')}</Button>
        </div>
      ) : null}
      <Button variant="secondary" block className={styles.big} aria-disabled={held !== ''} onPress={press}>
        <Scale aria-hidden="true" />
        <span>{t('lab.enter')}</span>
      </Button>
      {confirmDialog}
    </div>
  );
}
