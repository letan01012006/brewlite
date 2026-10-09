import { IsIn, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export const PAYMENT_METHODS = ['WALLET', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class ProcessPaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'Mã đơn hàng (orderId) không được để trống' })
  orderId: string;

  @IsIn(PAYMENT_METHODS, {
    message: 'Phương thức thanh toán chỉ chấp nhận: WALLET hoặc CARD',
  })
  method: PaymentMethod;

  @IsString({ message: 'Idempotency-Key phải là một chuỗi' })
  @IsNotEmpty({ message: 'Idempotency-Key không được để trống để đảm bảo giao dịch không bị lặp' })
  idempotencyKey: string;

  @IsNumber()
  @Min(0, { message: 'Số tiền thanh toán phải lớn hơn hoặc bằng 0' })
  amount: number;
}
