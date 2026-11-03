import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ToppingsService } from './toppings.service.js';
import { CreateToppingDto } from './dto/create-topping.dto.js';

@ApiTags('products')
@Controller('toppings')
export class LegacyToppingsController {
  constructor(private readonly toppings: ToppingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách tất cả topping đang bán',
  })
  findAll() {
    return this.toppings.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Thêm mới topping',
  })
  create(@Body() dto: CreateToppingDto) {
    return this.toppings.create(dto);
  }
}
