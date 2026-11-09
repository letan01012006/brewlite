import { describe, expect, it } from 'vitest';
import {
  WELCOME_POINTS,
  VND_PER_LOYALTY_POINT,
  POINTS_STEP,
  VND_PER_STEP,
  pointsEarnedFor,
  pointsToDiscountVnd,
} from './voucher-rules.js';

describe('voucher-rules and loyalty points', () => {
  it('defines welcome points as 1000 and 1 point per 1000 VND', () => {
    expect(WELCOME_POINTS).toBe(1000);
    expect(VND_PER_LOYALTY_POINT).toBe(1000);
    expect(POINTS_STEP).toBe(20);
    expect(VND_PER_STEP).toBe(1000);
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

  it('calculates points redemption discount correctly (20 pts = 1000 VND)', () => {
    expect(pointsToDiscountVnd(0)).toBe(0);
    expect(pointsToDiscountVnd(-20)).toBe(0);
    expect(pointsToDiscountVnd(19)).toBe(0);
    expect(pointsToDiscountVnd(20)).toBe(1000);
    expect(pointsToDiscountVnd(39)).toBe(1000);
    expect(pointsToDiscountVnd(40)).toBe(2000);
    expect(pointsToDiscountVnd(100)).toBe(5000);
    expect(pointsToDiscountVnd(1000)).toBe(50000);
  });
});

