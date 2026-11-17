import { Body, Controller, Delete, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('admin/staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('BARISTA')
@Controller('admin/staff')
export class StaffController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  @ApiBody({ type: RegisterDto, examples: {
    staff: { summary: 'Cấp STAFF đã xác thực', value: { fullName: 'Nhân viên BrewLite', phone: '0912345679', password: 'Staff@123' } },
  } })
  @ApiOperation({ summary: 'BARISTA cấp tài khoản nhân viên đã xác thực, đăng nhập ngay' })
  @ApiResponse({ status: 201, description: 'User STAFF, isPhoneVerified=true; không trả passwordHash. STAFF không được tạo/xóa tài khoản.' })
  @ApiResponse({ status: 401, description: 'Thiếu JWT hoặc JWT không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Chỉ BARISTA có quyền cấp tài khoản nhân viên' })
  @ApiResponse({ status: 409, description: 'Trùng phone hoặc email' })
  create(@Body() dto: RegisterDto) { return this.auth.createStaff(dto); }

  @Delete(':id')
  @ApiOperation({
    summary: 'BARISTA xóa tài khoản STAFF, thu hồi đăng nhập và token',
    description: 'Chỉ xóa tài khoản có role STAFF. Xóa mềm để giữ lịch sử đơn hàng, thanh toán và kho; SĐT/email vẫn được giữ và không tái sử dụng. Không xóa CUSTOMER, BARISTA hoặc MANAGER.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'ID tài khoản STAFF cần xóa (số nguyên dương)' })
  @ApiResponse({ status: 200, description: 'Đã xóa tài khoản nhân viên', schema: {
    type: 'object', required: ['id', 'deleted'], properties: { id: { type: 'integer' }, deleted: { type: 'boolean', example: true } },
  } })
  @ApiResponse({ status: 400, description: 'ID không phải số nguyên dương hợp lệ' })
  @ApiResponse({ status: 401, description: 'Thiếu JWT, JWT không hợp lệ hoặc tài khoản đã bị xóa' })
  @ApiResponse({ status: 403, description: 'Chỉ BARISTA được xóa tài khoản nhân viên; STAFF/CUSTOMER bị chặn' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy STAFF đang hoạt động, đã xóa hoặc ID thuộc vai trò khác' })
  remove(@Param('id', ParseIntPipe) id: number) { return this.auth.deleteStaff(id); }
}
