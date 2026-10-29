import { presenceText } from './presence-text';

describe('presenceText', () => {
  it('spells out one to nine people and uses the numeral from ten', () => {
    expect(presenceText(1)).toBe('One person in the control room');
    expect(presenceText(2)).toBe('Two people in the control room');
    expect(presenceText(9)).toBe('Nine people in the control room');
    expect(presenceText(10)).toBe('10 people in the control room');
  });
});
