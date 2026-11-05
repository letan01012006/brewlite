import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { InventoryService } from './inventory.service.js';
import {
  AvailabilityDto,
  MovementQueryDto,
  StockAdjustmentDto,
} from './dto/stock-adjustment.dto.js';
import {
  InventoryDocs,
  availabilitySchema,
  ingredientSchema,
  movementSchema,
} from './inventory.swagger.js';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Post('availability')
  @HttpCode(200)
  @InventoryDocs(
    'Kiểm tra nguyên liệu toàn giỏ, chưa giữ kho',
    availabilitySchema,
    200,
    true,
  )
  availability(@Body() dto: AvailabilityDto) {
    return this.inventory.availability(dto.items);
  }
  @Get('stock')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @InventoryDocs('Tồn và lượng khả dụng', {
    type: 'array',
    items: {
      ...ingredientSchema,
      properties: {
        ...ingredientSchema.properties,
        availableQuantity: { type: 'string' },
      },
    },
  })
  stock() {
    return this.inventory.stock();
  }
  @Get('movements')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @InventoryDocs('Lịch sử biến động kho (phân trang)', {
    type: 'object',
    properties: {
      data: { type: 'array', items: movementSchema },
      meta: { type: 'object' },
    },
  })
  movements(@Query() query: MovementQueryDto) {
    return this.inventory.movements(query);
  }
  @Post('receipts')
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @InventoryDocs(
    'Nhập kho; cùng khóa và nội dung trả lại movement cũ',
    movementSchema,
    201,
  )
  receipt(
    @CurrentUser('id') actorId: number,
    @Body() dto: StockAdjustmentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.inventory.adjust(actorId, 'RECEIPT', dto, key);
  }
  @Post('adjustments')
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @InventoryDocs(
    'Điều chỉnh delta tồn, không giảm dưới lượng giữ',
    movementSchema,
    201,
  )
  adjustment(
    @CurrentUser('id') actorId: number,
    @Body() dto: StockAdjustmentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.inventory.adjust(actorId, 'ADJUSTMENT', dto, key);
  }
}
