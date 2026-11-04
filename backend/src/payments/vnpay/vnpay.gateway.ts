import { Injectable } from '@nestjs/common';
import { formatVnpayDate, signParams, sortObject, verifySecureHash } from './vnpay.util';

export interface CreateVnpayUrlParams {
  txnRef: string;
  amount: number;
  orderInfo: string;
  ipAddr: string;
  expireDate: Date; // Hạn 5 phút theo chốt nghiệp vụ
}

@Injectable()
export class VnpayGateway {
  private readonly tmnCode = process.env.VNPAY_TMN_CODE || 'BREWLITE_TEST';
  private readonly hashSecret = process.env.VNPAY_HASH_SECRET || 'SECRET_KEY_TEST';
  private readonly vnpUrl =
    process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  private readonly returnUrl =
    process.env.VNPAY_RETURN_URL || 'http://localhost:3000/payment/vnpay-return';

  /**
   * Khởi tạo URL thanh toán gửi sang cổng VNPAY Sandbox.
   */
  createPaymentUrl(params: CreateVnpayUrlParams): string {
    const vnpParams: Record<string, any> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: this.tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: params.txnRef,
      vnp_OrderInfo: params.orderInfo,
      vnp_OrderType: 'other',
      vnp_Amount: params.amount * 100, // VNPAY yêu cầu nhân 100
      vnp_ReturnUrl: this.returnUrl,
      vnp_IpAddr: params.ipAddr,
      vnp_CreateDate: formatVnpayDate(new Date()),
      vnp_ExpireDate: formatVnpayDate(params.expireDate),
    };

    const sortedParams = sortObject(vnpParams);
    const secureHash = signParams(vnpParams, this.hashSecret);

    const queryString = Object.entries(sortedParams)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    return `${this.vnpUrl}?${queryString}&vnp_SecureHash=${secureHash}`;
  }

  /**
   * Xác thực chữ ký IPN / Return webhook từ VNPAY.
   */
  verifyIpn(query: Record<string, any>): boolean {
    return verifySecureHash(query, this.hashSecret);
  }
}