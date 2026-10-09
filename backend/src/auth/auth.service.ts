import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import type { JwtPayload } from './interfaces/jwt-payload.interface.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Đăng ký tài khoản khách hàng mới (Task 7)
   * POST /api/auth/register
   */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    // 1. Kiểm tra email đã tồn tại hay chưa
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'Email đã được sử dụng',
      });
    }

    // 2. Băm mật khẩu bằng bcrypt (10 rounds)
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 3. Tạo tài khoản trong cơ sở dữ liệu với role = CUSTOMER
    const newUser = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        role: 'CUSTOMER',
        loyaltyPoints: 0,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        loyaltyPoints: true,
      },
    });

    return newUser;
  }

  /**
   * Đăng nhập và cấp JWT Token (Task 7)
   * POST /api/auth/login
   */
  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();

    // 1. Tìm user theo email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // 2. Kiểm tra mật khẩu (Dù sai email hay mật khẩu đều trả INVALID_CREDENTIALS để bảo mật)
    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không chính xác',
      });
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không chính xác',
      });
    }

    // 3. Ký JWT payload
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 86400, // 1 ngày = 86400 giây
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        loyaltyPoints: user.loyaltyPoints,
      },
    };
  }

  /**
   * Lấy thông tin tài khoản hiện tại kèm điểm thưởng mới nhất
   * GET /api/auth/me
   */
  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        loyaltyPoints: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Không tìm thấy thông tin tài khoản',
      });
    }

    return user;
  }
}

