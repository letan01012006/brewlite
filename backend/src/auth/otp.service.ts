import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt } from 'node:crypto';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly secret: string;
  private readonly demo: boolean;
  private readonly local: boolean;

  constructor(config: ConfigService) {
    const environment = config.get<string>('NODE_ENV');
    this.demo = config.get<string>('AUTH_OTP_DEMO') === 'true';
    const local = environment === 'development' || environment === 'test';
    this.local = local;
    if (this.demo && !local) throw new Error('AUTH_OTP_DEMO is allowed only in development/test');
    this.secret = config.getOrThrow<string>('OTP_HASH_SECRET');
    if (this.secret.length < 32) throw new Error('OTP_HASH_SECRET must have at least 32 characters');
    // This application currently ships only a local SMS adapter. Fail closed elsewhere.
  }

  hash(phone: string, code: string) {
    return createHmac('sha256', this.secret).update(phone + ':' + code).digest('hex');
  }

  issue(phone: string) {
    if (!this.local) throw new ServiceUnavailableException({ code: 'SMS_NOT_CONFIGURED', message: 'Cần cấu hình SMS provider cho production.' });
    // Never randomly issue the fixed demo value when demo mode is disabled.
    let code: string;
    do { code = randomInt(0, 1000000).toString().padStart(6, '0'); }
    while (code === '123456');
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

  send(phone: string, code: string) {
    // Deliberate local SMS simulator: never returned by HTTP, never stored in plaintext.
    this.logger.log('[SMS local] ' + phone + ': OTP ' + code + ' (5 phút)');
  }
}
