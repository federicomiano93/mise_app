import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { messageText } from './suppliersMessages';

const english = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const italiano = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);

describe('messageText', () => {
  it.each([
    [{ kind: 'favourite-not-saved' }, 'Could not save the favourite. Check the connection and try again.', 'Impossibile salvare il preferito. Controlla la connessione e riprova.'],
    [{ kind: 'supplier-not-saved', name: 'Alpine' }, 'Could not save “Alpine”. Check your network and try again.', 'Non è stato possibile salvare «Alpine». Controlla la connessione e riprova.'],
    [{ kind: 'supplier-active-not-saved', name: 'Alpine' }, 'Could not switch “Alpine” off or on. Check your network and try again.', 'Non è stato possibile disattivare o riattivare «Alpine». Controlla la connessione e riprova.'],
    [{ kind: 'supplier-not-deleted', name: 'Alpine' }, 'Could not delete “Alpine”. Check your network and try again.', 'Non è stato possibile eliminare «Alpine». Controlla la connessione e riprova.'],
    [{ kind: 'category-not-deleted', name: 'Flour' }, 'Could not delete the category “Flour”. Check your network and try again.', 'Non è stato possibile eliminare la categoria «Flour». Controlla la connessione e riprova.'],
  ] as const)('words %j in both languages', (message, inEnglish, inItalian) => {
    expect(messageText(english, message)).toBe(inEnglish);
    expect(messageText(italiano, message)).toBe(inItalian);
  });
});
