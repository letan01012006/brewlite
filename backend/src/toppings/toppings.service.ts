import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateToppingDto } from './dto/create-topping.dto.js';

@Injectable()
export class ToppingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy danh sách topping còn bán (isActive = true)
   * GET /api/toppings (Task 4)
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
    const existing = await this.prisma.topping.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new ConflictException({
        code: 'TOPPING_ALREADY_EXISTS',
        message: `Topping với tên '${dto.name}' đã tồn tại`,
      });
    }

    return this.prisma.topping.create({
      data: {
        name: dto.name,
        price: dto.price,
      },
      select: {
        id: true,
        name: true,
        price: true,
        isActive: true,
      },
    });
  }
}

