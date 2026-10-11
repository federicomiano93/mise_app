// ⚠️ A SENTENCE WITH A WEEKDAY IN IT MUST FIT ALL SEVEN. «Domenica» is feminine, the other six
// days are masculine, so «{day} salvato» or «{day} risulterà fatto» is right six days in seven and
// wrong on Sunday — which is how the Italian Pastries screen read until Oct 2026. A weekday is the
// subject of no adjective or participle: the sentence is about «la lista di {day}», or puts the day
// last («Salvato: {day}.»). The same goes for a pastry name, which can be feminine or plural
// («Quanti Sfogliatelle?»). Mise 2 carries a narrower copy of this guard (app/src/i18n/i18n.spec.ts,
// branch feature/mise2-pastries until it merges).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage, DEFAULT_LANGUAGE, _dictionaries } from '../js/i18n.js';

function inLanguage(lang, fn) {
  setLanguage(lang);
  try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
}

// Every Italian Pastries sentence, plural forms included, as [key, text].
const italianPastries = Object.entries(_dictionaries().it)
  .filter(([key]) => key.startsWith('past.'))
  .flatMap(([key, message]) => (typeof message === 'string' ? [message] : Object.values(message))
    .map(text => [key, text]));

const withDay = italianPastries.filter(([, text]) => text.includes('{day}'));
const withName = italianPastries.filter(([, text]) => text.includes('{name}'));

// Words that would have to agree with the day: masculine participles and adjectives, and the
// pronoun «lo» that points back at it. A word followed by a colon is a label with the day after it
// («Salvato: {day}.»), which agrees with nothing.
const MASCULINE = /\b(fatto|detto|messo|preso|tolto|scritto|chiuso|aperto|vuoto|pieno|pronto|completo|registrato|salvato|confermato|modificato|cambiato|aggiornato|completato)\b(?!:)|\b(cambiarlo|modificarlo|toglierlo|salvarlo|registrarlo|confermarlo)\b/i;
// A regular masculine participle (-ato, -ito, -uto) anywhere after the day, the irregular ones
// being in the list above.
const PARTICIPLE_AFTER_DAY = /\{day\}.*?\b([a-zà-ù]+(?:at|it|ut)o)\b(?!:)/is;
// A masculine article in front of the day: «del Domenica», «il Domenica».
const ARTICLE_BEFORE_DAY = /\b(il|lo|del|dello|al|allo|dal|nel|sul|un)\s+\{day\}/i;

test('the guard below is looking at the Pastries sentences, not at nothing', () => {
  assert.ok(withDay.length > 10, `only ${withDay.length} Italian past.* sentences name a day`);
  const keys = withDay.map(([key]) => key);
  for (const key of ['past.daySaved', 'past.dayRecorded', 'past.alreadyRecordedTonight', 'past.willShowAsDone']) {
    assert.ok(keys.includes(key), `${key} should name the day`);
  }
  assert.ok(withName.map(([key]) => key).includes('past.howMany'));
});

test('no Italian Pastries sentence makes a word agree with the day', () => {
  for (const [key, text] of withDay) {
    assert.doesNotMatch(text, MASCULINE,
      `${key}: «${text}» agrees with the day — wrong for Domenica. Say «La lista di {day} …» or «…: {day}.»`);
    const participle = PARTICIPLE_AFTER_DAY.exec(text);
    assert.equal(participle, null,
      `${key}: «${text}» has «${participle?.[1]}» after the day — wrong for Domenica.`);
    assert.doesNotMatch(text, ARTICLE_BEFORE_DAY,
      `${key}: «${text}» puts a masculine article before the day — «del Domenica» is wrong.`);
  }
});

test('the guard catches the sentences that read wrong on Sunday', () => {
  const caught = text => MASCULINE.test(text) || PARTICIPLE_AFTER_DAY.test(text) || ARTICLE_BEFORE_DAY.test(text);
  assert.ok(caught('{day} salvato.'));
  assert.ok(caught('{day} è già registrato per stanotte. Modificare queste quantità?'));
  assert.ok(caught('{day} risulterà fatto. Puoi ancora cambiarlo — te lo chiederà prima.'));
  assert.ok(caught('{day} è stato aggiornato.'));
  assert.ok(caught('{day} è sparito.'));
  assert.ok(caught('{day} tolto.'));
  assert.ok(caught('La lista del {day} è pronta.'));
  assert.ok(!caught('Salvato: {day}.'));
  assert.ok(!caught('Non è stato possibile salvare {day} — controlla la connessione.'));
});

test('no Italian Pastries sentence counts a pastry name as masculine plural', () => {
  for (const [key, text] of withName) {
    assert.doesNotMatch(text, /\bquant[aeio]\s+\{name\}/i,
      `${key}: «${text}» agrees with the pastry name — «Quanti Sfogliatelle?» is wrong`);
  }
});

for (const dayKey of ['weekday.monday', 'weekday.thursday', 'weekday.sunday']) {
  test(`the reworded sentences read right for ${dayKey}`, () => {
    inLanguage('it', () => {
      const day = t(dayKey);
      assert.equal(t('past.daySaved', { day }), `Salvato: ${day}.`);
      assert.equal(t('past.dayRecorded', { day }), `Registrato: ${day}.`);
      assert.equal(t('past.alreadyRecordedTonight', { day }),
        `La lista di ${day} è già registrata per stanotte. Modificare queste quantità?`);
      assert.equal(t('past.willShowAsDone', { day }),
        `La lista di ${day} risulterà fatta. Puoi ancora cambiarla — te lo chiederà prima.`);
    });
  });
}

test('the missing-quantity message fits any pastry name', () => {
  inLanguage('it', () => {
    assert.equal(t('past.howMany', { name: 'Sfogliatelle' }), 'Manca la quantità di Sfogliatelle.');
    assert.equal(t('past.howMany', { name: 'Cornetto' }), 'Manca la quantità di Cornetto.');
  });
  inLanguage('en', () => {
    assert.equal(t('past.howMany', { name: 'Croissants' }), 'How many Croissants?');
  });
});

test('Sunday reads «Domenica», so the checks above test the feminine day', () => {
  inLanguage('it', () => assert.equal(t('weekday.sunday'), 'Domenica'));
});
