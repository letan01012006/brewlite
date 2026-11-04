import { InventoryModule } from '../inventory/inventory.module.js';
import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { ToppingsController } from './toppings.controller.js';
import { LegacyToppingsController } from './legacy-toppings.controller.js';
import { ToppingsService } from './toppings.service.js';

@Module({
  imports: [InventoryModule],
  // Static /products/toppings routes must be mounted before /products/:id.
  controllers: [
    ToppingsController,
    ProductsController,
    LegacyToppingsController,
  ],
  providers: [ProductsService, ToppingsService],
})
export class ProductsModule {}
