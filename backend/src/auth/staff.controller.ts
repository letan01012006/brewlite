import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('admin/staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MANAGER')
@Controller('admin/staff')
export class StaffController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  @ApiBody({ type: RegisterDto, examples: {
    barista: { summary: 'Cấp BARISTA đã xác thực', value: { fullName: 'Nhân viên BrewLite', phone: '0912345679', password: 'Barista@123' } },
  } })
  @ApiOperation({ summary: 'MANAGER cấp tài khoản BARISTA đã xác thực, đăng nhập ngay' })
  @ApiResponse({ status: 201, description: 'User BARISTA, isPhoneVerified=true; không trả passwordHash' })
  @ApiResponse({ status: 401, description: 'Thiếu JWT hoặc JWT không hợp lệ' })
  @ApiResponse({ status: 403, description: 'CUSTOMER và BARISTA không có quyền cấp tài khoản' })
  @ApiResponse({ status: 409, description: 'Trùng phone hoặc email' })
  create(@Body() dto: RegisterDto) { return this.auth.createStaff(dto); }
}
