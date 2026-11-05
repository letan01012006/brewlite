import { Module, forwardRef } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PricingModule } from '../common/pricing/pricing.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PricingModule, InventoryModule, forwardRef(() => PaymentsModule)],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
