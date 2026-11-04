import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsController } from './payments.controller.js';
import type { PaymentsService } from './payments.service.js';
import type { Request, Response } from 'express';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let mockPaymentsService: any;
  let mockRes: Partial<Response>;
  let mockReq: Partial<Request>;

  beforeEach(() => {
    mockPaymentsService = {
      processPayment: vi.fn(),
      handleVnpayIpn: vi.fn(),
      verifyVnpayReturn: vi.fn(),
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };

    mockReq = {
      url: '/api/payments',
      originalUrl: '/api/payments',
      headers: {
        'x-forwarded-for': '203.0.113.195',
      },
      socket: {
        remoteAddress: '127.0.0.1',
      } as any,
    };

    controller = new PaymentsController(
      mockPaymentsService as unknown as PaymentsService,
    );
  });

  describe('POST /api/payments', () => {
    it('calls paymentsService.processPayment and sets status code and headers', async () => {
      mockPaymentsService.processPayment.mockResolvedValue({
        isReplayed: true,
        statusCode: 201,
        data: {
          payment: { id: 1, status: 'SUCCESS' },
          order: { id: 10, status: 'PAID' },
        },
      });

      const dto = {
        orderId: 10,
        method: 'VNPAY' as const,
        pointsUsed: 0,
      };

      const result = await controller.processPayment(
        1,
        dto,
        'idemp-key-1',
        mockRes as Response,
        mockReq as Request,
      );

      expect(mockPaymentsService.processPayment).toHaveBeenCalledWith(
        1,
        dto,
        'idemp-key-1',
        '/api/payments',
        '203.0.113.195',
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
      expect(result).toEqual({
        payment: { id: 1, status: 'SUCCESS' },
        order: { id: 10, status: 'PAID' },
      });
    });
  });

  describe('GET /api/payments/vnpay/ipn', () => {
    it('forwards query params to handleVnpayIpn', async () => {
      const query = {
        vnp_TxnRef: '10_1_123',
        vnp_Amount: '5000000',
        vnp_ResponseCode: '00',
        vnp_SecureHash: 'mock_hash',
      };
      mockPaymentsService.handleVnpayIpn.mockResolvedValue({
        RspCode: '00',
        Message: 'Confirm Success',
      });

      const result = await controller.handleVnpayIpn(query);

      expect(mockPaymentsService.handleVnpayIpn).toHaveBeenCalledWith(query);
      expect(result).toEqual({
        RspCode: '00',
        Message: 'Confirm Success',
      });
    });
  });

  describe('GET /api/payments/vnpay/return', () => {
    it('forwards query params to verifyVnpayReturn', async () => {
      const query = {
        vnp_TxnRef: '10_1_123',
        vnp_ResponseCode: '00',
        vnp_SecureHash: 'mock_hash',
      };
      const expectedReturn = {
        isValidSignature: true,
        responseCode: '00',
        payment: { id: 1, status: 'SUCCESS' },
        order: { id: 10, status: 'PAID' },
      };
      mockPaymentsService.verifyVnpayReturn.mockResolvedValue(expectedReturn);

      const result = await controller.handleVnpayReturn(query);

      expect(mockPaymentsService.verifyVnpayReturn).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedReturn);
    });
  });
});
