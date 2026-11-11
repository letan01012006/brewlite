import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'name phải là chuỗi' })
  @IsNotEmpty({ message: 'name: Tên sản phẩm không được để trống' })
  name: string;

  @ApiProperty({ description: 'Danh mục sản phẩm', example: 'Cà phê' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'category phải là chuỗi' })
  @IsNotEmpty({ message: 'category: Danh mục sản phẩm không được để trống' })
  category: string;

  @ApiProperty({
    description: 'Giá gốc sản phẩm (size S, VND)',
    example: 35000,
    minimum: 0,
    maximum: 2147483647,
    type: 'integer',
  })
  @IsInt({ message: 'price phải là số nguyên' })
  @Min(0, { message: 'price: Giá sản phẩm phải lớn hơn hoặc bằng 0' })
  @Max(2147483647, { message: 'price không được vượt quá 2147483647' })
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
