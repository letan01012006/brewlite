import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { OrderItemDto } from './order-item.dto.js';

export class CreateOrderDto {
  @ApiProperty({
    description: 'Danh sách các món đặt trong đơn (1 đến 30 món)',
    type: [OrderItemDto],
  })
  @IsArray({ message: 'Danh sách món (items) phải là một mảng' })
  @ArrayMinSize(1, { message: 'Giỏ hàng phải có ít nhất 1 món để đặt đơn' })
  @ArrayMaxSize(30, { message: 'Đơn hàng không được vượt quá 30 món' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiPropertyOptional({
    description: 'Mã khuyến mãi (nếu có, không phân biệt hoa thường)',
    example: 'BREW10',
  })
  @IsString({ message: 'Mã khuyến mãi phải là chuỗi' })
  @IsOptional()
  promoCode?: string;
}
