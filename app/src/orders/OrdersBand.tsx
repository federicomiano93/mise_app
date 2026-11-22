import { useCallback } from 'react';
import { History, Share } from 'lucide-react';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import iconStyles from '../shell/BandIcon.module.css';
import { SettingsGear } from '../shell/SettingsGear';
import { Button } from '../ui/Button';
import { ListsDoor } from './ListsDoor';
import { NoticesBell } from './NoticesBell';
import { HISTORY_DOOR, SEND_OPENER, SETTINGS_OPENER, useHandBack } from './handBack';
import styles from './OrdersBand.module.css';

type Props = {
  onSettings: () => void;
  onHistory: () => void;
  onLists: () => void;
  onSend: () => void;
  // The send icon at the far right: only once the lists are live and hold a supplier, and NOT while a supplier is open (its own send
  // is the one to use then).
  showSend: boolean;
};

// The controls of Orders' title band (the redesign of 16 Nov 2026, item 3), right after «Orders»: the settings, History, the bell
// (with its number), «Order lists» (with the lists waiting), and at the far right the send icon.
//
// ⚠️ ICONS ALONE, EACH WITH ITS NAME: the band holds five controls on one line at 1024, and the word row they replace cost a whole
// line of the list. Every icon button is 48px square and named for assistive technology.
// ⚠️ THE DOORS KEEP THEIR HAND-BACK NAMES (handBack.ts): Back from Settings, History, the lists and the send screen gives the focus
// back to these buttons.
export function OrdersBand({ onSettings, onHistory, onLists, onSend, showSend }: Props) {
  const { t } = useT();
  const handBack = useHandBack();
  const settingsNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);
  const historyNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(HISTORY_DOOR, node); }, [handBack]);
  const sendNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SEND_OPENER, node); }, [handBack]);

  return (
    <>
      {/* Always there, even with no supplier yet: the settings are not about the suppliers. */}
      <SettingsGear ref={settingsNode} label={t('ord.settings.open')} onPress={onSettings} />
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
