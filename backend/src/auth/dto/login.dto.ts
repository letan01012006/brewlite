import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, ValidateIf } from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({ example: '0912345678', description: 'Chọn đúng một trong phone hoặc email' })
  @ValidateIf((o: LoginDto) => o.phone !== undefined || o.email === undefined)
  @Matches(/^0[0-9]{9}$/)
  phone?: string;

  @ApiPropertyOptional({ example: 'demo@brewlite.com', description: 'Tài khoản cũ chưa có số điện thoại' })
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
  @ValidateIf((o: LoginDto) => o.email !== undefined || o.phone === undefined)
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Passw0rd!' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
