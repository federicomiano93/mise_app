import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageParams } from '../i18n/i18n';
import { messageText } from './pastriesMessages';
import type { PastriesMessage } from './pastriesStore';

const english = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const italiano = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);

const MESSAGES: readonly [PastriesMessage, string, string][] = [
  [
    { kind: 'save-failed', day: 'Tuesday' },
    'Couldn’t save Tuesday — check your connection.',
    'Non è stato possibile salvare Martedì — controlla la connessione.',
  ],
  [
    { kind: 'days-stream-broken' },
    'Live sync interrupted — this list may be out of date.',
    'Sincronizzazione interrotta — questa lista potrebbe non essere aggiornata.',
  ],
  [
    { kind: 'logs-stream-broken' },
    'Live sync interrupted — these records may be out of date.',
    'Sincronizzazione interrotta — questi registri potrebbero non essere aggiornati.',
  ],
  [
    { kind: 'record-failed', day: 'Sunday' },
    'Couldn’t record Sunday — check your connection.',
    'Non è stato possibile registrare Domenica — controlla la connessione.',
  ],
  [
    { kind: 'remove-failed' },
    'Couldn’t remove that record — check your connection.',
    'Non è stato possibile togliere quel registro — controlla la connessione.',
  ],
];

describe('messageText', () => {
  it.each(MESSAGES)('%j in English and in Italian', (message, inEnglish, inItalian) => {
    expect(messageText(english, message)).toBe(inEnglish);
    expect(messageText(italiano, message)).toBe(inItalian);
  });

  it('says the day by its label, never by its stored id', () => {
    expect(messageText(italiano, { kind: 'save-failed', day: 'Wednesday' })).not.toContain('Wednesday');
  });
});
