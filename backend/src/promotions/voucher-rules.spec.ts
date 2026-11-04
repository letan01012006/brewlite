import { describe, it, expect } from 'vitest';
import {
  POINTS_STEP,
  VND_PER_STEP,
  EARN_RATE_VND,
  pointsNeededFor,
  pointsToVnd,
  calculatePointsDiscount,
  pointsEarnedFor,
} from './voucher-rules.js';

describe('Voucher & Loyalty Points Rules', () => {
  describe('Constants', () => {
    it('has correct conversion constants (20 points = 1.000 VND)', () => {
      expect(POINTS_STEP).toBe(20);
      expect(VND_PER_STEP).toBe(1000);
      expect(EARN_RATE_VND).toBe(1000);
    });
  });

  describe('pointsNeededFor', () => {
    it('returns 0 for zero or negative VND amounts', () => {
      expect(pointsNeededFor(0)).toBe(0);
      expect(pointsNeededFor(-1000)).toBe(0);
      expect(pointsNeededFor(-50000)).toBe(0);
    });

    it('calculates points needed rounded up to nearest 20 points step', () => {
      // 1.000 VND -> 1 step = 20 points
      expect(pointsNeededFor(1000)).toBe(20);
      // 1 VND -> 1 step = 20 points
      expect(pointsNeededFor(1)).toBe(20);
      // 1.001 VND -> 2 steps = 40 points
      expect(pointsNeededFor(1001)).toBe(40);
      // 25.000 VND -> 25 steps = 500 points
      expect(pointsNeededFor(25000)).toBe(500);
      // 55.500 VND -> 56 steps = 1120 points
      expect(pointsNeededFor(55500)).toBe(1120);
    });
  });

  describe('pointsToVnd', () => {
    it('returns 0 for zero or negative points', () => {
      expect(pointsToVnd(0)).toBe(0);
      expect(pointsToVnd(-20)).toBe(0);
      expect(pointsToVnd(-100)).toBe(0);
    });

    it('discards points that do not form a full step of 20 points', () => {
      expect(pointsToVnd(19)).toBe(0);
      expect(pointsToVnd(39)).toBe(1000);
    });

    it('converts points to VND in exact 1.000 VND multiples', () => {
      expect(pointsToVnd(20)).toBe(1000);
      expect(pointsToVnd(40)).toBe(2000);
      expect(pointsToVnd(100)).toBe(5000);
      expect(pointsToVnd(500)).toBe(25000);
      // 250 points = 12 steps of 20 (240 points) = 12.000 VND
      expect(pointsToVnd(250)).toBe(12000);
    });
  });

  describe('calculatePointsDiscount', () => {
    it('returns 0 valid points and 0 discount when points or payable amount is zero/negative', () => {
      expect(calculatePointsDiscount(0, 50000)).toEqual({
        validPoints: 0,
        discountVnd: 0,
      });
      expect(calculatePointsDiscount(-40, 50000)).toEqual({
        validPoints: 0,
        discountVnd: 0,
      });
      expect(calculatePointsDiscount(100, 0)).toEqual({
        validPoints: 0,
        discountVnd: 0,
      });
      expect(calculatePointsDiscount(100, -1000)).toEqual({
        validPoints: 0,
        discountVnd: 0,
      });
    });

    it('calculates full valid discount when points are within order payable amount', () => {
      const result = calculatePointsDiscount(100, 50000);
      expect(result).toEqual({
        validPoints: 100,
        discountVnd: 5000,
      });
    });

    it('rounds down non-step points when calculating discount', () => {
      const result = calculatePointsDiscount(115, 50000);
      expect(result).toEqual({
        validPoints: 100,
        discountVnd: 5000,
      });
    });

    it('clamps discount and points when points exceed order payable amount', () => {
      // 1000 points = 50.000 VND, but order is only 30.000 VND
      const result = calculatePointsDiscount(1000, 30000);
      expect(result).toEqual({
        validPoints: 600, // 30.000 VND / 1000 * 20 = 600 points
        discountVnd: 30000,
      });
    });

    it('clamps discount to step boundary when order total is not a multiple of 1.000 VND', () => {
      // 1000 points = 50.000 VND, but order is 30.500 VND
      const result = calculatePointsDiscount(1000, 30500);
      expect(result).toEqual({
        validPoints: 600,
        discountVnd: 30000,
      });
    });
  });

  describe('pointsEarnedFor', () => {
    it('returns 0 for zero or negative real VND amount', () => {
      expect(pointsEarnedFor(0)).toBe(0);
      expect(pointsEarnedFor(-5000)).toBe(0);
    });

    it('awards 1 point per 1.000 VND of real cash spent', () => {
      expect(pointsEarnedFor(999)).toBe(0);
      expect(pointsEarnedFor(1000)).toBe(1);
      expect(pointsEarnedFor(1500)).toBe(1);
      expect(pointsEarnedFor(2000)).toBe(2);
      expect(pointsEarnedFor(45000)).toBe(45);
      expect(pointsEarnedFor(100000)).toBe(100);
    });
  });
});
