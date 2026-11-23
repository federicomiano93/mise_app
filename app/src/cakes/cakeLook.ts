// cakeLook.ts — what a cake LOOKS like, read from the NAMES of the cards in each part (his choice, 21 Nov 2026: «la versione realistica,
// usala nell'app»). Pure, no three.js, no DOM: «Ganache al cioccolato» is a dark glossy coating with drips, «Crema al pistacchio» a green
// filling, «Frutti di bosco» raspberries and blueberries on top. NOTHING IS SAVED: the look is derived at every draw from the names, so a
// renamed card repaints the 3D view and nothing else changes.
//
// Words are matched in Italian AND English, without accents or case (normalizeSearchText). In a part with several cards the FIRST card
// that matches decides; a part with no match keeps the colour of its design token today (`colour: null`, the scene reads the token).
//
// The colours are the colours of FOOD (chocolate, pistachio, raspberry), not of the interface: they are not design tokens, and nothing
// else in the app reads them.

import type { CakeGeometry, CakePart } from '@mise/shared/cake-model';
import { normalizeSearchText } from '@mise/shared/catalogue-model';

// What stands on top: raspberries + blueberries + mint, blueberries alone, chocolate curls, grains (pistachio, hazelnut), piped rosettes,
// or (nothing recognised) the plain round pieces of before.
export type DecorationKind = 'berries' | 'blueberries' | 'curls' | 'grains' | 'rosettes' | 'plain';

export interface BaseLook { colour: string | null }
export interface SoakLook { colour: string | null }
export interface FillingLook { colour: string | null; glossy: boolean; specks: boolean }
export interface CoatingLook { colour: string | null; glaze: boolean }
export interface DecorationLook { kind: DecorationKind; colour: string | null }

export interface TierLook {
  base: BaseLook;
  soak: SoakLook;
  filling: FillingLook;
  coating: CoatingLook;
  decoration: DecorationLook;
}

// The look of a part with nothing recognised (or no card): the scene paints it with the part's own token.
export const PLAIN_LOOK: TierLook = {
  base: { colour: null },
  soak: { colour: null },
  filling: { colour: null, glossy: false, specks: false },
  coating: { colour: null, glaze: false },
  decoration: { kind: 'plain', colour: null },
};

// One flavour: the words that name it, its colour, and what it is by default (shiny or not, specks, and the kind of decoration it makes
// when nothing in the name says otherwise). The FORM words below (granella, glassa, panna) override the last three, never the colour.
interface Flavour { words: RegExp; colour: string; glossy: boolean; specks: boolean; decoration: DecorationKind }

// ⚠️ THE ORDER IS THE PRIORITY: «cioccolato bianco» must meet the white entry before the chocolate one, «crema al pistacchio» the
// pistachio before the cream, «frutti di bosco e mirtilli» the mixed berries before the blueberries (the longer phrase first), «blueberry»
// the blueberries before the general «berries». No look-behind in a pattern: Safari 16.0 to 16.3 refuses to even parse one. Words are
// matched on text already stripped of accents and lower-cased.
const FLAVOURS: readonly Flavour[] = [
  { words: /white\s+choc|cioccolat\w*\s+bianc|bianc\w*\s+cioccolat/, colour: '#f1e8d2', glossy: true, specks: false, decoration: 'curls' },
  { words: /cioccolat|cacao|ganache|fondent|chocolate|cocoa/, colour: '#3a1d12', glossy: true, specks: false, decoration: 'curls' },
  { words: /pistacchi|pistachio/, colour: '#b6c277', glossy: false, specks: false, decoration: 'grains' },
  { words: /frutti di bosco|frutti rossi|mixed\s+berr|(?:mirtill|blueberr).*(?:fragol|lampon|strawberr|raspberr)|(?:fragol|lampon|strawberr|raspberr).*(?:mirtill|blueberr)/, colour: '#d9566e', glossy: false, specks: false, decoration: 'berries' },
  { words: /mirtill|blueberr/, colour: '#4a5a96', glossy: false, specks: false, decoration: 'blueberries' },
  { words: /fragol|lampon|bosco|strawberr|raspberr|berr(?:y|ies)/, colour: '#d9566e', glossy: false, specks: false, decoration: 'berries' },
  { words: /limon|lemon/, colour: '#f4e58a', glossy: false, specks: false, decoration: 'plain' },
  { words: /caff|coffee|espresso|tiramis|\bmoka\b/, colour: '#9b6b45', glossy: false, specks: false, decoration: 'plain' },
  { words: /nocciol|hazelnut|gianduia/, colour: '#b98456', glossy: false, specks: false, decoration: 'grains' },
  { words: /caramell|caramel/, colour: '#c98a3a', glossy: true, specks: false, decoration: 'plain' },
  { words: /meringa|meringhe|meringue/, colour: '#fbf8f0', glossy: false, specks: false, decoration: 'rosettes' },
  // Custard is a real yellow (his ask, 22 Nov 2026): the paler #f3da82 read as white under the scene's lights.
  { words: /pasticcer|custard/, colour: '#e9bc3f', glossy: false, specks: true, decoration: 'rosettes' },
  { words: /panna|chantilly|crema|cream|vaniglia|vanilla/, colour: '#f6eedd', glossy: false, specks: true, decoration: 'rosettes' },
  // A plain «white» comes last: «panna bianca» is a cream first.
  { words: /\b(?:bianc[oa]|white)\b/, colour: '#f1e8d2', glossy: false, specks: false, decoration: 'plain' },
];

// The FORM words: what a card is (grains, curls, piped cream, a mirror glaze), whatever its flavour. They choose the decoration kind and the
// finish; the flavour chooses the colour. «Panna al cioccolato» is piped cream in a chocolate colour, «granella di cioccolato» grains.
// Several forms may name one kind: the first entry that matches wins. A meringue is piped like a cream: the nearest kind there is.
const KIND_FORMS: readonly { words: RegExp; kind: DecorationKind }[] = [
  { words: /granell|grain|crumble|gocce|\bchips?\b|sprinkle/, kind: 'grains' },
  { words: /riccioli|scaglie|curls?|shavings?/, kind: 'curls' },
  { words: /ciuffi|panna|chantilly|rosett|whipped|meringa|meringhe|meringue/, kind: 'rosettes' },
];

// A glaze or a ganache shines whatever its flavour; a cream (or a mousse) is matte whatever its flavour: «crema al cioccolato» is not a
// chocolate glaze. The shine words win when a name has both.
const SHINY = /glass|glaz|specchio|mirror|ganache/;
const MATTE = /panna|chantilly|crema|cream|mousse|whipped/;

// A sponge: cocoa is brown, a plain sponge is golden, anything else keeps the token colour.
const SPONGES: readonly { words: RegExp; colour: string }[] = [
  { words: /cacao|cocoa|cioccolat|chocolate/, colour: '#7a4c30' },
  { words: /pan di spagna|pandispagna|genoise|sponge|vaniglia|vanilla/, colour: '#ecca8a' },
];

// The soak: what it is made of tints the layer.
const SOAKS: readonly { words: RegExp; colour: string }[] = [
  { words: /alchermes/, colour: '#b4453f' },
  { words: /caff|coffee|espresso/, colour: '#6b4126' },
  { words: /\brum\b|liquor|limoncello|maraschino|marsala|cognac|brandy|amaretto/, colour: '#c08030' },
  // A lemon soak is a light yellow (his ask, 22 Nov 2026). After the liqueurs: «limoncello» is a liqueur first.
  { words: /limon|lemon/, colour: '#f1dc6e' },
];

const normalised = (names: readonly string[]) => names.map(name => normalizeSearchText(name)).filter(name => name !== '');

// The first card that matches decides.
function firstMatch<T>(names: readonly string[], pick: (text: string) => T | undefined): T | undefined {
  for (const text of normalised(names)) {
    const found = pick(text);
    if (found !== undefined) return found;
  }
  return undefined;
}

// What ONE card says: its colour from the flavour, its shape and finish from the form words, the flavour's defaults filling what the
// form words leave open. Undefined when the card names neither a flavour nor a form.
interface Reading { colour: string | null; glossy: boolean; specks: boolean; kind: DecorationKind }

function readCard(text: string): Reading | undefined {
  const flavour = FLAVOURS.find(candidate => candidate.words.test(text));
  const form = KIND_FORMS.find(candidate => candidate.words.test(text));
  const shiny = SHINY.test(text);
  if (!flavour && !form && !shiny) return undefined;
  return {
    colour: flavour?.colour ?? null,
    glossy: shiny || (!MATTE.test(text) && (flavour?.glossy ?? false)),
    specks: flavour?.specks ?? false,
    kind: form?.kind ?? flavour?.decoration ?? 'plain',
  };
}

// The FIRST card that says anything decides the colour, the shape and the finish together (never a colour from one card and a shine from
// another).
const readNames = (names: readonly string[]) => firstMatch(names, readCard);

export function baseLook(names: readonly string[]): BaseLook {
  return { colour: firstMatch(names, text => SPONGES.find(sponge => sponge.words.test(text)))?.colour ?? null };
}

export function soakLook(names: readonly string[]): SoakLook {
  return { colour: firstMatch(names, text => SOAKS.find(soak => soak.words.test(text)))?.colour ?? null };
}

export function fillingLook(names: readonly string[]): FillingLook {
  const read = readNames(names);
  return { colour: read?.colour ?? null, glossy: read?.glossy ?? false, specks: read?.specks ?? false };
}

export function coatingLook(names: readonly string[]): CoatingLook {
  const read = readNames(names);
  return { colour: read?.colour ?? null, glaze: read?.glossy ?? false };
}

export function decorationLook(names: readonly string[]): DecorationLook {
  const read = readNames(names);
  return { kind: read?.kind ?? 'plain', colour: read?.colour ?? null };
}

// The looks of a whole cake, per tier: `cardName` is the same lookup the labels use.
export function cakeLooks(geometry: CakeGeometry, cardName: (productId: string) => string): TierLook[] {
  return geometry.tiers.map(tier => {
    const namesOf = (part: CakePart) => tier.parts[part].productIds.map(cardName);
    return {
      base: baseLook(namesOf('base')),
      soak: soakLook(namesOf('soak')),
      filling: fillingLook(namesOf('filling')),
      coating: coatingLook(namesOf('coating')),
      decoration: decorationLook(namesOf('decoration')),
    };
  });
}

// The looks as one string, for the scene's signature: the same string means the same colours and decorations, so a renamed card that
// looks the same does not rebuild, and typing grams never does.
export function looksKey(looks: readonly TierLook[]): string {
  return JSON.stringify(looks);
}

// The colours of the food the scene draws with its own materials (a raspberry is red whatever the recipe is called), kept with the other
// colours of food in this file. Piped cream stands for «no coating colour known».
export const FOOD = {
  piping: '#f6eedd',
  raspberry: 0xa8102f,
  raspberrySheen: 0xff8899,
  blueberry: 0x29355f,
  blueberrySheen: 0x9fb2d9,
  mint: 0x3f8a3a,
} as const;
