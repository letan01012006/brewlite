import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { MockPaymentService } from './mock-payment.service.js';
import {
  VnpayGateway,
  DefaultVnpayGateway,
} from './vnpay/vnpay.gateway.js';
import { VnpayReconcileJob } from './vnpay/vnpay-reconcile.job.js';

@Module({
  imports: [InventoryModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MockPaymentService,
    {
      provide: VnpayGateway,
      useClass: DefaultVnpayGateway,
    },
    VnpayReconcileJob,
  ],
  exports: [PaymentsService, MockPaymentService, VnpayGateway],
})
export class PaymentsModule {}
