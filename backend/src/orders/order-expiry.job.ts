import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service.js';

@Injectable()
export class OrderExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpiryJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      void this.runExpiry().catch((error) =>
        this.logger.error('Không thể xử lý đơn hết hạn', error),
      );
    }, 60000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runExpiry(now = new Date()) {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.orders.expirePendingOrders(now);
    } finally {
      this.running = false;
    }
  }
}
