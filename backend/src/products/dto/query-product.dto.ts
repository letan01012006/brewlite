import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryProductDto {
  @ApiPropertyOptional({ description: 'Tìm kiếm sản phẩm theo tên (không phân biệt hoa thường)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Lọc sản phẩm theo danh mục (Cà phê, Trà, Đá xay...)' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Trang hiện tại (bắt đầu từ 1)', default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page tối thiểu là 1' })
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ description: 'Số lượng sản phẩm mỗi trang (tối đa 50)', default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit tối thiểu là 1' })
  @Max(50, { message: 'limit tối đa là 50' })
  @IsOptional()
  limit: number = 20;
}

