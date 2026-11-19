import { COMMON_FIRST_NAMES, COMMON_SURNAMES } from './commonNames';

// What is offered under «Nome cliente» while a booking's name is typed (the owner's ask, 19 Nov 2026). Pure: the text in, the rows
// out; the window that draws them is `CustomerNameField.tsx`.

// One row of the window: the word as the list writes it, where in the typed text it replaces from, and how many of its letters
// the person has typed (those are drawn bold).
export type NameRow = { readonly name: string; readonly replaceFrom: number; readonly typedLetters: number };

// The most rows the window shows.
export const MAX_ROWS = 5;

// Matching ignores case, accents, apostrophes and spaces, so «pata» finds Patanè, «dag» finds D'Agata and «dima» finds Di Mauro.
export function foldName(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’‘`\s]/g, '');
}

// How many characters of `name` hold the first `letters` folded letters (the bold part: «Pata» in «Patanè», «Di M» in «Di Mauro»).
function boldLength(name: string, letters: number): number {
  let seen = 0;
  for (let at = 0; at < name.length; at += 1) {
    seen += foldName(name.charAt(at)).length;
    if (seen >= letters) return at + 1;
  }
  return name.length;
}

const wordStart = (text: string): number => Math.max(text.lastIndexOf(' '), text.lastIndexOf(' ')) + 1;

// The rows for the text typed so far, or none. ⚠️ ONLY THE WORD BEING TYPED counts (what follows the last space), from its
// second letter; a text ending in a space starts a new word and offers nothing until it has two letters.
// ⚠️ A COMPOUND SURNAME has a space inside («Di Mauro»), so the last TWO words joined are tried too: «Di M» finds it, and the
// pick then replaces both words. Only entries that really hold a space are tried that way, or «Di M» would offer «Dimartino».
// The first word typed offers first names first and surnames after (people often write the surname first, «Russo Maria»); any
// later word offers surnames first. Each list keeps its own order (commonest first); no word is offered twice.
export function suggestNames(text: string, max: number = MAX_ROWS): NameRow[] {
  const start = wordStart(text);
  const typed = foldName(text.slice(start));
  const before = text.slice(0, start).trimEnd();
  const first = before === '';
  // The word before the one being typed, to try the two together.
  const previousStart = first ? -1 : wordStart(before);
  const joined = first ? '' : foldName(text.slice(previousStart));
  // A single letter offers nothing on its own, but «Di M» already holds three letters of a compound surname.
  if (typed.length < 1 || (typed.length < 2 && joined === '')) return [];
  const alone = typed.length >= 2;

  const lists = first ? [COMMON_FIRST_NAMES, COMMON_SURNAMES] : [COMMON_SURNAMES, COMMON_FIRST_NAMES];
  const rows: NameRow[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const name of list) {
      if (rows.length >= max) return rows;
      if (seen.has(name)) continue;
      const folded = foldName(name);
      if (joined !== '' && name.includes(' ') && folded.startsWith(joined) && folded !== joined) {
        seen.add(name);
        rows.push({ name, replaceFrom: previousStart, typedLetters: boldLength(name, joined.length) });
      } else if (alone && folded.startsWith(typed) && folded !== typed) {
        seen.add(name);
        rows.push({ name, replaceFrom: start, typedLetters: boldLength(name, typed.length) });
      }
    }
  }
  return rows;
}

// The text with the picked word in place of what was typed, and ONE space after it so the next word starts at once. Cut to `max`
// characters (the name's limit): a long pick must not make the box hold more than it allows.
export function applyName(text: string, row: NameRow, max: number = Number.POSITIVE_INFINITY): string {
  return `${text.slice(0, row.replaceFrom)}${row.name} `.slice(0, max);
}
