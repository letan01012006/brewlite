import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { OrderItemDto } from '../../orders/dto/order-item.dto.js';

export class ValidatePromotionDto {
  @ApiProperty({ description: 'Mã khuyến mãi cần kiểm tra', example: 'BREW10' })
  @IsString({ message: 'Mã khuyến mãi phải là chuỗi' })
  @IsNotEmpty({ message: 'Mã khuyến mãi không được để trống' })
  code: string;

  @ApiProperty({
    description: 'Danh sách các món trong giỏ hàng để tính toán điều kiện và số tiền giảm',
    type: [OrderItemDto],
  })
  @IsArray({ message: 'Danh sách món (items) phải là một mảng' })
  @ArrayMinSize(1, { message: 'Giỏ hàng phải có ít nhất 1 món để kiểm tra mã' })
  @ArrayMaxSize(30, { message: 'Số lượng món trong giỏ không được vượt quá 30' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
