import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentsService } from '../payments.service.js';

@Injectable()
export class VnpayReconcileJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VnpayReconcileJob.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'test') {
      return;
    }

    const intervalMs = Number(
      this.configService.get<number>('PAYMENT_RECONCILE_INTERVAL_MS', 60000),
    );

    this.timer = setInterval(async () => {
      try {
        await this.runReconciliation();
      } catch (err) {
        this.logger.error('Lỗi trong chu kỳ đối soát giao dịch VNPAY', err);
      }
    }, intervalMs);

    // Không chặn tiến trình Node.js thoát nếu không còn task nào khác
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runReconciliation() {
    const now = new Date();
    // Tìm các giao dịch VNPAY đang PROCESSING mà đã quá hạn
    const expiredPayments = await this.prisma.payment.findMany({
      where: {
        method: 'VNPAY',
        OR: [
          { status: 'PROCESSING', expiresAt: { lte: now } },
          // A cancellation with an unknown gateway outcome keeps its hold
          // until reconciliation confirms where the money went.
          {
            status: 'CANCELLED',
            order: { inventoryReservation: { status: 'HELD' } },
          },
        ],
      },
      select: { id: true, gatewayTxnRef: true },
      take: 20,
    });

    for (const payment of expiredPayments) {
      try {
        await this.paymentsService.reconcileSinglePayment(payment.id);
      } catch (err) {
        this.logger.warn(
          `Đối soát giao dịch #${payment.id} (${payment.gatewayTxnRef}) thất bại`,
          err,
        );
      }
    }
  }
}
