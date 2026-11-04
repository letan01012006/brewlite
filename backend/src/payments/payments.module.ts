import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { MockPaymentService } from './mock-payment.service.js';
import { VnpayGateway } from './vnpay/vnpay.gateway.js';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentService, VnpayGateway],
  exports: [PaymentsService, MockPaymentService, VnpayGateway],
})
export class PaymentsModule {}