import { MAX_LINES } from '@mise/shared/order-request-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { announceAction } from '../telemetry/usage';
import type { ListSendOutcome } from './ordersStore';
import { LONG_MS } from './useClearQuantities';

// How long «List sent ✓ — Everybody who runs this place will be told.» stays: long enough to read who will be told.
const LIST_SENT_MS = 6000;

// What the in-app list «To whoever runs the place» ended as, said in the status line — the same words wherever a send can end in a
// list (the send screen, a supplier's own «Send»). The statistic is counted once per list, for the two outcomes where the list is in
// the app (the current app announces `order-request` at the same moment).
export function sayListOutcome(
  say: (message: string, ms?: number) => void,
  t: (key: MessageKey, params?: MessageParams) => string,
  outcome: ListSendOutcome,
): void {
  if (outcome === 'sent') say(`${t('ord.request.sent')} — ${t('ord.request.sentToManagers')}`, LIST_SENT_MS);
  else if (outcome === 'queued') say(t('ord.request.queued'), LIST_SENT_MS);
  else if (outcome === 'failed') say(t('ord.request.sendFailed'), LONG_MS);
  else if (outcome === 'nothing') say(t('ord.nothingLeft'), LONG_MS);
  else say(t('ord.request.tooMany', { n: MAX_LINES }), LONG_MS);
  if (outcome === 'sent' || outcome === 'queued') announceAction('order-request');
}
