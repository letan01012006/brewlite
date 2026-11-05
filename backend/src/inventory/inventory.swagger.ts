import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';

const integer = { type: 'integer' } as const;
const decimal = {
  type: 'string',
  example: '100.000',
  description: 'Decimal theo đơn vị gốc; không dùng số thực JavaScript.',
} as const;
const unit = { type: 'string', enum: ['GRAM', 'MILLILITRE', 'PIECE'] } as const;
export const ingredientSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: integer,
    code: { type: 'string' },
    name: { type: 'string' },
    unit: { ...unit, enum: [...unit.enum] },
    stockQuantity: decimal,
    reservedQuantity: decimal,
    version: integer,
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export const recipeSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: integer,
    productId: integer,
    size: { type: 'string', enum: ['S', 'M', 'L'] },
    version: integer,
    isActive: { type: 'boolean' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: integer,
          recipeId: integer,
          ingredientId: integer,
          unit: { ...unit, enum: [...unit.enum] },
          quantity: decimal,
        },
      },
    },
  },
};
export const toppingRecipeSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: integer,
    ingredientId: { ...integer, nullable: true },
    quantityPerServing: { ...decimal, nullable: true },
  },
};
export const movementSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: integer,
    eventKey: { type: 'string' },
    kind: { type: 'string', enum: ['RECEIPT', 'ADJUSTMENT'] },
    ingredientId: integer,
    unit: { ...unit, enum: [...unit.enum] },
    stockDelta: decimal,
    reservedDelta: decimal,
    actorId: integer,
    reason: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
export const availabilitySchema: SchemaObject = {
  type: 'object',
  properties: {
    available: { type: 'boolean' },
    shortages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ingredientId: integer,
          unit: { ...unit, enum: [...unit.enum] },
          quantity: decimal,
          availableQuantity: decimal,
          sufficient: { type: 'boolean' },
        },
      },
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: integer,
          productId: integer,
          size: { type: 'string' },
          maxQuantity: {
            ...integer,
            description:
              'Tổng số ly tối đa của dòng sau khi đáp ứng các dòng khác, giới hạn 20.',
          },
        },
      },
    },
  },
};
export function InventoryDocs(
  summary: string,
  schema: SchemaObject,
  status = 200,
  publicRoute = false,
) {
  return applyDecorators(
    ApiOperation({ summary }),
    ApiResponse({ status, schema }),
    ApiResponse({
      status: 400,
      description: 'DTO hoặc định mức không hợp lệ.',
    }),
    ApiResponse({ status: 404, description: 'Không tìm thấy bản ghi.' }),
    ApiResponse({
      status: 409,
      description:
        'Thiếu nguyên liệu, công thức chưa sẵn sàng, dữ liệu trùng hoặc xung đột kho/idempotency.',
    }),
    ...(!publicRoute
      ? [
          ApiResponse({ status: 401, description: 'Cần đăng nhập.' }),
          ApiResponse({ status: 403, description: 'Cần quyền BARISTA.' }),
        ]
      : []),
  );
}
