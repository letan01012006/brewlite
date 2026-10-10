import { Injectable } from '@nestjs/common';
import { PaymentMethod } from './dto/process-payment.dto.js';

export interface ChargeParams {
  amount: number;
  method: PaymentMethod;
  mockResult?: 'SUCCESS' | 'FAILED';
}

export interface ChargeResult {
  success: boolean;
  providerRef?: string;
  failureReason?: string;
}

/**
 * Service giả lập cổng thanh toán không tiền mặt (Momo, VNPay, Stripe)
 * Phục vụ demo và test theo yêu cầu Task 8 & 10
 */
@Injectable()
export class MockPaymentService {
  async charge(params: ChargeParams): Promise<ChargeResult> {
    // 1. Nếu chỉ định cố tình ép kết quả thanh toán thất bại
    if (params.mockResult === 'FAILED') {
      return {
        success: false,
        failureReason: 'GATEWAY_DECLINED: Thẻ ngân hàng bị khóa hoặc số dư ví không đủ để thanh toán',
      };
    }

    // 2. Mặc định thành công: sinh mã giao dịch ngân hàng thực tế (providerRef)
    const randomHex = Math.random().toString(16).substring(2, 8).toUpperCase();
    const prefix = params.method === 'WALLET' ? 'MOCK-WALLET' : 'MOCK-CARD';
    const providerRef = `${prefix}-${randomHex}`;

    return {
      success: true,
      providerRef,
    };
  }
}
