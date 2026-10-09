import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  name: string;

  @IsNumber()
  @Min(0, { message: 'Giá sản phẩm phải lớn hơn hoặc bằng 0' })
  price: number;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsInt()
  @Min(0, { message: 'Số lượng tồn kho không được âm' })
  @IsOptional()
  stock?: number;

  @IsString()
  @IsOptional()
  description?: string;
}
