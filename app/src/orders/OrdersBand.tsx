import { useCallback } from 'react';
import { History, Share } from 'lucide-react';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import iconStyles from '../shell/BandIcon.module.css';
import { Button } from '../ui/Button';
import { ListsDoor } from './ListsDoor';
import { NoticesBell } from './NoticesBell';
import { HISTORY_DOOR, SEND_OPENER, useHandBack } from './handBack';
import styles from './OrdersBand.module.css';

type Props = {
  onHistory: () => void;
  onLists: () => void;
  onSend: () => void;
  // The send icon at the far right: only once the lists are live and hold a supplier, and NOT while a supplier is open (its own send
  // is the one to use then).
  showSend: boolean;
};

// The OTHER controls of Orders' title line (the redesign of 16 Nov 2026, item 3): History, the bell
// (with its number), «Order lists» (with the lists waiting), and at the far right the send icon. The settings gear is not here: it sits right
// beside the title (OrdersSection passes it to Page as its `gear`), in the top bar from 700px; this row is under the bar there.
//
// ⚠️ ICONS ALONE, EACH WITH ITS NAME: the band holds four controls on one line at 1024, and the word row they replace cost a whole
// line of the list. Every icon button is 48px square and named for assistive technology.
// ⚠️ THE DOORS KEEP THEIR HAND-BACK NAMES (handBack.ts): Back from History, the lists and the send screen gives the focus
// back to these buttons.
export function OrdersBand({ onHistory, onLists, onSend, showSend }: Props) {
  const { t } = useT();
  const handBack = useHandBack();
  const historyNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(HISTORY_DOOR, node); }, [handBack]);
  const sendNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SEND_OPENER, node); }, [handBack]);

  return (
    <>
      {/* Always there: past orders outlive the suppliers they went to. */}
      <Button ref={historyNode} variant="bare" className={iconStyles.icon} aria-label={t('ord.history.title')} onPress={onHistory}>
        <History aria-hidden="true" />
      </Button>
      {/* In a part of its own: a failure in the bell must not take the band down. */}
      <PartBoundary>
        <NoticesBell />
      </PartBoundary>
      <ListsDoor onOpen={onLists} />
      <span className={styles.grow} aria-hidden="true" />
      {/* ⚠️ AN ARROW OUT OF A TRAY, NOT A WHATSAPP MARK: the screen it opens offers several roads. */}
      {showSend ? (
        <Button ref={sendNode} variant="bare" className={iconStyles.icon} aria-label={t('ord.send.action')} onPress={onSend}>
          <Share aria-hidden="true" />
        </Button>
      ) : null}
    </>
  );
}
