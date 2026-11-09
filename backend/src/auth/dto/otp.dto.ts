import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class PhoneDto {
  @ApiProperty({ example: '0912345678', pattern: '^0[0-9]{9}$' })
  @Matches(/^0[0-9]{9}$/)
  phone: string;
}
export class VerifyOtpDto extends PhoneDto {
  @ApiProperty({ example: '123456', description: 'Demo 123456 chỉ khi AUTH_OTP_DEMO=true trong dev/test' })
  @Matches(/^[0-9]{6}$/)
  code: string;
}
