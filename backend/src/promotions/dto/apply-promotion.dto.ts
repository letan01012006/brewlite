import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class ApplyPromotionDto {
  @IsString()
  @IsNotEmpty({ message: 'Mã khuyến mãi không được để trống' })
  code: string;

  @IsNumber()
  @Min(0, { message: 'Tổng giá trị đơn hàng phải lớn hơn hoặc bằng 0' })
  orderTotal: number;
}
