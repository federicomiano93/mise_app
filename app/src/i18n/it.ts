import type { Messages } from './en';

// Italian. Typed `Messages`, so it must carry exactly the keys of en.ts. It is loaded on
// demand (import('./it') in i18n.ts), which is why it is a separate chunk: an English phone
// never downloads it.

export const it: Messages = {
  'app.name': 'Mise',
  'page.title': '{title} · Mise',

  'nav.rail': 'Tutte le sezioni',
  'nav.tabs': 'Sezioni principali',
  'nav.skip': 'Vai al contenuto',

  'section.orders': 'Ordini',
  'section.suppliers': 'Fornitori',
  'section.recipes': 'Ricette',
  'section.calculator': 'Calcolatore',
  'section.pastries': 'Paste',
  'section.stocktake': 'Magazzino',
  'section.foodcost': 'Food cost',
  'section.settings': 'Impostazioni',
  'section.more': 'Altro',

  'placeholder.title': 'Questa sezione arriverà in uno dei prossimi passi di Mise 2.',
  'placeholder.body': 'Nel frattempo continua a usare l’app di sempre.',

  'notFound.title': 'Pagina non trovata',
  'notFound.body': 'Questo indirizzo non porta a nessuna sezione.',
  'notFound.action': 'Vai agli Ordini',

  'status.online': 'Online',
  'status.offline': 'Nessuna connessione',

  'part.failed.title': 'Questa parte non si è caricata.',
  'part.failed.body': 'Il resto della schermata funziona.',
  'part.failed.action': 'Ricarica',

  'app.failed.title': 'Mise si è fermata.',
  'app.failed.body': 'Di solito ricaricando si risolve. Quello che hai salvato non va perso.',
  'app.failed.action': 'Ricarica l’app',
};
