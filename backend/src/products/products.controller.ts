import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service.js';
import { QueryProductDto } from './dto/query-product.dto.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * Lấy danh sách sản phẩm (Task 2)
   * GET /api/products?search=...&category=...&page=1&limit=20
   */
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách sản phẩm (hỗ trợ tìm kiếm, lọc danh mục và phân trang)' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách sản phẩm thành công' })
  @ApiResponse({ status: 400, description: 'Tham số query không hợp lệ' })
  async findAll(@Query() query: QueryProductDto) {
    return this.productsService.findAll(query);
  }

  /**
   * Lấy chi tiết một sản phẩm kèm sizes và toppings (Task 2, 4)
   * GET /api/products/:id
   */
  @Get(':id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết một món kèm danh sách sizes và toppings' })
  @ApiParam({ name: 'id', description: 'ID của sản phẩm (số nguyên)', example: 1 })
  @ApiResponse({ status: 200, description: 'Tìm thấy thông tin sản phẩm' })
  @ApiResponse({ status: 400, description: 'ID không phải là số hợp lệ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sản phẩm' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }

  /**
   * Tạo sản phẩm mới
   * POST /api/products
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thêm sản phẩm mới vào thực đơn' })
  @ApiResponse({ status: 201, description: 'Tạo sản phẩm thành công' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Chỉ BARISTA được thêm sản phẩm' })
  @ApiResponse({ status: 400, description: 'Dữ liệu đầu vào không hợp lệ' })
  @ApiResponse({ status: 409, description: 'Tên sản phẩm đã tồn tại' })
  async create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }
}

