import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildPaymentUrl,
  buildQuerydrPayload,
  buildRefundPayload,
  verifyVnpaySignature,
  type VnpayConfig,
} from './vnpay.util.js';

export interface VnpayQueryResult {
  raw: Record<string, unknown>;
  responseCode: string;
  transactionStatus?: string;
  transactionType?: string;
  transactionNo?: string;
  bankCode?: string;
  cardType?: string;
  payDate?: string;
  amount?: number;
  success: boolean;
  message?: string;
}

export interface VnpayRefundResult {
  raw: Record<string, unknown>;
  responseCode: string;
  refundNo?: string;
  success: boolean;
  pending?: boolean;
  failureReason?: string;
}

@Injectable()
export abstract class VnpayGateway {
  abstract isConfigured(): boolean;

  abstract createPaymentUrl(params: {
    orderId: number;
    paymentId: number;
    amount: number;
    ipAddr: string;
    orderInfo?: string;
    bankCode?: string;
  }): {
    paymentUrl: string;
    txnRef: string;
    vnpCreateDate: string;
    expiresAt: Date;
  };

  abstract verifySignature(params: Record<string, unknown>): boolean;

  abstract queryTransaction(params: {
    txnRef: string;
    transactionDate: string;
    ipAddr?: string;
  }): Promise<VnpayQueryResult>;

  abstract refund(params: {
    requestId?: string;
    txnRef: string;
    amount: number;
    transactionDate: string;
    transactionNo?: string;
    createBy: string;
    ipAddr?: string;
  }): Promise<VnpayRefundResult>;
}

@Injectable()
export class DefaultVnpayGateway extends VnpayGateway {
  private config: VnpayConfig;

  constructor(private readonly configService: ConfigService) {
    super();
    this.config = {
      tmnCode: this.configService.get<string>('VNPAY_TMN_CODE', '').trim(),
      hashSecret: this.configService
        .get<string>('VNPAY_HASH_SECRET', '')
        .trim(),
      payUrl: this.configService
        .get<string>(
          'VNPAY_PAY_URL',
          'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
        )
        .trim(),
      apiUrl: this.configService
        .get<string>(
          'VNPAY_API_URL',
          'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
        )
        .trim(),
      returnUrl: this.configService
        .get<string>(
          'VNPAY_RETURN_URL',
          'http://localhost:3000/payment/vnpay-return',
        )
        .trim(),
      expireMinutes: Number(
        this.configService.get<number>('PAYMENT_EXPIRE_MINUTES', 15),
      ),
      defaultBankCode: this.configService
        .get<string>('VNPAY_DEFAULT_BANKCODE', '')
        .trim(),
    };
  }

  isConfigured(): boolean {
    const isCredential = (value: string) =>
      Boolean(value) &&
      !/^(?:sandbox[_-]|test[_-]|your[_-]|replace|change|example|placeholder|<)/i.test(
        value,
      ) &&
      !/^(?:tmn[_-]?code|hash[_-]?secret)$/i.test(value);
    return (
      isCredential(this.config.tmnCode) && isCredential(this.config.hashSecret)
    );
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'VNPAY_NOT_CONFIGURED',
        message:
          'Cổng thanh toán VNPAY chưa được cấu hình đầy đủ (thiếu TMN Code hoặc Hash Secret)',
      });
    }
  }

  createPaymentUrl(params: {
    orderId: number;
    paymentId: number;
    amount: number;
    ipAddr: string;
    orderInfo?: string;
    bankCode?: string;
  }) {
    this.assertConfigured();
    return buildPaymentUrl(this.config, params);
  }

  verifySignature(params: Record<string, unknown>): boolean {
    if (!this.isConfigured()) return false;
    return verifyVnpaySignature(params, this.config.hashSecret);
  }

  async queryTransaction(params: {
    txnRef: string;
    transactionDate: string;
    ipAddr?: string;
  }): Promise<VnpayQueryResult> {
    this.assertConfigured();
    const requestId = `QDR${Date.now()}`;
    const payload = buildQuerydrPayload(this.config, {
      requestId,
      txnRef: params.txnRef,
      transactionDate: params.transactionDate,
      ipAddr: params.ipAddr || '127.0.0.1',
    });

    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          raw: {},
          responseCode: '99',
          success: false,
          message: `VNPAY querydr HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const responseCode = String(data['vnp_ResponseCode'] ?? '99');
      const transactionStatus = data['vnp_TransactionStatus']
        ? String(data['vnp_TransactionStatus'])
        : undefined;

      const isSuccess = responseCode === '00' && transactionStatus === '00';

      return {
        raw: data,
        responseCode,
        transactionStatus,
        transactionType:
          typeof data['vnp_TransactionType'] === 'string'
            ? data['vnp_TransactionType']
            : undefined,
        transactionNo: data['vnp_TransactionNo']
          ? String(data['vnp_TransactionNo'])
          : undefined,
        bankCode: data['vnp_BankCode']
          ? String(data['vnp_BankCode'])
          : undefined,
        cardType: data['vnp_CardType']
          ? String(data['vnp_CardType'])
          : undefined,
        payDate: data['vnp_PayDate'] ? String(data['vnp_PayDate']) : undefined,
        amount: data['vnp_Amount']
          ? Number(data['vnp_Amount']) / 100
          : undefined,
        success: isSuccess,
        message: data['vnp_Message'] ? String(data['vnp_Message']) : undefined,
      };
    } catch (error) {
      return {
        raw: {},
        responseCode: '99',
        success: false,
        message:
          error instanceof Error ? error.message : 'Lỗi kết nối cổng VNPAY',
      };
    }
  }

  async refund(params: {
    requestId?: string;
    txnRef: string;
    amount: number;
    transactionDate: string;
    transactionNo?: string;
    createBy: string;
    ipAddr?: string;
  }): Promise<VnpayRefundResult> {
    this.assertConfigured();
    const requestId = params.requestId ?? `REF${Date.now()}`;
    const payload = buildRefundPayload(this.config, {
      requestId,
      txnRef: params.txnRef,
      amount: params.amount,
      transactionDate: params.transactionDate,
      transactionNo: params.transactionNo,
      createBy: params.createBy,
      ipAddr: params.ipAddr || '127.0.0.1',
    });

    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          raw: {},
          responseCode: '99',
          success: false,
          failureReason: `VNPAY refund HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const responseCode = String(data['vnp_ResponseCode'] ?? '99');
      const transactionStatus = String(data['vnp_TransactionStatus'] ?? '');
      const isSuccess = responseCode === '00' && transactionStatus === '00';

      return {
        raw: data,
        responseCode,
        refundNo: data['vnp_TransactionNo']
          ? String(data['vnp_TransactionNo'])
          : undefined,
        success: isSuccess,
        pending: responseCode === '00' && !isSuccess,
        failureReason: isSuccess
          ? undefined
          : String(data['vnp_Message'] ?? `Mã lỗi phản hồi: ${responseCode}`),
      };
    } catch (error) {
      return {
        raw: {},
        responseCode: '99',
        success: false,
        failureReason:
          error instanceof Error ? error.message : 'Lỗi kết nối cổng VNPAY',
      };
    }
  }
}
