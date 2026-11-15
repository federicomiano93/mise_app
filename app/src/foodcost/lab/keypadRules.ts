// The lab's on-screen keypad, as pure rules (the tablet's own keyboard must never open: the fields are buttons).
//
// A value is its TEXT, with a comma as the decimal sign (an Italian keyboard offers one; the card's boxes read it the same way).
// Six digits at most, one comma, no leading zero: that keeps every weight under the rules' ten tonnes and every number readable at
// arm's length.

export const MAX_DIGITS = 6;

export const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'back'] as const;
export type PadKey = (typeof KEYPAD_KEYS)[number];

const digitsIn = (text: string): number => text.replace(',', '').length;

// The text after one key. `allowComma: false` for a whole number (pieces, minutes): the comma then does nothing.
export function pressKey(text: string, key: string, allowComma = true): string {
  if (key === 'back') return text.slice(0, -1);
  if (key === ',') {
    if (!allowComma || text.includes(',') || digitsIn(text) >= MAX_DIGITS) return text;
    return text === '' ? '0,' : `${text},`;
  }
  if (!/^[0-9]$/.test(key) || digitsIn(text) >= MAX_DIGITS) return text;
  // «0» then «5» is «5», not «05».
  return text === '0' ? key : `${text}${key}`;
}

// A physical keyboard: digits, «,» or «.» (both are the decimal sign), Backspace. Anything else is not for the keypad.
export function padKeyOf(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): PadKey | null {
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return null;
  if (/^[0-9]$/.test(event.key)) return event.key as PadKey;
  if (event.key === ',' || event.key === '.') return ',';
  if (event.key === 'Backspace') return 'back';
  return null;
}

// What the text stands for: null for nothing (or «0,» with no digits typed after a lone comma), else a finite number ≥ 0.
export function parseTyped(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || text === '') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// A number as a field shows it: a comma, no grouping, at most four decimals (a stored 0.6 kg is «600», 1/3 kg is «333,3333»).
export function typedText(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  const rounded = Math.round(value * 1e4) / 1e4;
  return String(rounded).replace('.', ',');
}
