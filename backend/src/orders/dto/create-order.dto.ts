import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { OrderItemDto } from './order-item.dto.js';

export class CreateOrderDto {
  @IsArray({ message: 'Danh sách món (items) phải là một mảng' })
  @ArrayMinSize(1, { message: 'Giỏ hàng phải có ít nhất 1 món để đặt đơn' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsString()
  @IsOptional()
  promotionCode?: string;
}
