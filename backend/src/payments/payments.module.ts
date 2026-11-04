import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { MockPaymentService } from './mock-payment.service.js';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentService],
  exports: [PaymentsService, MockPaymentService],
})
export class PaymentsModule {}
