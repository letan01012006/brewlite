import { InventoryModule } from '../inventory/inventory.module.js';
import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PricingModule } from '../common/pricing/pricing.module.js';

@Module({
  imports: [PricingModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
