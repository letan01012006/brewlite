import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class OrderItemDto {
  @ApiProperty({ description: 'ID của sản phẩm (số nguyên)', example: 1 })
  @IsInt({ message: 'Mã món (productId) phải là số nguyên' })
  @Min(1, { message: 'Mã món không hợp lệ' })
  productId: number;

  @ApiProperty({ description: 'Kích cỡ món nước', enum: ['S', 'M', 'L'], example: 'M' })
  @IsIn(['S', 'M', 'L'], { message: 'Size đồ uống chỉ có thể là S, M hoặc L' })
  size: 'S' | 'M' | 'L';

  @ApiProperty({ description: 'Số lượng mua (1 - 20 phần)', example: 1, minimum: 1, maximum: 20 })
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, { message: 'Số lượng tối thiểu là 1' })
  @Max(20, { message: 'Số lượng tối đa cho mỗi dòng là 20' })
  quantity: number;

  @ApiPropertyOptional({
    description: 'Danh sách ID topping kèm theo (tối đa 3 topping)',
    example: [1, 2],
    type: [Number],
  })
  @IsArray({ message: 'Danh sách topping phải là một mảng' })
  @IsInt({ each: true, message: 'ID topping phải là số nguyên' })
  @ArrayMaxSize(3, { message: 'Mỗi ly chỉ được chọn tối đa 3 topping' })
  @IsOptional()
  toppingIds?: number[];

  @ApiPropertyOptional({
    description: 'Ghi chú của khách cho món này (tối đa 200 ký tự)',
    example: 'ít đá, 50% ngọt',
  })
  @IsString({ message: 'Ghi chú phải là chuỗi' })
  @MaxLength(200, { message: 'Ghi chú không được vượt quá 200 ký tự' })
  @IsOptional()
  note?: string;
}
