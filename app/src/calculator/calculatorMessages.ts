import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { CalculatorMessage } from './calculatorStore';
import type { TabResult } from './calculatorResult';

type Say = (key: MessageKey, params?: MessageParams) => string;

// What the store reports, in the person's language. null: nothing to say out loud.
//
// ⚠️ A STREAM THAT DIED SAYS NOTHING HERE. With nothing on this phone to work from, the Calculator's empty
// state already says it could not be loaded; with the phone's own copy on screen the work goes on, and the
// offline banner of the shell is the place that speaks of the connection.
export function messageText(t: Say, message: CalculatorMessage): string | null {
  switch (message.kind) {
    case 'log-not-saved':
      return t('calc.logNotSaved', { dough: message.dough });
    case 'log-full':
      return t('calc.logFull', { dough: message.dough });
    case 'config-stream-broken':
    case 'logs-stream-broken':
      return null;
  }
}

// Why a tab with something to make cannot be calculated, in a sentence; null when it can be. The same sentence
// the result card shows and the dialog Confirm refuses with.
export function problemSentence(t: Say, result: TabResult): string | null {
  switch (result.kind) {
    case 'loading':
      return t('calc.sourceLoading');
    case 'problem':
      if (result.problem === 'unweighable') return t('calc.sourceUnweighable', { row: result.row });
      return t(result.problem === 'missing' ? 'calc.sourceMissing' : 'calc.sourceEmpty');
    default:
      return null;
  }
}
