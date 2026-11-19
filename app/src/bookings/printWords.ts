// What a print that did not happen is called on screen (bookings step 3). One sentence per kind; Epson's own short code is
// added when the printer gave one, so it can be looked up in its manual.
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { PrintOutcome } from './receiptPrinter';

type Translate = (key: MessageKey, params?: MessageParams) => string;

export function printOutcomeText(t: Translate, outcome: Exclude<PrintOutcome, { ok: true }>): string {
  switch (outcome.kind) {
    case 'no-printer':
      return t('bookings.print.noPrinter');
    case 'unreachable':
      return t('bookings.print.unreachable');
    case 'timeout':
      return t('bookings.print.timeout');
    case 'refused':
      return outcome.code === '' ? t('bookings.print.refused') : t('bookings.print.refusedCode', { code: outcome.code });
  }
}
