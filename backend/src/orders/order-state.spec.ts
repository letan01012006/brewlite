import { ConflictException } from '@nestjs/common';
import { assertTransition } from './order-state.js';
import type { OrderStatus } from './dto/update-order-status.dto.js';

describe('Order state machine', () => {
  it.each<[OrderStatus, OrderStatus]>([
    ['PENDING', 'PAID'],
    ['PENDING', 'PAYMENT_FAILED'],
    ['PENDING', 'CANCELLED'],
    ['PAYMENT_FAILED', 'PAID'],
    ['PAYMENT_FAILED', 'CANCELLED'],
    ['PAID', 'PREPARING'],
    ['PAID', 'CANCELLED'],
    ['PREPARING', 'READY'],
    ['READY', 'COMPLETED'],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each<[OrderStatus, OrderStatus]>([
    ['PENDING', 'READY'],
    ['COMPLETED', 'PAID'],
    ['CANCELLED', 'PENDING'],
    ['PREPARING', 'CANCELLED'],
    ['READY', 'PREPARING'],
    ['PAID', 'PAID'],
  ])('rejects %s -> %s with a stable business error', (from, to) => {
    try {
      assertTransition(from, to);
      expect.fail('Expected an invalid transition');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'INVALID_TRANSITION',
      });
    }
  });
});
