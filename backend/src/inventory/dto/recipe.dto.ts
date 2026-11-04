import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class RecipeIngredientDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  ingredientId: number;

  @ApiProperty({
    example: '16.500',
    description: 'Định mức theo đơn vị gốc, tối đa 3 chữ số thập phân.',
  })
  @IsString()
  @Matches(/^\d{1,15}(\.\d{1,3})?$/)
  quantity: string;
}
export class RecipeDto {
  @ApiProperty({ type: [RecipeIngredientDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((entry: RecipeIngredientDto) => entry?.ingredientId)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients: RecipeIngredientDto[];

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
export class ToppingRecipeDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  ingredientId: number;

  @ApiProperty({ example: '50.000' })
  @IsString()
  @Matches(/^\d{1,15}(\.\d{1,3})?$/)
  quantityPerServing: string;
}
