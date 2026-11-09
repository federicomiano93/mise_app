import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { ConfirmOptions } from '../ui/useConfirm';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// The question every door to a RECORDED day asks before it lets anybody change it: a row, the pencil
// and the Edit button on the day panel, and the editor itself when it is opened by its address.
// One place, so the doors cannot drift apart in their words.
export function editRecordedDayQuestion(t: Translate, dayLabel: string): ConfirmOptions {
  return {
    title: t('past.editDayQ', { day: dayLabel }),
    message: t('past.alreadyRecordedTonight', { day: dayLabel }),
    okLabel: t('ui.edit'),
    cancelLabel: t('common.cancel'),
  };
}
