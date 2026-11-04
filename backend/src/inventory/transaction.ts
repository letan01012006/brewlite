import { ConflictException } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Retry the complete transaction, never an external payment call. */
export async function inventoryTransaction<T>(
  db: PrismaService,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  consistentRead = false,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, {
        timeout: 15000,
        ...(consistentRead
          ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
          : {}),
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            ['40001', '40P01'].includes(String(error.meta?.code))));
      if (!retryable) throw error;
      if (attempt >= 3)
        throw new ConflictException({
          code: 'STOCK_CONFLICT',
          message: 'Kho đang được cập nhật, vui lòng thử lại.',
        });
      await delay(10 * (attempt + 1));
    }
  }
}
