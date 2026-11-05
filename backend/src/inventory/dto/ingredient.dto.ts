import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const UNITS = ['GRAM', 'MILLILITRE', 'PIECE'] as const;
export class CreateIngredientDto {
  @ApiPropertyOptional({
    example: 'COFFEE_BEANS',
    description: 'Tùy chọn; nếu bỏ trống hệ thống tự sinh mã duy nhất.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  code?: string;

  @ApiProperty({ example: 'Cà phê hạt' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  name: string;

  @ApiProperty({ enum: UNITS })
  @IsIn(UNITS)
  unit: 'GRAM' | 'MILLILITRE' | 'PIECE';
}
export class UpdateIngredientDto extends PartialType(CreateIngredientDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
