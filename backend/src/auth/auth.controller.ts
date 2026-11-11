import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { PhoneDto, VerifyOtpDto } from './dto/otp.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký CUSTOMER chờ OTP; chưa cấp JWT hoặc điểm chào mừng' })
  @ApiResponse({ status: 201, description: '{ phone, requiresOtp, expiresIn: 300, resendAfter: 60, message }' })
  @ApiResponse({ status: 409, description: 'PHONE_ALREADY_EXISTS / EMAIL_ALREADY_EXISTS' })
  @ApiResponse({ status: 503, description: 'SMS_NOT_CONFIGURED: tài khoản đã tạo, dùng resend-otp sau khi bổ sung cấu hình' })
  @ApiResponse({ status: 502, description: 'SMS_REJECTED / SMS_UNAVAILABLE: chưa báo gửi thành công; có thể resend-otp ngay' })
  @ApiResponse({ status: 504, description: 'SMS_TIMEOUT: mã chưa được xác nhận đã vô hiệu; dùng resend-otp' })
  register(@Body() dto: RegisterDto) { return this.authService.register(dto); }

  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Xác thực OTP, nhận JWT và WELCOME_POINTS đúng một lần' })
  @ApiResponse({ status: 200, description: '{ accessToken, tokenType, expiresIn, user }' })
  @ApiResponse({ status: 400, description: 'OTP_INVALID / OTP_EXPIRED / OTP_INVALID_OR_USED / OTP_ATTEMPTS_EXCEEDED' })
  verifyOtp(@Body() dto: VerifyOtpDto) { return this.authService.verifyOtp(dto.phone, dto.code); }

  @Post('resend-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gửi lại OTP sau ít nhất 60 giây, mã mới thay mã cũ' })
  @ApiResponse({ status: 200, description: 'OTP mới, hết hạn sau 300 giây' })
  @ApiResponse({ status: 429, description: 'OTP_RESEND_TOO_SOON' })
  @ApiResponse({ status: 503, description: 'SMS_NOT_CONFIGURED' })
  @ApiResponse({ status: 502, description: 'SMS_REJECTED / SMS_UNAVAILABLE: có thể gửi lại ngay' })
  @ApiResponse({ status: 504, description: 'SMS_TIMEOUT: mã của lần gửi này không còn hiệu lực' })
  resendOtp(@Body() dto: PhoneDto) { return this.authService.resendOtp(dto.phone); }

  @Post('login')
  @HttpCode(200)
  @ApiBody({ type: LoginDto, examples: {
    phone: { summary: 'Khách mới / quản lý / nhân viên', value: { phone: '0900000001', password: 'Manager@123' } },
    legacyEmail: { summary: 'Tài khoản cũ chưa có phone', value: { email: 'demo@brewlite.com', password: 'Demo@1234' } },
  } })
  @ApiOperation({ summary: 'Đăng nhập bằng phone hoặc email cho tài khoản cũ chưa có phone' })
  @ApiResponse({ status: 200, description: '{ accessToken, tokenType, expiresIn, user }' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 403, description: 'PHONE_NOT_VERIFIED: chuyển sang màn OTP' })
  login(@Body() dto: LoginDto) { return this.authService.login(dto); }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thông tin tài khoản hiện tại; email có thể null' })
  getMe(@CurrentUser('id') id: number) { return this.authService.getMe(id); }
}
