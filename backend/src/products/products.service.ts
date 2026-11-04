import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryProductDto } from './dto/query-product.dto.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import {
  SIZE_SURCHARGE,
  type SizeKey,
} from '../common/pricing/pricing.constants.js';
import { Prisma } from '../generated/prisma/client.js';

const toppingsSelect = {
  where: { isActive: true },
  select: { id: true, name: true, price: true },
  orderBy: { id: 'asc' as const },
};

const publicProductSelect = {
  id: true,
  name: true,
  price: true,
  imageUrl: true,
  category: true,
  stock: true,
  toppings: toppingsSelect,
} satisfies Prisma.ProductSelect;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy danh sách sản phẩm (Task 2)
   * - Hỗ trợ lọc theo category, tìm kiếm theo tên (không phân biệt hoa thường)
   * - Phân trang (page, limit)
   * - Chỉ lấy món isActive = true, không trả trường version
   * - Bổ sung trường tính toán inStock = stock > 0
   */
  async findAll(query: QueryProductDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      isActive: true,
    };

    if (query.category) {
      where.category = query.category;
    }

    if (query.search?.trim()) {
      where.name = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'asc' },
        select: publicProductSelect,
      }),
      this.prisma.product.count({ where }),
    ]);

    const data = products.map((p) => ({
      ...p,
      inStock: p.stock > 0,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Lấy chi tiết một sản phẩm kèm kích cỡ và toppings (Task 2 & 4)
   * Giúp frontend render trang chi tiết món đầy đủ mà không cần hardcode
   */
  async findOne(id: number) {
    const product = await this.prisma.product.findFirst({
      where: { id, isActive: true },
      select: {
        ...publicProductSelect,
        description: true,
      },
    });

    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: `Không tìm thấy sản phẩm #${id}`,
      });
    }

    // Cấu hình các size kèm phụ thu từ pricing.constants
    const sizes = (Object.keys(SIZE_SURCHARGE) as SizeKey[]).map((size) => ({
      size,
      surcharge: SIZE_SURCHARGE[size],
    }));

    return {
      ...product,
      inStock: product.stock > 0,
      sizes,
    };
  }

  /**
   * Tạo sản phẩm mới
   */
  async create(dto: CreateProductDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ids = dto.toppingIds === undefined ? [] : dto.toppingIds;
        await this.validateToppingIds(tx, ids);
        return tx.product.create({
          data: {
            name: dto.name,
            category: dto.category,
            price: dto.price,
            imageUrl: dto.imageUrl ?? '/img/default.jpg',
            stock: dto.stock ?? 0,
            description: dto.description,
            toppings: { connect: ids.map((id) => ({ id })) },
          },
          select: { ...publicProductSelect, description: true },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'PRODUCT_ALREADY_EXISTS',
          message: `Sản phẩm với tên '${dto.name}' đã tồn tại`,
        });
      }
      throw error;
    }
  }

  async updateToppings(id: number, toppingIds: number[]) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!product)
        throw new NotFoundException({
          code: 'PRODUCT_NOT_FOUND',
          message: `Không tìm thấy sản phẩm #${id}`,
        });
      await this.validateToppingIds(tx, toppingIds);
      return tx.product.update({
        where: { id },
        data: {
          toppings: { set: toppingIds.map((toppingId) => ({ id: toppingId })) },
        },
        select: { ...publicProductSelect, description: true },
      });
    });
  }

  private async validateToppingIds(
    tx: Prisma.TransactionClient,
    ids: number[],
  ) {
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647) ||
      new Set(ids).size !== ids.length
    ) {
      throw new BadRequestException({
        code: 'INVALID_TOPPING_IDS',
        message: 'ID topping phải là số nguyên dương và không trùng',
      });
    }
    const valid = await tx.topping.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    const invalidIds = ids.filter((id) => !valid.some((t) => t.id === id));
    if (invalidIds.length)
      throw new BadRequestException({
        code: 'INVALID_TOPPING_IDS',
        message: 'Topping không tồn tại hoặc đã ngừng bán',
        details: invalidIds.map((toppingId) => ({ toppingId })),
      });
  }
}
