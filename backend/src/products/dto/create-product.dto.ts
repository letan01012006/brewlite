import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ description: 'Tên sản phẩm (unique)', example: 'Cà phê sữa' })
  @IsString()
  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  name: string;

  @ApiProperty({ description: 'Danh mục sản phẩm', example: 'Cà phê' })
  @IsString()
  @IsNotEmpty({ message: 'Danh mục sản phẩm không được để trống' })
  category: string;

  @ApiProperty({
    description: 'Giá gốc sản phẩm (size S, VND)',
    example: 35000,
  })
  @IsInt()
  @Min(0, { message: 'Giá sản phẩm phải lớn hơn hoặc bằng 0' })
  price: number;

  @ApiPropertyOptional({
    description: 'URL hình ảnh sản phẩm',
    example: '/img/ca-phe-sua.jpg',
  })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Số lượng tồn kho',
    default: 0,
    example: 50,
  })
  @IsInt()
  @Min(0, { message: 'Số lượng tồn kho không được âm' })
  @IsOptional()
  stock?: number;

  @ApiPropertyOptional({
    description: 'Mô tả chi tiết sản phẩm',
    example: 'Cà phê phin pha sữa đặc',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'ID topping được phép; không truyền tương đương []',
    type: [Number],
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayUnique({ message: 'ID topping không được trùng' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  toppingIds?: number[];
}
