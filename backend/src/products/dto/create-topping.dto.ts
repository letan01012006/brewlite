import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsInt, IsString, Max, Min } from 'class-validator';

export class CreateToppingDto {
  @ApiProperty({
    description: 'Tên topping (unique)',
    example: 'Trân châu trắng',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty({ message: 'Tên topping không được để trống' })
  name: string;

  @ApiProperty({ description: 'Giá tiền topping (VND)', example: 5000 })
  @IsInt()
  @Min(0, { message: 'Giá topping phải lớn hơn hoặc bằng 0' })
  @Max(2147483647)
  price: number;
}
