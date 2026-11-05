import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class QueryProductDto {
  @ApiPropertyOptional({
    description: 'Tìm kiếm sản phẩm theo tên (không phân biệt hoa thường)',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Lọc sản phẩm theo danh mục (Cà phê, Trà, Đá xay...)',
  })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({
    description: 'Bao gồm cả sản phẩm đang tạm dừng bán (dành cho Barista)',
    default: false,
  })
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : value,
  )
  @IsBoolean({ message: 'includeInactive phải là kiểu boolean' })
  @IsOptional()
  includeInactive?: boolean;

  @ApiPropertyOptional({
    description: 'Trang hiện tại (bắt đầu từ 1)',
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page tối thiểu là 1' })
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng sản phẩm mỗi trang (tối đa 50)',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit tối thiểu là 1' })
  @Max(50, { message: 'limit tối đa là 50' })
  @IsOptional()
  limit: number = 20;
}

export class UpdateProductStatusDto {
  @ApiProperty({
    description: 'Trạng thái bán của sản phẩm (true: Đang bán, false: Tạm dừng)',
    example: false,
  })
  @IsBoolean({ message: 'isActive phải là kiểu boolean' })
  isActive: boolean;
}
