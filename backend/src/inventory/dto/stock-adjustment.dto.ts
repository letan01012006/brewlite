import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderItemDto } from '../../orders/dto/order-item.dto.js';

export class StockAdjustmentDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) ingredientId: number;
  @ApiProperty({
    example: '100.000',
    description:
      'RECEIPT: lượng tăng (> 0); ADJUSTMENT: lượng hao hụt (> 0 hoặc delta âm).',
  })
  @IsString()
  @Matches(/^-?\d{1,15}(\.\d{1,3})?$/)
  quantity: string;
  @ApiPropertyOptional({
    example: 'Kiểm kê ca sáng',
    description:
      'Tùy chọn khi nhập kho (RECEIPT), bắt buộc khi ghi nhận hao hụt (ADJUSTMENT).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  reason?: string;
}
export const MOVEMENT_KINDS = [
  'RECEIPT',
  'ADJUSTMENT',
  'ADJUSTMENT_POSITIVE',
  'ADJUSTMENT_NEGATIVE',
  'HOLD',
  'RELEASE',
  'CONSUME',
] as const;
export class MovementQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  ingredientId?: number;
  @ApiPropertyOptional({ enum: MOVEMENT_KINDS })
  @IsOptional()
  @IsIn(MOVEMENT_KINDS)
  kind?: (typeof MOVEMENT_KINDS)[number];
  @ApiPropertyOptional({ description: 'Từ ngày (ISO / YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  from?: string;
  @ApiPropertyOptional({ description: 'Đến ngày (ISO / YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  to?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class AvailabilityDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
