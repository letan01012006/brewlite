import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { QueryOrderDto } from './dto/query-order.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/jwt-payload.interface.js';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Tạo đơn hàng mới từ giỏ hàng (Task 6 & Task 10)
   * POST /api/orders
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo đơn hàng mới (ở trạng thái PENDING) và giữ tồn kho' })
  @ApiResponse({ status: 201, description: 'Tạo đơn hàng thành công, trả về thông tin đơn hàng' })
  @ApiResponse({ status: 400, description: 'Dữ liệu giỏ hàng không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Sản phẩm hoặc topping không tồn tại' })
  @ApiResponse({ status: 409, description: 'Hết hàng trong kho (OUT_OF_STOCK)' })
  @ApiResponse({ status: 422, description: 'Mã khuyến mãi không hợp lệ hoặc không đủ điều kiện' })
  async create(
    @CurrentUser('id') userId: number,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.create(userId, createOrderDto);
  }

  /**
   * Xem lịch sử đơn hàng của tôi (Task 9)
   * GET /api/orders/me
   * LƯU Ý: Phải đặt route 'me' trước ':id' để không bị hiểu lầm 'me' là tham số :id
   */
  @Get('me')
  @ApiOperation({ summary: 'Lấy lịch sử đơn hàng của người dùng hiện tại (hỗ trợ phân trang)' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách đơn hàng thành công' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async findMyOrders(
    @CurrentUser('id') userId: number,
    @Query() query: QueryOrderDto,
  ) {
    return this.ordersService.findMyOrders(userId, query);
  }

  /**
   * Xem chi tiết một đơn hàng (Task 9)
   * GET /api/orders/:id
   */
  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết một đơn hàng kèm danh sách món và lịch sử thanh toán' })
  @ApiParam({ name: 'id', description: 'ID đơn hàng (số nguyên)', example: 1 })
  @ApiResponse({ status: 200, description: 'Tìm thấy thông tin chi tiết đơn hàng' })
  @ApiResponse({ status: 400, description: 'ID đơn hàng không phải là số hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không có quyền xem đơn hàng của người khác' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy đơn hàng' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.findOne(id, user.id, user.role);
  }
}
