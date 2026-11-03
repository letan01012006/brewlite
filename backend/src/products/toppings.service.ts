import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateToppingDto } from './dto/create-topping.dto.js';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class ToppingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy danh sách topping còn bán (isActive = true)
   * GET /api/products/toppings (legacy alias: /api/toppings)
   * Trả về mảng [{ id, name, price }]
   */
  async findAll() {
    return this.prisma.topping.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        price: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Thêm mới topping
   */
  async create(dto: CreateToppingDto) {
    try {
      return await this.prisma.topping.create({
        data: { name: dto.name.trim(), price: dto.price },
        select: { id: true, name: true, price: true, isActive: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'TOPPING_ALREADY_EXISTS',
          message: `Topping với tên '${dto.name.trim()}' đã tồn tại`,
        });
      }
      throw error;
    }
  }
}
