import { describe, expect, it } from 'vitest';
import {
  WELCOME_POINTS,
  VND_PER_LOYALTY_POINT,
  pointsEarnedFor,
} from './voucher-rules.js';

describe('voucher-rules and loyalty points', () => {
  it('defines welcome points as 500 and 1 point per 1000 VND', () => {
    expect(WELCOME_POINTS).toBe(500);
    expect(VND_PER_LOYALTY_POINT).toBe(1000);
  });

  it('calculates loyalty points rounded down to nearest thousand', () => {
    expect(pointsEarnedFor(0)).toBe(0);
    expect(pointsEarnedFor(-5000)).toBe(0);
    expect(pointsEarnedFor(999)).toBe(0);
    expect(pointsEarnedFor(1000)).toBe(1);
    expect(pointsEarnedFor(1999)).toBe(1);
    expect(pointsEarnedFor(40000)).toBe(40);
    expect(pointsEarnedFor(110700)).toBe(110);
    expect(pointsEarnedFor(NaN)).toBe(0);
  });
});

