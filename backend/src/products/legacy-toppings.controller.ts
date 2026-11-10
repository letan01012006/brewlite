import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ToppingsService } from './toppings.service.js';

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
}
