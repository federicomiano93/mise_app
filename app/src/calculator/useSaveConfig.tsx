import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { saveFailureKey } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { useAlert } from '../ui/useAlert';
import { useCalculatorStore } from './CalculatorContext';

type Options = {
  // Runs BEFORE the message, for a control that saves on the tap and must be put back where it was.
  onFail?: () => void;
};

// The way every Settings screen saves the configuration (a port of js/calculator-config-store.js
// `saveConfigOrSay`): it resolves true when the change is stored — or was kept on this phone with its own
// explanation («the database has not answered yet», said first) — and false after saying why it was NOT saved.
// On false the screen keeps its edits and stays dirty, and gives Save back.
//
//   const [save, saveDialog] = useSaveConfig();
//   if (!(await save(next))) return;
//
// The second value is the dialog the sentences are said in and goes in the component's output.
export function useSaveConfig(): readonly [(next: CalculatorConfig, options?: Options) => Promise<boolean>, ReactNode] {
  const { t } = useT();
  const store = useCalculatorStore();
  const [alert, alertDialog] = useAlert();

  const save = useCallback(async (next: CalculatorConfig, { onFail }: Options = {}): Promise<boolean> => {
    // The store never rejects: a refused or unreachable write comes back as a result.
    const result = await store.saveConfig(next);
    if (result.synced) return true;
    if (result.reason === 'no-server-answer') {
      await alert({ message: t('calc.savedLocallyOnly'), okLabel: t('common.ok') });
      return true;
    }
    const key = saveFailureKey(result);
    onFail?.();
    if (key !== null) await alert({ message: t(key), okLabel: t('common.ok') });
    return false;
  }, [store, alert, t]);

  return [save, alertDialog];
}
