import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { OtpService } from './otp.service.js';
import { WELCOME_POINTS } from '../promotions/voucher-rules.js';

export const publicUserSelect = {
  id: true, email: true, phone: true, isPhoneVerified: true,
  fullName: true, role: true, loyaltyPoints: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly otp: OtpService,
  ) {}

  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The library engine exposes target fields; the JS driver exposes the
      // constraint index. Accept both so phone/email conflicts keep their codes.
      const adapterError = error.meta?.driverAdapterError as {
        cause?: { constraint?: { index?: string; fields?: string[] } };
      } | undefined;
      const target = JSON.stringify(error.meta?.target ?? adapterError?.cause?.constraint ?? '');
      const phone = target.includes('phone');
      throw new ConflictException({
        code: phone ? 'PHONE_ALREADY_EXISTS' : 'EMAIL_ALREADY_EXISTS',
        message: phone ? 'Số điện thoại đã được sử dụng' : 'Email đã được sử dụng',
      });
    }
    throw error;
  }

  async register(dto: RegisterDto) {
    const issued = this.otp.issue(dto.phone);
    try {
      await this.prisma.user.create({
        data: {
          fullName: dto.fullName.trim(), phone: dto.phone,
          email: dto.email?.toLowerCase().trim() || null,
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: 'CUSTOMER', isPhoneVerified: false, loyaltyPoints: 0,
          ...issued.data,
        },
      });
    } catch (error) { this.conflict(error); }
    this.otp.send(dto.phone, issued.code);
    return this.pending(dto.phone);
  }

  private pending(phone: string) {
    return { phone, requiresOtp: true, expiresIn: 300, resendAfter: 60,
      message: 'Đã gửi mã xác thực qua SMS. Vui lòng nhập OTP để hoàn tất đăng ký.' };
  }

  async verifyOtp(phone: string, code: string) {
    // Row lock serializes verification AND resend for this identity. Return errors
    // from the callback so failed-attempt writes COMMIT instead of rolling back.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE phone = ${phone} FOR UPDATE`);
      const user = await tx.user.findUnique({ where: { phone } });
      if (!user || user.isPhoneVerified || !user.otpHash)
        return { error: 'OTP_INVALID_OR_USED' } as const;
      if (user.otpAttempts >= 5) return { error: 'OTP_ATTEMPTS_EXCEEDED' } as const;
      if (!user.otpExpiresAt || user.otpExpiresAt.getTime() <= Date.now())
        return { error: 'OTP_EXPIRED' } as const;
      const actual = Buffer.from(this.otp.hash(phone, code), 'hex');
      const expected = Buffer.from(user.otpHash, 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        const attempts = user.otpAttempts + 1;
        await tx.user.update({ where: { id: user.id }, data: { otpAttempts: attempts } });
        return { error: attempts >= 5 ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID' } as const;
      }
      const grant = user.role === 'CUSTOMER' && !user.welcomePointsGrantedAt;
      const verified = await tx.user.update({
        where: { id: user.id },
        data: {
          isPhoneVerified: true, otpHash: null, otpExpiresAt: null,
          ...(grant ? { loyaltyPoints: { increment: WELCOME_POINTS }, welcomePointsGrantedAt: new Date() } : {}),
        },
      });
      return { user: verified } as const;
    });
    if ('error' in result) throw new BadRequestException({
      code: result.error, message: 'OTP không hợp lệ, hết hạn, đã dùng hoặc đã bị khóa. Vui lòng gửi lại mã khi cần.',
    });
    return this.session(result.user);
  }

  async resendOtp(phone: string) {
    const issued = this.otp.issue(phone);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE phone = ${phone} FOR UPDATE`);
      const user = await tx.user.findUnique({ where: { phone } });
      if (!user || user.isPhoneVerified) return 'OTP_NOT_PENDING';
      if (user.otpSentAt && Date.now() - user.otpSentAt.getTime() < 60000) return 'OTP_RESEND_TOO_SOON';
      await tx.user.update({ where: { id: user.id }, data: issued.data });
      return null;
    });
    if (result) throw new HttpException({
      code: result, message: result === 'OTP_RESEND_TOO_SOON'
        ? 'Vui lòng đợi ít nhất 60 giây giữa hai lần gửi OTP.' : 'Tài khoản không chờ xác thực OTP.',
    }, result === 'OTP_RESEND_TOO_SOON' ? 429 : 400);
    this.otp.send(phone, issued.code);
    return this.pending(phone);
  }

  async createStaff(dto: RegisterDto) {
    try {
      return await this.prisma.user.create({
        data: { fullName: dto.fullName.trim(), phone: dto.phone,
          email: dto.email?.toLowerCase().trim() || null,
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: 'BARISTA', isPhoneVerified: true },
        select: publicUserSelect,
      });
    } catch (error) { this.conflict(error); }
  }

  async login(dto: LoginDto) {
    if (!!dto.phone === !!dto.email) throw new BadRequestException({
      code: 'LOGIN_IDENTIFIER_REQUIRED', message: 'Chọn đúng một trong số điện thoại hoặc email.',
    });
    const user = await this.prisma.user.findUnique({
      where: dto.phone ? { phone: dto.phone } : { email: dto.email! },
    });
    if (!user || (dto.email && user.phone) || !await bcrypt.compare(dto.password, user.passwordHash))
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Thông tin đăng nhập không chính xác.' });
    if (user.phone && !user.isPhoneVerified)
      throw new ForbiddenException({ code: 'PHONE_NOT_VERIFIED', message: 'Vui lòng xác thực số điện thoại bằng OTP.' });
    return this.session(user);
  }

  private session(user: User) {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    const payload = this.jwtService.decode<{ exp: number; iat: number }>(accessToken);
    return {
      accessToken, tokenType: 'Bearer', expiresIn: payload.exp - payload.iat,
      user: { id: user.id, email: user.email, phone: user.phone,
        isPhoneVerified: user.isPhoneVerified, fullName: user.fullName,
        role: user.role, loyaltyPoints: user.loyaltyPoints },
    };
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Không tìm thấy tài khoản.' });
    return user;
  }
}
