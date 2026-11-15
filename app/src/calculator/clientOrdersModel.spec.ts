import { describe, expect, it } from 'vitest';
import { isAcceptableCutoff } from './clientOrdersModel';

describe('isAcceptableCutoff', () => {
  it.each(['', '00:00', '07:15', '16:00', '23:59'])('%j can be saved', value => {
    expect(isAcceptableCutoff(value)).toBe(true);
  });

  it.each(['24:00', '12:60', '7:15', '16', '16:00:00', 'noon', ' 16:00', '25:99'])('%j is not a time', value => {
    expect(isAcceptableCutoff(value)).toBe(false);
  });
});
