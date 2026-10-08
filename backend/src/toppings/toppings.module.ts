import { Module } from '@nestjs/common';
import { ToppingsController } from './toppings.controller.js';
import { ToppingsService } from './toppings.service.js';

@Module({
  controllers: [ToppingsController],
  providers: [ToppingsService]
})
export class ToppingsModule {}
