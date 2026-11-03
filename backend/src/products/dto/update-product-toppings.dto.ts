import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsInt, Max, Min } from 'class-validator';

export class UpdateProductToppingsDto {
  @ApiProperty({
    description:
      'Thay thế toàn bộ topping được phép. [] gỡ hết. Không giới hạn số topping cấu hình.',
    type: [Number],
  })
  @IsArray()
  @ArrayUnique({ message: 'ID topping không được trùng' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  toppingIds: number[];
}
