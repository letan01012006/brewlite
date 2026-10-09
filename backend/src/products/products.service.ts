import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryProductDto } from './dto/query-product.dto.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { SIZE_SURCHARGE, type SizeKey } from '../common/pricing/pricing.constants.js';
import type { Prisma } from '../generated/prisma/client.js';

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
        select: {
          id: true,
          name: true,
          price: true,
          imageUrl: true,
          category: true,
          stock: true,
        },
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
        id: true,
        name: true,
        description: true,
        price: true,
        imageUrl: true,
        category: true,
        stock: true,
      },
    });

    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: `Không tìm thấy sản phẩm #${id}`,
      });
    }

    // Lấy danh sách topping còn hoạt động
    const toppings = await this.prisma.topping.findMany({
      where: { isActive: true },
      select: { id: true, name: true, price: true },
      orderBy: { id: 'asc' },
    });

    // Cấu hình các size kèm phụ thu từ pricing.constants
    const sizes = (Object.keys(SIZE_SURCHARGE) as SizeKey[]).map((size) => ({
      size,
      surcharge: SIZE_SURCHARGE[size],
    }));

    return {
      ...product,
      inStock: product.stock > 0,
      sizes,
      toppings,
    };
  }

  /**
   * Tạo sản phẩm mới
   */
  async create(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new ConflictException({
        code: 'PRODUCT_ALREADY_EXISTS',
        message: `Sản phẩm với tên '${dto.name}' đã tồn tại`,
      });
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        category: dto.category,
        price: dto.price,
        imageUrl: dto.imageUrl ?? '/img/default.jpg',
        stock: dto.stock ?? 0,
        description: dto.description,
      },
    });
  }
}

