import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MockPaymentService } from './mock-payment.service.js';
import type { VnpayGateway } from './vnpay/vnpay.gateway.js';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPrisma: any;
  let mockPaymentService: any;
  let mockVnpayGateway: any;
  let txMock: any;

  beforeEach(() => {
    txMock = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      payment: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      },
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      user: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
      },
      loyaltyTransaction: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      paymentRefund: {
        create: vi.fn(),
      },
      paymentWebhookLog: {
        create: vi.fn(),
      },
    };

    mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(txMock)),
      payment: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      paymentWebhookLog: {
        create: vi.fn().mockResolvedValue({ id: 1 }),
      },
    };

    mockPaymentService = {
      charge: vi.fn().mockResolvedValue({
        success: true,
        providerRef: 'MOCK_REF_123',
      }),
    };

    mockVnpayGateway = {
      createPaymentUrl: vi.fn().mockReturnValue('https://sandbox.vnpayment.vn/test-payment-url'),
      verifyIpn: vi.fn().mockReturnValue(true),
    };

    service = new PaymentsService(
      mockPrisma as unknown as PrismaService,
      mockPaymentService as unknown as MockPaymentService,
      mockVnpayGateway as unknown as VnpayGateway,
    );
  });

  describe('processPayment validations', () => {
    it('throws BadRequestException if idempotencyKey is missing', async () => {
      await expect(
        service.processPayment(1, { orderId: 10, method: 'VNPAY' }, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if order does not exist', async () => {
      txMock.order.findUnique.mockResolvedValue(null);

      await expect(
        service.processPayment(1, {
          orderId: 999,
          method: 'VNPAY',
          idempotencyKey: 'key-123',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if order belongs to another user', async () => {
      txMock.order.findUnique.mockResolvedValue({
        id: 10,
        userId: 99, // Different user
        status: 'PENDING',
        total: 50000,
      });

      await expect(
        service.processPayment(1, {
          orderId: 10,
          method: 'VNPAY',
          idempotencyKey: 'key-123',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException if order is not payable (e.g. already PAID or CANCELLED)', async () => {
      txMock.order.findUnique.mockResolvedValue({
        id: 10,
        userId: 1,
        status: 'PAID',
        total: 50000,
      });

      await expect(
        service.processPayment(1, {
          orderId: 10,
          method: 'VNPAY',
          idempotencyKey: 'key-123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if pointsUsed is not a multiple of 20', async () => {
      txMock.order.findUnique.mockResolvedValue({
        id: 10,
        userId: 1,
        status: 'PENDING',
        total: 50000,
      });

      await expect(
        service.processPayment(1, {
          orderId: 10,
          method: 'VNPAY',
          pointsUsed: 25, // Not multiple of 20
          idempotencyKey: 'key-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if user has insufficient loyalty points', async () => {
      txMock.order.findUnique.mockResolvedValue({
        id: 10,
        userId: 1,
        status: 'PENDING',
        total: 50000,
      });
      // updateMany returns count: 0 when points < required
      txMock.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.processPayment(1, {
          orderId: 10,
          method: 'VNPAY',
          pointsUsed: 100,
          idempotencyKey: 'key-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if method is POINTS but points do not cover 100% of order total', async () => {
      txMock.order.findUnique.mockResolvedValue({
        id: 10,
        userId: 1,
        status: 'PENDING',
        total: 50000,
      });

      // 500 points = 25.000 VND < 50.000 VND
      await expect(
        service.processPayment(1, {
          orderId: 10,
          method: 'POINTS',
          pointsUsed: 500,
          idempotencyKey: 'key-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if VNPAY remaining cash is between 0 and 5.000 VND', async () => {
      txMock.order.findUnique.mockResolvedValue({
        id: 10,
        userId: 1,
        status: 'PENDING',
        total: 50000,
      });

      // 940 points = 47.000 VND discount -> remaining cash = 3.000 VND (< 5.000 VND)
      await expect(
        service.processPayment(1, {
          orderId: 10,
          method: 'VNPAY',
          pointsUsed: 940,
          idempotencyKey: 'key-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processPayment with 100% POINTS', () => {
    it('successfully pays 100% with points, creates REDEEM ledger entry, and marks order PAID with 0 points earned', async () => {
      const order = {
        id: 10,
        userId: 1,
        status: 'PENDING',
        total: 50000,
      };
      txMock.order.findUnique.mockResolvedValue(order);
      // 1000 points = 50.000 VND (100% of order)
      txMock.user.updateMany.mockResolvedValue({ count: 1 });
      txMock.payment.create.mockResolvedValue({
        id: 55,
        orderId: 10,
        amount: 0,
        pointsUsed: 1000,
        pointsAmount: 50000,
        method: 'POINTS',
        status: 'PROCESSING',
      });

      const result = await service.processPayment(1, {
        orderId: 10,
        method: 'POINTS',
        pointsUsed: 1000,
        idempotencyKey: 'points-key-1',
      });

      expect(result.statusCode).toBe(201);
      // Check user points deducted
      expect(txMock.user.updateMany).toHaveBeenCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 1000 } },
        data: { loyaltyPoints: { decrement: 1000 } },
      });
      // Check REDEEM ledger entry created
      expect(txMock.loyaltyTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          orderId: 10,
          paymentId: 55,
          type: 'REDEEM',
          points: -1000,
          pointsAmount: 50000,
        },
      });
      // Check payment marked SUCCESS
      expect(txMock.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 55 },
          data: expect.objectContaining({
            status: 'SUCCESS',
            providerRef: 'POINTS_55',
          }),
        }),
      );
      // Check order marked PAID with 0 points earned
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: 'PAID', pointsEarned: 0 },
      });
    });
  });

  describe('processPayment with VNPAY', () => {
    it('creates PROCESSING payment, records REDEEM if partial points used, and returns signed paymentUrl', async () => {
      const order = {
        id: 20,
        userId: 2,
        status: 'PENDING',
        total: 100000,
      };
      txMock.order.findUnique.mockResolvedValue(order);
      // Use 400 points = 20.000 VND discount -> realVndAmount = 80.000 VND
      txMock.user.updateMany.mockResolvedValue({ count: 1 });
      const createdPayment = {
        id: 77,
        orderId: 20,
        amount: 80000,
        pointsUsed: 400,
        pointsAmount: 20000,
        method: 'VNPAY',
        status: 'PROCESSING',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      };
      txMock.payment.create.mockResolvedValue(createdPayment);

      const result = await service.processPayment(
        2,
        {
          orderId: 20,
          method: 'VNPAY',
          pointsUsed: 400,
          idempotencyKey: 'vnpay-key-1',
        },
        undefined,
        '/api/payments',
        '118.69.123.45',
      );

      expect(result.statusCode).toBe(201);
      expect((result.data as any).paymentUrl).toBe(
        'https://sandbox.vnpayment.vn/test-payment-url',
      );
      expect(mockVnpayGateway.createPaymentUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 80000,
          ipAddr: '118.69.123.45',
        }),
      );
      // User points held
      expect(txMock.user.updateMany).toHaveBeenCalledWith({
        where: { id: 2, loyaltyPoints: { gte: 400 } },
        data: { loyaltyPoints: { decrement: 400 } },
      });
      // Ledger recorded
      expect(txMock.loyaltyTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 2,
          orderId: 20,
          paymentId: 77,
          type: 'REDEEM',
          points: -400,
          pointsAmount: 20000,
        },
      });
      // Payment updated with gatewayTxnRef
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 77 },
          data: expect.objectContaining({
            providerRef: expect.stringContaining('20_77_'),
          }),
        }),
      );
    });
  });

  describe('handleVnpayIpn', () => {
    it('returns RspCode 97 and logs webhook when checksum signature is invalid', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(false);

      const query = {
        vnp_TxnRef: '10_55_123',
        vnp_Amount: '5000000',
        vnp_ResponseCode: '00',
        vnp_SecureHash: 'invalid_hash',
      };

      const result = await service.handleVnpayIpn(query);

      expect(result).toEqual({ RspCode: '97', Message: 'Invalid signature' });
      expect(mockPrisma.paymentWebhookLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signatureValid: false,
          processed: false,
          message: 'Invalid checksum signature',
        }),
      });
    });

    it('returns RspCode 01 when payment record is not found', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(true);
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      const query = {
        vnp_TxnRef: 'UNKNOWN_REF',
        vnp_Amount: '5000000',
        vnp_ResponseCode: '00',
        vnp_SecureHash: 'valid_hash',
      };

      const result = await service.handleVnpayIpn(query);

      expect(result).toEqual({ RspCode: '01', Message: 'Order not found' });
      expect(mockPrisma.paymentWebhookLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signatureValid: true,
          processed: false,
          message: 'Order payment not found',
        }),
      });
    });

    it('returns RspCode 04 when IPN amount does not match payment amount', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(true);
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 88,
        amount: 80000, // Expected 80.000 VND
        gatewayTxnRef: '20_88_123',
      });

      const query = {
        vnp_TxnRef: '20_88_123',
        vnp_Amount: '5000000', // 50.000 VND (*100) -> mismatch!
        vnp_ResponseCode: '00',
        vnp_SecureHash: 'valid_hash',
      };

      const result = await service.handleVnpayIpn(query);

      expect(result).toEqual({ RspCode: '04', Message: 'Invalid amount' });
      expect(mockPrisma.paymentWebhookLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          processed: false,
          message: expect.stringContaining('Invalid amount'),
        }),
      });
    });

    it('returns RspCode 02 on idempotent replay when transaction is already completed', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(true);
      const existingPayment = {
        id: 88,
        orderId: 20,
        amount: 80000,
        gatewayTxnRef: '20_88_123',
        status: 'SUCCESS', // Already success!
      };
      mockPrisma.payment.findUnique.mockResolvedValue(existingPayment);
      txMock.payment.findUnique.mockResolvedValue(existingPayment);
      txMock.order.findUnique.mockResolvedValue({ id: 20, status: 'PAID' });

      const query = {
        vnp_TxnRef: '20_88_123',
        vnp_Amount: '8000000',
        vnp_ResponseCode: '00',
        vnp_TransactionNo: '145999',
        vnp_SecureHash: 'valid_hash',
      };

      const result = await service.handleVnpayIpn(query);

      expect(result).toEqual({ RspCode: '02', Message: 'Order already confirmed' });
      expect(txMock.paymentWebhookLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          processed: false,
          message: 'Order already confirmed (Idempotent replay)',
        }),
      });
    });

    it('successfully confirms payment when responseCode is 00: marks payment SUCCESS and order PAID', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(true);
      const pendingPayment = {
        id: 88,
        orderId: 20,
        amount: 80000,
        pointsUsed: 400,
        pointsAmount: 20000,
        gatewayTxnRef: '20_88_123',
        status: 'PROCESSING',
      };
      const order = {
        id: 20,
        status: 'PENDING',
        total: 100000,
      };
      mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);
      txMock.payment.findUnique.mockResolvedValue(pendingPayment);
      txMock.order.findUnique.mockResolvedValue(order);

      const query = {
        vnp_TxnRef: '20_88_123',
        vnp_Amount: '8000000',
        vnp_ResponseCode: '00',
        vnp_TransactionNo: '145999',
        vnp_BankCode: 'NCB',
        vnp_SecureHash: 'valid_hash',
      };

      const result = await service.handleVnpayIpn(query);

      expect(result).toEqual({ RspCode: '00', Message: 'Confirm Success' });
      // Payment marked SUCCESS
      expect(txMock.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 88 },
          data: expect.objectContaining({
            status: 'SUCCESS',
            gatewayTransactionNo: '145999',
            gatewayBankCode: 'NCB',
          }),
        }),
      );
      // Order marked PAID
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: { status: 'PAID' },
      });
      // Webhook logged as processed
      expect(txMock.paymentWebhookLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signatureValid: true,
          processed: true,
          message: 'Payment confirmed successfully',
        }),
      });
    });

    it('handles payment failure (e.g. code 24): marks payment FAILED, order PAYMENT_FAILED, and refunds used points', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(true);
      const pendingPayment = {
        id: 88,
        orderId: 20,
        amount: 80000,
        pointsUsed: 400,
        pointsAmount: 20000,
        gatewayTxnRef: '20_88_123',
        status: 'PROCESSING',
      };
      const order = {
        id: 20,
        userId: 5,
        status: 'PENDING',
        total: 100000,
      };
      mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);
      txMock.payment.findUnique.mockResolvedValue(pendingPayment);
      txMock.order.findUnique.mockResolvedValue(order);
      txMock.loyaltyTransaction.findFirst.mockResolvedValue(null); // No existing refund

      const query = {
        vnp_TxnRef: '20_88_123',
        vnp_Amount: '8000000',
        vnp_ResponseCode: '24', // Customer cancelled
        vnp_TransactionNo: '145999',
        vnp_SecureHash: 'valid_hash',
      };

      const result = await service.handleVnpayIpn(query);

      expect(result).toEqual({ RspCode: '00', Message: 'Confirm Success' });
      // Payment marked FAILED
      expect(txMock.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 88 },
          data: expect.objectContaining({
            status: 'FAILED',
            failureReason: 'VNPAY failed with code 24',
          }),
        }),
      );
      // Order marked PAYMENT_FAILED
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: { status: 'PAYMENT_FAILED' },
      });
      // User refunded 400 points
      expect(txMock.user.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { loyaltyPoints: { increment: 400 } },
      });
      // REFUND ledger transaction recorded
      expect(txMock.loyaltyTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 5,
          orderId: 20,
          paymentId: 88,
          type: 'REFUND',
          points: 400,
          pointsAmount: 20000,
        },
      });
    });

    it('creates PaymentRefund record if payment arrives late after order was CANCELLED', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(true);
      const pendingPayment = {
        id: 88,
        orderId: 20,
        amount: 80000,
        gatewayTxnRef: '20_88_123',
        status: 'PROCESSING',
      };
      const cancelledOrder = {
        id: 20,
        status: 'CANCELLED', // Cancelled order
        total: 100000,
      };
      mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);
      txMock.payment.findUnique.mockResolvedValue(pendingPayment);
      txMock.order.findUnique.mockResolvedValue(cancelledOrder);

      const query = {
        vnp_TxnRef: '20_88_123',
        vnp_Amount: '8000000',
        vnp_ResponseCode: '00',
        vnp_TransactionNo: '998877',
        vnp_SecureHash: 'valid_hash',
      };

      const result = await service.handleVnpayIpn(query);

      expect(result).toEqual({ RspCode: '00', Message: 'Confirm Success' });
      expect(txMock.paymentRefund.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentId: 88,
          amount: 80000,
          status: 'PENDING',
          gatewayRefundNo: '998877',
          failureReason: 'LATE_PAYMENT_AFTER_CANCEL_OR_EXPIRY',
        }),
      });
    });
  });

  describe('verifyVnpayReturn', () => {
    it('returns verification result with payment and order data', async () => {
      mockVnpayGateway.verifyIpn.mockReturnValue(true);
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 88,
        orderId: 20,
        amount: 80000,
        pointsUsed: 400,
        pointsAmount: 20000,
        status: 'SUCCESS',
        method: 'VNPAY',
        order: {
          id: 20,
          status: 'PAID',
          total: 100000,
        },
      });

      const result = await service.verifyVnpayReturn({
        vnp_TxnRef: '20_88_123',
        vnp_ResponseCode: '00',
      });

      expect(result).toEqual({
        isValidSignature: true,
        responseCode: '00',
        payment: {
          id: 88,
          orderId: 20,
          amount: 80000,
          pointsUsed: 400,
          pointsAmount: 20000,
          status: 'SUCCESS',
          method: 'VNPAY',
        },
        order: {
          id: 20,
          status: 'PAID',
          total: 100000,
        },
      });
    });
  });
});
