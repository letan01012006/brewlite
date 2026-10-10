import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ORDER_STATUSES, type OrderStatus } from './update-order-status.dto.js';

export class QueryOrderDto {
  @ApiPropertyOptional({ description: 'Trang hiện tại (bắt đầu từ 1)', default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page tối thiểu là 1' })
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng đơn mỗi trang (mặc định 10, tối đa 50)',
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit tối thiểu là 1' })
  @Max(50, { message: 'limit tối đa là 50' })
  @IsOptional()
  limit: number = 10;

  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái đơn hàng',
    enum: ORDER_STATUSES,
  })
  @IsIn(ORDER_STATUSES, {
    message: 'Trạng thái đơn hàng không hợp lệ',
  })
  @IsOptional()
  status?: OrderStatus;
}
