import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ToppingsService } from './toppings.service.js';
import { CreateToppingDto } from './dto/create-topping.dto.js';

@ApiTags('toppings')
@Controller('toppings')
export class ToppingsController {
  constructor(private readonly toppingsService: ToppingsService) {}

  /**
   * Lấy danh sách topping còn bán (Task 4)
   * GET /api/toppings
   */
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tất cả topping đang bán' })
  @ApiResponse({ status: 200, description: 'Danh sách topping dạng [{ id, name, price }]' })
  async findAll() {
    return this.toppingsService.findAll();
  }

  /**
   * Thêm topping mới
   * POST /api/toppings
   */
  @Post()
  @ApiOperation({ summary: 'Thêm mới topping' })
  @ApiResponse({ status: 201, description: 'Tạo topping thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 409, description: 'Tên topping đã tồn tại' })
  async create(@Body() createToppingDto: CreateToppingDto) {
    return this.toppingsService.create(createToppingDto);
  }
}

