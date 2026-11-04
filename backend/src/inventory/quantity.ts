import { BadRequestException } from '@nestjs/common';
import { Prisma, type IngredientUnit } from '../generated/prisma/client.js';

export function quantity(value: string, unit: IngredientUnit, signed = false) {
  if (
    !(signed ? /^-?\d{1,15}(\.\d{1,3})?$/ : /^\d{1,15}(\.\d{1,3})?$/).test(
      value,
    )
  ) {
    throw new BadRequestException({
      code: 'INVALID_QUANTITY',
      message: 'Số lượng phải là chuỗi Decimal(18,3).',
    });
  }
  const result = new Prisma.Decimal(value);
  if (
    result.isZero() ||
    (!signed && result.isNegative()) ||
    (unit === 'PIECE' && !result.isInteger())
  ) {
    throw new BadRequestException({
      code: 'INVALID_QUANTITY',
      message:
        'Số lượng phải khác 0, định mức phải dương và PIECE phải nguyên.',
    });
  }
  return result;
}
