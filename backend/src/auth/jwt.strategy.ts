import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { type AuthUser, type JwtPayload } from './interfaces/jwt-payload.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!Number.isSafeInteger(payload?.sub) || payload.sub <= 0 || !['CUSTOMER', 'BARISTA', 'MANAGER'].includes(payload?.role))
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token không hợp lệ.' });
    // Authorize from current DB role, accepting legacy email JWTs and new null-email JWTs.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || (user.phone && !user.isPhoneVerified))
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Tài khoản không hợp lệ.' });
    return { id: user.id, email: user.email, role: user.role };
  }
}
