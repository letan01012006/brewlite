import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateToppingDto {
  @ApiProperty({ description: 'Tên topping (unique)', example: 'Trân châu trắng' })
  @IsString()
  @IsNotEmpty({ message: 'Tên topping không được để trống' })
  name: string;

  @ApiProperty({ description: 'Giá tiền topping (VND)', example: 5000 })
  @IsNumber()
  @Min(0, { message: 'Giá topping phải lớn hơn hoặc bằng 0' })
  price: number;
}
