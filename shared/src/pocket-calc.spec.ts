import { describe, expect, test } from 'vitest';
import { CALC_START, calcDisplay, calcEvaluate, calcKeyFor, calcPress } from './pocket-calc';
import type { CalcKey, CalcState } from './pocket-calc';

// Types a sum the way a person taps it: «12,5 × 3» is ['1', '2', 'decimal', '5', '×', '3'].
function tap(keys: readonly string[]): CalcState {
  return keys.reduce<CalcState>((state, key) => calcPress(state, key as CalcKey), CALC_START);
}
const sum = (text: string): string[] => [...text].map(c => (c === ',' ? 'decimal' : c));
const answer = (text: string): string => calcDisplay(tap([...sum(text), '=']), '.', 'Error').main;

describe('the sum', () => {
  test('× and ÷ come before + and −', () => {
    expect(answer('2+3×4')).toBe('14');
    expect(answer('10−6÷2')).toBe('7');
    expect(answer('2×3+4×5')).toBe('26');
  });

  test('no float noise: 0.1 + 0.2 is 0.3', () => {
    expect(answer('0,1+0,2')).toBe('0.3');
    expect(answer('1÷3')).toBe('0.333333333333');
  });

  test('a result keeps at most 12 significant digits, a whole number stays exact', () => {
    expect(answer('2÷3')).toBe('0.666666666667');
    expect(calcEvaluate(['123456789012', '+', '1'])).toBe('123456789013');
  });

  test('never a rounded-looking wrong answer: 12345678901.5 stays whole, and a result that cannot show its whole part is an error', () => {
    expect(calcEvaluate(['12345678901.5', '+', '0'])).toBe('12345678901.5');
    expect(calcEvaluate(['1234567890123', '+', '0.5'])).toBeNull();
  });

  test('a result of 16 digits is an error', () => {
    expect(calcEvaluate(['999999999999', '×', '999999999999'])).toBeNull();
  });

  test('a sum can go negative', () => {
    expect(answer('2−5')).toBe('-3');
  });

  test('a trailing operator is dropped by =', () => {
    expect(answer('7+')).toBe('7');
  });
});

describe('percent, the phone-calculator way', () => {
  test('a + b% is a + a·b/100, and a − b% takes it off', () => {
    expect(answer('200+10%')).toBe('220');
    expect(answer('200−10%')).toBe('180');
  });

  test('the a of a longer sum is the running total', () => {
    expect(answer('100+50+10%')).toBe('165');
  });

  test('a × b% is a·b/100 and a ÷ b% divides by b/100', () => {
    expect(answer('200×10%')).toBe('20');
    expect(answer('5÷50%')).toBe('10');
  });

  test('a lone x% is x/100', () => {
    expect(answer('50%')).toBe('0.5');
  });

  test('a percent after + or − becomes a·b/100, after × or ÷ b/100, and then the usual precedence applies', () => {
    expect(answer('200+10%×2')).toBe('240');
    expect(answer('200−10%×2')).toBe('160');
    expect(answer('2×10%+5')).toBe('5.2');
    expect(answer('3+200×10%')).toBe('23');
  });

  test('% needs a number in front of it', () => {
    expect(tap(['%']).tokens).toEqual([]);
    expect(tap(['5', '+', '%']).tokens).toEqual(['5', '+']);
  });
});

describe('the keys', () => {
  test('an operator typed after an operator replaces it', () => {
    expect(tap(['5', '+', '×', '3']).tokens).toEqual(['5', '×', '3']);
    expect(answer('5+×3')).toBe('15');
  });

  test('an operator first starts from zero', () => {
    expect(tap(['+', '4']).tokens).toEqual(['0', '+', '4']);
  });

  test('= again, or on nothing, changes nothing', () => {
    const once = tap(['2', '+', '3', '=']);
    expect(calcPress(once, '=')).toBe(once);
    expect(calcPress(CALC_START, '=')).toBe(CALC_START);
  });

  test('a digit after = starts a new sum, an operator goes on from the answer', () => {
    expect(tap(['2', '+', '3', '=', '7']).tokens).toEqual(['7']);
    expect(tap(['2', '+', '3', '=', '×', '2', '=']).tokens).toEqual(['10']);
  });

  test('the solved sum is shown above the answer', () => {
    const shown = calcDisplay(tap(['2', '+', '3', '=']), ',', 'Errore');
    expect(shown).toEqual({ expression: '2 + 3 =', main: '5', error: false });
  });

  test('no leading zeros, one decimal mark, a mark first reads 0.', () => {
    expect(tap(['0', '0', '7']).tokens).toEqual(['7']);
    expect(tap(['1', 'decimal', '5', 'decimal', '2']).tokens).toEqual(['1.52']);
    expect(tap(['decimal', '5']).tokens).toEqual(['0.5']);
    expect(tap(['4', '+', 'decimal', '5']).tokens).toEqual(['4', '+', '0.5']);
  });

  test('a number holds at most 10 digits, so 12345678901.5 cannot even be typed', () => {
    expect(tap(sum('12345678901234')).tokens).toEqual(['1234567890']);
    expect(tap(sum('12345678901,5')).tokens).toEqual(['1234567890.']);
  });

  test('backspace takes the last character, then the last operator', () => {
    expect(tap(['1', '2', 'back']).tokens).toEqual(['1']);
    expect(tap(['1', '+', 'back']).tokens).toEqual(['1']);
    expect(tap(['1', 'back']).tokens).toEqual([]);
    expect(tap(['1', '0', '%', 'back']).tokens).toEqual(['10']);
  });

  test('backspace on an answer does nothing', () => {
    const solved = tap(['2', '+', '3', '=']);
    expect(calcPress(solved, 'back')).toBe(solved);
  });

  test('C clears everything', () => {
    expect(tap(['2', '+', '3', 'C'])).toBe(CALC_START);
  });
});

describe('division by zero', () => {
  test('shows the error word until C', () => {
    const broken = tap(['5', '÷', '0', '=']);
    expect(calcDisplay(broken, ',', 'Errore')).toEqual({ expression: '', main: 'Errore', error: true });
    expect(calcPress(broken, '7')).toBe(broken);
    expect(calcPress(broken, '+')).toBe(broken);
    expect(calcPress(broken, 'C')).toBe(CALC_START);
  });

  test('also inside a longer sum and with a zero percent', () => {
    expect(calcEvaluate(['4', '+', '2', '÷', '0'])).toBeNull();
    expect(calcEvaluate(['4', '÷', '0', '%'])).toBeNull();
  });
});

describe('the display', () => {
  test('writes the venue’s decimal mark', () => {
    expect(calcDisplay(tap(['1', 'decimal', '5', '×', '2']), ',', 'Errore')).toEqual({ expression: '1,5 × 2', main: '2', error: false });
    expect(calcDisplay(tap(['1', 'decimal', '5']), '.', 'Error').main).toBe('1.5');
  });

  test('shows zero with nothing typed', () => {
    expect(calcDisplay(CALC_START, ',', 'Errore')).toEqual({ expression: '', main: '0', error: false });
  });

  test('while an operator waits: after + or − the total so far, after × or ÷ the number about to be multiplied (2 + 3 × shows 3, never 5)', () => {
    expect(calcDisplay(tap(['2', '+', '3', '×']), ',', 'Errore').main).toBe('3');
    expect(calcDisplay(tap(['2', '+', '3', '+']), ',', 'Errore').main).toBe('5');
    expect(calcDisplay(tap(['2', '×', '3', '+', '4', '÷']), ',', 'Errore').main).toBe('4');
    expect(calcDisplay(tap(['2', '×', '3', '+']), ',', 'Errore').main).toBe('6');
  });
});

describe('typed characters', () => {
  test('map to keys', () => {
    expect(calcKeyFor('7')).toBe('7');
    expect(calcKeyFor(',')).toBe('decimal');
    expect(calcKeyFor('.')).toBe('decimal');
    expect(calcKeyFor('-')).toBe('−');
    expect(calcKeyFor('*')).toBe('×');
    expect(calcKeyFor('/')).toBe('÷');
    expect(calcKeyFor('%')).toBe('%');
    expect(calcKeyFor('Enter')).toBe('=');
    expect(calcKeyFor('=')).toBe('=');
    expect(calcKeyFor('Backspace')).toBe('back');
    expect(calcKeyFor('q')).toBeNull();
  });
});
