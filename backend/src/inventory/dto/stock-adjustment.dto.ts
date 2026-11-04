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
    description: 'RECEIPT: lượng tăng; ADJUSTMENT: delta có dấu.',
  })
  @IsString()
  @Matches(/^-?\d{1,15}(\.\d{1,3})?$/)
  quantity: string;
  @ApiProperty({ example: 'Kiểm kê ca sáng' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}
export const MOVEMENT_KINDS = [
  'RECEIPT',
  'ADJUSTMENT',
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
