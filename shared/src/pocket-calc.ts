// pocket-calc.ts — the Home's pocket calculator: what the keys do, and the sum they build. NEW in Mise 2 (no original in the current app).
//
// PURE, ZERO IMPORTS, NO eval() AND NO Function(): the sum is a list of tokens that a small parser reads, so nothing a person types can
// ever run as code. Numbers live INSIDE as plain text with a point («12.5»); only `calcDisplay` writes the venue's decimal mark.
//
// The rules, the phone-calculator way:
//   • × and ÷ before + and −.
//   • «%»: `a + b%` is a + a·b/100 (the same for −), `a × b%` is a·b/100, `a ÷ b%` is a / (b/100), a lone `x%` is x/100. With a longer
//     sum the «a» is the running total before that term: 100 + 50 + 10% = 165.
//   • A key typed after an operator replaces it. «=» typed again, or on nothing, does nothing.
//   • Dividing by zero, or a result past 15 digits, is an error: only C clears it.
//   • ⚠️ A RESULT IS TIDIED so no float noise shows (0.1 + 0.2 is 0.3): a whole number up to 15 digits is kept exactly, any other result
//     is cut to 10 significant digits.

export type CalcKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'decimal' | '+' | '−' | '×' | '÷' | '%' | '=' | 'C' | 'back';

export type CalcState = {
  // The sum being typed: numbers as text with a point, and the operators «+ − × ÷» and «%», in order.
  readonly tokens: readonly string[];
  // After «=»: the sum that was solved (shown above the answer), which is also the one token left.
  readonly solved: readonly string[] | null;
  readonly error: boolean;
};

export const CALC_START: CalcState = Object.freeze({ tokens: Object.freeze([]), solved: null, error: false });

const MAX_DIGITS = 12;
const OPERATORS: readonly string[] = ['+', '−', '×', '÷'];
const isOperator = (token: string | undefined): boolean => token !== undefined && OPERATORS.includes(token);
const isNumber = (token: string | undefined): boolean => token !== undefined && token !== '%' && !isOperator(token);

// A typed character (a physical key) → the calculator's key, or null when it means nothing here.
export function calcKeyFor(character: string): CalcKey | null {
  if (/^[0-9]$/.test(character)) return character as CalcKey;
  switch (character) {
    case ',': case '.': return 'decimal';
    case '+': return '+';
    case '-': case '−': return '−';
    case '*': case 'x': case 'X': case '×': return '×';
    case '/': case '÷': return '÷';
    case '%': return '%';
    case '=': case 'Enter': return '=';
    case 'Backspace': return 'back';
    default: return null;
  }
}

function digitsIn(text: string): number {
  return text.replace(/[^0-9]/g, '').length;
}

export function calcPress(state: CalcState, key: CalcKey): CalcState {
  if (key === 'C') return CALC_START;
  if (state.error) return state;
  // After «=» the answer is the only token: a digit starts a new sum, anything else goes on from the answer.
  const done = state.solved !== null;
  const tokens = state.tokens;
  const last = tokens[tokens.length - 1];
  const next = (list: readonly string[]): CalcState => ({ tokens: list, solved: null, error: false });

  if (key === 'back') {
    if (done || last === undefined) return state;
    if (!isNumber(last)) return next(tokens.slice(0, -1));
    const shorter = last.slice(0, -1);
    return next(shorter === '' || shorter === '-' ? tokens.slice(0, -1) : [...tokens.slice(0, -1), shorter]);
  }

  if (key === 'decimal') {
    if (done || last === undefined || !isNumber(last)) {
      if (last === '%') return state;
      return next([...(done ? [] : tokens), '0.']);
    }
    if (last.includes('.')) return state;
    return next([...tokens.slice(0, -1), `${last}.`]);
  }

  if (key === '=') {
    if (done || tokens.length === 0) return state;
    const answer = calcEvaluate(tokens);
    if (answer === null) return { tokens: [], solved: null, error: true };
    return { tokens: [answer], solved: tokens, error: false };
  }

  if (key === '%') {
    if (last === undefined || !isNumber(last)) return state;
    return next([...tokens, '%']);
  }

  if (isOperator(key)) {
    if (tokens.length === 0) return next(['0', key]);
    if (last === '%' || isNumber(last)) return next([...tokens, key]);
    return next([...tokens.slice(0, -1), key]);
  }

  // A digit.
  if (done || tokens.length === 0) return next([key]);
  if (last === '%') return state;
  if (last === undefined || !isNumber(last)) return next([...tokens, key]);
  if (digitsIn(last) >= MAX_DIGITS) return state;
  // «0» then a digit replaces the zero, so «007» never builds.
  const grown = last === '0' ? key : last === '-0' ? `-${key}` : last + key;
  return next([...tokens.slice(0, -1), grown]);
}

type Factor = { readonly value: number; readonly percent: boolean };
type Term = { readonly add: '+' | '−' | null; readonly factors: Factor[]; readonly ops: string[] };

// The answer as text with a point, or null: a division by zero, a sum that is not a sum, a result of 16 digits or more.
export function calcEvaluate(tokens: readonly string[]): string | null {
  const list = isOperator(tokens[tokens.length - 1]) ? tokens.slice(0, -1) : [...tokens];
  if (list.length === 0) return '0';

  const terms: Term[] = [];
  let term: Term | null = null;
  let expectNumber = true;
  let add: '+' | '−' | null = null;
  for (const token of list) {
    if (expectNumber) {
      const value = Number(token);
      if (!isNumber(token) || !Number.isFinite(value)) return null;
      if (term === null) {
        term = { add, factors: [], ops: [] };
        terms.push(term);
      }
      term.factors.push({ value, percent: false });
      expectNumber = false;
    } else if (token === '%') {
      const factor = term?.factors[term.factors.length - 1];
      if (factor === undefined || factor.percent) return null;
      term?.factors.splice(term.factors.length - 1, 1, { value: factor.value, percent: true });
    } else if (token === '+' || token === '−') {
      add = token;
      term = null;
      expectNumber = true;
    } else if (token === '×' || token === '÷') {
      term?.ops.push(token);
      expectNumber = true;
    } else {
      return null;
    }
  }

  let total = 0;
  for (const part of terms) {
    const first = part.factors[0];
    if (first === undefined) return null;
    let value: number;
    if (part.factors.length === 1 && first.percent) {
      // A lone percentage: of the running total after a + or −, itself over a hundred when it stands first.
      value = part.add === null ? first.value / 100 : total * first.value / 100;
    } else {
      value = first.percent ? first.value / 100 : first.value;
      for (let i = 1; i < part.factors.length; i += 1) {
        const factor = part.factors[i];
        if (factor === undefined) return null;
        const operand = factor.percent ? factor.value / 100 : factor.value;
        if (part.ops[i - 1] === '÷') {
          if (operand === 0) return null;
          value /= operand;
        } else {
          value *= operand;
        }
      }
    }
    total = part.add === '−' ? total - value : total + value;
  }
  return tidy(total);
}

// No float noise, no exponent: a whole number is kept as it is, anything else is cut to 10 significant digits.
function tidy(value: number): string | null {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return null;
  const rounded = Number.isInteger(value) ? value : Number(value.toPrecision(10));
  if (rounded === 0) return '0';
  const text = String(rounded);
  if (!text.includes('e')) return text;
  // A tiny number: String() would write an exponent. Past ten decimals it is nothing.
  const fixed = rounded.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '-0' || fixed === '' ? '0' : fixed;
}

export type CalcDisplay = { readonly expression: string; readonly main: string; readonly error: boolean };

// What the two lines say, with the venue's decimal mark («,» in Italy, «.» in Britain). The small line is the sum, the big line the
// number being typed, or the answer, or the running total while an operator waits. `errorWord` is «Error» in the interface language.
export function calcDisplay(state: CalcState, decimal: string, errorWord: string): CalcDisplay {
  const write = (text: string): string => text.replace('.', decimal);
  const line = (list: readonly string[]): string => list.map(write).join(' ');
  if (state.error) return { expression: '', main: errorWord, error: true };
  if (state.solved !== null) return { expression: `${line(state.solved)} =`, main: write(state.tokens[0] ?? '0'), error: false };
  const tokens = state.tokens;
  const last = tokens[tokens.length - 1];
  if (last === undefined) return { expression: '', main: '0', error: false };
  const main = isNumber(last) ? last : calcEvaluate(tokens) ?? '0';
  return { expression: line(tokens), main: write(main), error: false };
}
