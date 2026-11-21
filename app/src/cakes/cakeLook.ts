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

// One flavour: the words that name it, its colour, whether it is shiny, and what it makes of a decoration.
interface Flavour { words: RegExp; colour: string; glossy: boolean; specks: boolean; decoration: DecorationKind }

// ⚠️ THE ORDER IS THE PRIORITY: «cioccolato bianco» must meet the white entry before the chocolate one, «crema al pistacchio» the
// pistachio before the cream. Words are matched on text already stripped of accents and lower-cased.
const FLAVOURS: readonly Flavour[] = [
  { words: /white\s+choc|cioccolat\w*\s+bianc|bianc\w*\s+cioccolat/, colour: '#f1e8d2', glossy: true, specks: false, decoration: 'curls' },
  { words: /cioccolat|cacao|ganache|fondent|chocolate|cocoa/, colour: '#3a1d12', glossy: true, specks: false, decoration: 'curls' },
  { words: /pistacchi|pistachio/, colour: '#b6c277', glossy: false, specks: false, decoration: 'grains' },
  { words: /fragol|lampon|frutti di bosco|frutti rossi|bosco|strawberr|raspberr|(?<!blue)berr(?:y|ies)/, colour: '#d9566e', glossy: false, specks: false, decoration: 'berries' },
  { words: /mirtill|blueberr/, colour: '#4a5a96', glossy: false, specks: false, decoration: 'blueberries' },
  { words: /limon|lemon/, colour: '#f4e58a', glossy: false, specks: false, decoration: 'plain' },
  { words: /caff|coffee|espresso|tiramis|\bmoka\b/, colour: '#9b6b45', glossy: false, specks: false, decoration: 'plain' },
  { words: /nocciol|hazelnut|gianduia/, colour: '#b98456', glossy: false, specks: false, decoration: 'grains' },
  { words: /caramell|caramel/, colour: '#c98a3a', glossy: true, specks: false, decoration: 'plain' },
  { words: /meringa|meringhe|meringue/, colour: '#fbf8f0', glossy: false, specks: false, decoration: 'rosettes' },
  { words: /pasticcer|custard/, colour: '#f3da82', glossy: false, specks: true, decoration: 'rosettes' },
  { words: /panna|chantilly|crema|cream|vaniglia|vanilla/, colour: '#f6eedd', glossy: false, specks: true, decoration: 'rosettes' },
  // A plain «white» comes last: «panna bianca» is a cream first.
  { words: /\b(?:bianc[oa]|white)\b/, colour: '#f1e8d2', glossy: false, specks: false, decoration: 'plain' },
];

// Words that make a coating or a filling shiny whatever its flavour.
const SHINY = /glass|glaz|specchio|mirror|ganache/;

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

const flavourOf = (names: readonly string[]) => firstMatch(names, text => FLAVOURS.find(flavour => flavour.words.test(text)));

export function baseLook(names: readonly string[]): BaseLook {
  return { colour: firstMatch(names, text => SPONGES.find(sponge => sponge.words.test(text)))?.colour ?? null };
}

export function soakLook(names: readonly string[]): SoakLook {
  return { colour: firstMatch(names, text => SOAKS.find(soak => soak.words.test(text)))?.colour ?? null };
}

export function fillingLook(names: readonly string[]): FillingLook {
  const text = normalised(names).join(' ');
  const flavour = flavourOf(names);
  return {
    colour: flavour?.colour ?? null,
    glossy: (flavour?.glossy ?? false) || SHINY.test(text),
    specks: flavour?.specks ?? false,
  };
}

export function coatingLook(names: readonly string[]): CoatingLook {
  const text = normalised(names).join(' ');
  const flavour = flavourOf(names);
  return { colour: flavour?.colour ?? null, glaze: (flavour?.glossy ?? false) || SHINY.test(text) };
}

export function decorationLook(names: readonly string[]): DecorationLook {
  const flavour = flavourOf(names);
  return { kind: flavour?.decoration ?? 'plain', colour: flavour?.colour ?? null };
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
