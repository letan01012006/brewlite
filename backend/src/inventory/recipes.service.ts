import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, type Size } from '../generated/prisma/client.js';
import {
  CreateIngredientDto,
  UpdateIngredientDto,
} from './dto/ingredient.dto.js';
import { RecipeDto, ToppingRecipeDto } from './dto/recipe.dto.js';
import { quantity } from './quantity.js';

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.ingredient.findMany({ orderBy: { id: 'asc' } });
  }
  async ingredient(id: number) {
    const row = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy nguyên liệu.');
    return row;
  }
  async create(dto: CreateIngredientDto) {
    try {
      return await this.prisma.ingredient.create({ data: dto });
    } catch (error) {
      this.rethrow(error);
    }
  }
  async update(id: number, dto: UpdateIngredientDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Ingredient" WHERE "id" = ${id} FOR UPDATE`;
        const current = await tx.ingredient.findUnique({
          where: { id },
          include: {
            _count: {
              select: {
                productRecipeIngredients: true,
                reservationItems: true,
                movements: true,
                toppings: true,
              },
            },
          },
        });
        if (!current)
          throw new NotFoundException('Không tìm thấy nguyên liệu.');
        if (
          dto.unit &&
          dto.unit !== current.unit &&
          (!current.stockQuantity.isZero() ||
            !current.reservedQuantity.isZero() ||
            Object.values(current._count).some(Boolean))
        )
          throw new ConflictException({
            code: 'UNIT_IN_USE',
            message:
              'Không thể đổi đơn vị nguyên liệu đã có tồn hoặc tham chiếu.',
          });
        return tx.ingredient.update({
          where: { id },
          data: {
            code: dto.code,
            name: dto.name,
            unit: dto.unit,
            isActive: dto.isActive,
            version: { increment: 1 },
          },
        });
      });
    } catch (error) {
      this.rethrow(error);
    }
  }
  async recipe(productId: number, size: Size) {
    const row = await this.prisma.productRecipe.findUnique({
      where: { productId_size: { productId, size } },
      include: { ingredients: true },
    });
    if (!row)
      throw new NotFoundException('Chưa cấu hình công thức cho size này.');
    return row;
  }
  async setRecipe(productId: number, size: Size, dto: RecipeDto) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize first creation and replacements using the stable parent row.
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
      if (!(await tx.product.findUnique({ where: { id: productId } })))
        throw new NotFoundException('Không tìm thấy sản phẩm.');
      const current = await tx.productRecipe.findUnique({
        where: { productId_size: { productId, size } },
      });
      const active = dto.isActive ?? current?.isActive ?? false;
      if (active && !dto.ingredients.length)
        throw new BadRequestException(
          'Công thức đang bật phải có nguyên liệu.',
        );
      const ingredients = [];
      for (const item of [...dto.ingredients].sort(
        (a, b) => a.ingredientId - b.ingredientId,
      )) {
        await tx.$queryRaw`SELECT "id" FROM "Ingredient" WHERE "id" = ${item.ingredientId} FOR UPDATE`;
        const ingredient = await tx.ingredient.findUnique({
          where: { id: item.ingredientId },
        });
        if (!ingredient || (active && !ingredient.isActive))
          throw new BadRequestException(
            'Nguyên liệu không tồn tại hoặc đã ngừng dùng.',
          );
        ingredients.push({
          ingredientId: ingredient.id,
          unit: ingredient.unit,
          quantity: quantity(item.quantity, ingredient.unit),
        });
      }
      return tx.productRecipe.upsert({
        where: { productId_size: { productId, size } },
        create: {
          productId,
          size,
          isActive: active,
          ingredients: { create: ingredients },
        },
        update: {
          isActive: active,
          version: { increment: 1 },
          ingredients: { deleteMany: {}, create: ingredients },
        },
        include: { ingredients: true },
      });
    });
  }
  async topping(id: number) {
    const row = await this.prisma.topping.findUnique({
      where: { id },
      select: { id: true, ingredientId: true, quantityPerServing: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy topping.');
    return row;
  }
  async setTopping(id: number, dto: ToppingRecipeDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Topping" WHERE "id" = ${id} FOR UPDATE`;
      if (!(await tx.topping.findUnique({ where: { id } })))
        throw new NotFoundException('Không tìm thấy topping.');
      await tx.$queryRaw`SELECT "id" FROM "Ingredient" WHERE "id" = ${dto.ingredientId} FOR UPDATE`;
      const ingredient = await tx.ingredient.findUnique({
        where: { id: dto.ingredientId },
      });
      if (!ingredient?.isActive)
        throw new BadRequestException(
          'Nguyên liệu không tồn tại hoặc đã ngừng dùng.',
        );
      return tx.topping.update({
        where: { id },
        data: {
          ingredientId: ingredient.id,
          quantityPerServing: quantity(dto.quantityPerServing, ingredient.unit),
        },
        select: { id: true, ingredientId: true, quantityPerServing: true },
      });
    });
  }
  private rethrow(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException({
        code: 'INGREDIENT_ALREADY_EXISTS',
        message: 'Mã hoặc tên nguyên liệu đã tồn tại.',
      });
    }
    throw error;
  }
}
