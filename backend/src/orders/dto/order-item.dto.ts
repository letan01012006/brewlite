import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Mã món (productId) không được để trống' })
  productId: string;

  @IsIn(['S', 'M', 'L'], { message: 'Size đồ uống chỉ có thể là S, M hoặc L' })
  size: 'S' | 'M' | 'L';

  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, { message: 'Số lượng tối thiểu là 1' })
  quantity: number;

  @IsArray({ message: 'Danh sách topping phải là mảng' })
  @IsString({ each: true })
  @IsOptional()
  toppingIds?: string[];
}
