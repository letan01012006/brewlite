import { PositiveIdPipe } from './positive-id.pipe.js';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Size } from '../generated/prisma/client.js';
import { RecipesService } from './recipes.service.js';
import {
  CreateIngredientDto,
  UpdateIngredientDto,
  UNITS,
} from './dto/ingredient.dto.js';
import { RecipeDto, ToppingRecipeDto } from './dto/recipe.dto.js';
import {
  InventoryDocs,
  ingredientSchema,
  recipeSchema,
  toppingRecipeSchema,
} from './inventory.swagger.js';

@ApiTags('ingredients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('BARISTA')
@Controller()
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}
  @Get('inventory/units')
  @InventoryDocs('Đơn vị gốc được hỗ trợ', {
    type: 'array',
    items: { type: 'string', enum: [...UNITS] },
  })
  units() {
    return UNITS;
  }
  @Get('inventory/ingredients')
  @InventoryDocs('Danh sách nguyên liệu', {
    type: 'array',
    items: ingredientSchema,
  })
  list() {
    return this.recipes.list();
  }
  @Get('inventory/ingredients/:id')
  @InventoryDocs('Chi tiết nguyên liệu', ingredientSchema)
  ingredient(@Param('id', PositiveIdPipe) id: number) {
    return this.recipes.ingredient(id);
  }
  @Post('inventory/ingredients')
  @InventoryDocs(
    'Tạo nguyên liệu với tồn ban đầu bằng 0',
    ingredientSchema,
    201,
  )
  create(@Body() dto: CreateIngredientDto) {
    return this.recipes.create(dto);
  }
  @Patch('inventory/ingredients/:id')
  @InventoryDocs(
    'Cập nhật metadata nguyên liệu, không sửa tồn',
    ingredientSchema,
  )
  update(
    @Param('id', PositiveIdPipe) id: number,
    @Body() dto: UpdateIngredientDto,
  ) {
    return this.recipes.update(id, dto);
  }
  @Get('products/:id/recipes/:size')
  @InventoryDocs('Công thức sản phẩm theo size', recipeSchema)
  recipe(
    @Param('id', PositiveIdPipe) id: number,
    @Param('size', new ParseEnumPipe(Size)) size: Size,
  ) {
    return this.recipes.recipe(id, size);
  }
  @Put('products/:id/recipes/:size')
  @InventoryDocs(
    'Thay thế toàn bộ công thức của size trong transaction',
    recipeSchema,
  )
  setRecipe(
    @Param('id', PositiveIdPipe) id: number,
    @Param('size', new ParseEnumPipe(Size)) size: Size,
    @Body() dto: RecipeDto,
  ) {
    return this.recipes.setRecipe(id, size, dto);
  }
  @Get('products/toppings/:id/recipe')
  @InventoryDocs('Định mức topping đã chuẩn bị', toppingRecipeSchema)
  topping(@Param('id', PositiveIdPipe) id: number) {
    return this.recipes.topping(id);
  }
  @Put('products/toppings/:id/recipe')
  @InventoryDocs(
    'Gắn nguyên liệu và định mức một phần topping',
    toppingRecipeSchema,
  )
  setTopping(
    @Param('id', PositiveIdPipe) id: number,
    @Body() dto: ToppingRecipeDto,
  ) {
    return this.recipes.setTopping(id, dto);
  }
}
