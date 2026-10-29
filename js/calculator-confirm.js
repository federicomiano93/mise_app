// calculator-confirm.js — one shared "unsaved changes" guard.
//
// Every editor (clients & products, recipes, market) asks the EXACT same
// question when the user tries to leave mid-edit, so the experience is
// consistent. The dialog offers Discard / Cancel:
//   Discard → leave and lose the changes
//   Cancel  → keep editing
//
// ASYNC: callers must `await confirmDiscard(...)`. An un-awaited call would
// treat the pending Promise as truthy and silently skip the guard.

import { t } from './i18n.js';
import { confirmDialog } from './confirm-dialog.js';

// Resolves true when it is safe to leave the editor now: either nothing was
// changed, or the user confirmed they want to discard their edits.
//
// ⚠️ The question is translated HERE, when it is asked, never at module load: the
// module loads before the venue's language arrives, so a constant was frozen in
// English and an Italian venue saw an English question over Italian buttons.
export async function confirmDiscard(dirty) {
  return !dirty || confirmDialog({ message: t('calc.youHaveUnsavedChanges'), okLabel: t('ui.discard'), danger: true, cancelLabel: t('ui.cancel') });
}
