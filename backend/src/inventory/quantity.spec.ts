import { describe, expect, it } from 'vitest';
import { quantity } from './quantity.js';

describe('ingredient quantities', () => {
  it('preserves exact decimal arithmetic', () => {
    expect(
      quantity('0.1', 'GRAM').plus(quantity('0.2', 'GRAM')).toFixed(3),
    ).toBe('0.300');
    expect(quantity('-1.500', 'GRAM', true).toFixed(3)).toBe('-1.500');
  });
  it.each([
    '0',
    '-1',
    'NaN',
    'Infinity',
    '1e2',
    '0.0001',
    '1000000000000000',
    ' 1',
  ])('rejects invalid quantity %s', (value) => {
    expect(() => quantity(value, 'GRAM')).toThrow();
  });
  it('accepts only whole pieces', () => {
    expect(() => quantity('0.5', 'PIECE')).toThrow();
    expect(quantity('2.000', 'PIECE').toString()).toBe('2');
  });
});
