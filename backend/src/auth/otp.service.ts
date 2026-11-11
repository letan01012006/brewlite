import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID } from 'node:crypto';

const ESMS_ENDPOINT =
  'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/';

@Injectable()
export class OtpService {
  private readonly secret: string;
  private readonly demo: boolean;
  private readonly local: boolean;

  constructor(private readonly config: ConfigService) {
    const environment = config.get<string>('NODE_ENV');
    const demo = config.get<string>('AUTH_OTP_DEMO') === 'true';
    const local = environment === 'development' || environment === 'test';
    if (demo && !local)
      throw new Error('AUTH_OTP_DEMO is allowed only in development/test');
    this.local = local && config.get<string>('SMS_PROVIDER') === 'local';
    // A real SMS provider always receives a random code, even in development.
    this.demo = demo && this.local;
    this.secret = config.getOrThrow<string>('OTP_HASH_SECRET');
    if (this.secret.length < 32)
      throw new Error('OTP_HASH_SECRET must have at least 32 characters');
  }

  hash(phone: string, code: string) {
    return createHmac('sha256', this.secret)
      .update(phone + ':' + code)
      .digest('hex');
  }

  issue(phone: string, previousHash?: string) {
    // Generate independently of delivery so a failed send leaves the account
    // pending verification, recoverable through resend-otp.
    // Never randomly issue the fixed demo value when demo mode is disabled.
    let code: string;
    do {
      code = randomInt(0, 1000000).toString().padStart(6, '0');
    } while (
      code === '123456' ||
      (!this.demo && this.hash(phone, code) === previousHash)
    );
    if (this.demo) code = '123456';
    const now = new Date();
    return {
      code,
      data: {
        otpHash: this.hash(phone, code),
        otpExpiresAt: new Date(now.getTime() + 300000),
        otpSentAt: now,
        otpAttempts: 0,
      },
    };
  }

  async send(phone: string, code: string): Promise<void> {
    // Explicit local simulator only; no OTP, phone, or credentials are logged.
    if (this.local) return;

    const provider = this.config.get<string>('SMS_PROVIDER') ?? 'esms';
    const apiKey = this.config.get<string>('ESMS_API_KEY')?.trim();
    const secretKey = this.config.get<string>('ESMS_SECRET_KEY')?.trim();
    const brandname = this.config.get<string>('ESMS_BRANDNAME')?.trim();
    const template = this.config.get<string>('ESMS_OTP_TEMPLATE')?.trim();
    const timeoutMs = Number(this.config.get('ESMS_TIMEOUT_MS') ?? 10000);
    if (
      provider !== 'esms' ||
      !apiKey ||
      !secretKey ||
      !brandname ||
      !template?.includes('{OTP}') ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 30000
    ) {
      throw new ServiceUnavailableException({
        code: 'SMS_NOT_CONFIGURED',
        message:
          'Chưa cấu hình đầy đủ eSMS (key, Brandname, mẫu tin chứa {OTP}, timeout 100–30000ms). Tài khoản đang chờ xác minh; vui lòng gửi lại mã sau khi cấu hình được cập nhật.',
      });
    }

    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(ESMS_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ApiKey: apiKey,
          SecretKey: secretKey,
          Phone: phone,
          Brandname: brandname,
          Content: template.replaceAll('{OTP}', code),
          SmsType: '2',
          Sandbox: '0',
          IsUnicode: /\P{ASCII}/u.test(template) ? '1' : '0',
          RequestId: randomUUID(),
        }),
      });
      body = await response.json();
    } catch {
      // Never propagate fetch/provider errors: they may contain credentials,
      // request bodies, or the provider echoing the OTP.
      if (signal.aborted)
        throw new GatewayTimeoutException({
          code: 'SMS_TIMEOUT',
          message:
            'eSMS chưa xác nhận tiếp nhận trong thời gian chờ. Vui lòng gửi lại mã; mã của lần gửi này không còn hiệu lực.',
        });
      throw new BadGatewayException({
        code: 'SMS_UNAVAILABLE',
        message:
          'Không nhận được phản hồi hợp lệ từ eSMS. Tài khoản đang chờ xác minh; vui lòng gửi lại mã.',
      });
    }

    const result =
      body && typeof body === 'object' && 'CodeResult' in body
        ? body.CodeResult
        : undefined;
    if (!response.ok || result !== '100') {
      // Expose only a numeric status, never ErrorMessage or the raw body.
      const providerCode =
        typeof result === 'string' && /^\d{2,3}$/.test(result)
          ? result
          : undefined;
      throw new BadGatewayException({
        code: 'SMS_REJECTED',
        message:
          'eSMS chưa tiếp nhận yêu cầu gửi mã' +
          (providerCode ? ` (mã ${providerCode})` : '') +
          '. Kiểm tra key, quyền Brandname/mẫu tin và số dư eSMS, sau đó gửi lại mã.',
      });
    }
  }
}
