import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductsModule } from './products/products.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PromotionsModule } from './promotions/promotions.module.js';
import { HealthModule } from './health/health.module.js';
import { PricingModule } from './common/pricing/pricing.module.js';
import { RecipesModule } from './inventory/recipes.module.js';

const envFilePath = [
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env'),
  fileURLToPath(new URL('../.env', import.meta.url)),
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath,
    }),
    PrismaModule,
    PricingModule,
    RecipesModule,
    ProductsModule,
    AuthModule,
    OrdersModule,
    PaymentsModule,
    PromotionsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
