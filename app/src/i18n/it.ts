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

  'common.cancel': 'Annulla',

  'auth.signIn.sub': 'Accedi per aprire il tuo locale.',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.signIn': 'Accedi',
  'auth.forgot': 'Password dimenticata?',
  'auth.enterEmail': 'Inserisci la tua email.',
  'auth.enterPassword': 'Inserisci la tua password.',
  'auth.signingIn': 'Accesso in corso…',
  'auth.typeEmailFirst': 'Scrivi prima la tua email qui sopra, poi tocca qui.',
  'auth.resetSent': 'Se {address} ha un account, il link per reimpostare la password sta arrivando.',
  'auth.err.badPair': 'Email e password non corrispondono a nessun account.',
  'auth.err.badEmail': 'Questo non sembra un indirizzo email.',
  'auth.err.disabled': 'Questo account è stato disattivato. Chiedi al titolare di riattivarlo.',
  'auth.err.tooMany': 'Troppi tentativi. Aspetta un minuto e riprova.',
  'auth.err.offline': 'Nessuna connessione. Il primo accesso su un dispositivo richiede internet.',
  'auth.err.generic': 'Accesso non riuscito. Riprova.',

  'auth.logOut': 'Esci',
  'auth.logOut.title': 'Vuoi uscire?',
  'auth.logOut.message': 'Per rientrare ti serviranno email e password.',
  'unsent.title': 'Non ancora inviato',
  'unsent.message': 'Alcune modifiche fatte su questo telefono non sono ancora arrivate al server, di solito perché manca la rete. Se continui adesso, andranno perse.',
  'unsent.leave': 'Continua lo stesso',
  'unsent.stay': 'Resta qui',

  'account.switchVenue': 'Cambia locale',

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
