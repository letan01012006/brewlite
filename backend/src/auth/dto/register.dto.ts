import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Nguyễn Văn An', minLength: 2, maxLength: 100 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: '0912345678', pattern: '^0[0-9]{9}$' })
  @Matches(/^0[0-9]{9}$/, { message: 'Số điện thoại gồm 10 chữ số bắt đầu bằng 0' })
  phone: string;

  @ApiPropertyOptional({ example: 'an@example.com', nullable: true })
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase().trim() || undefined : value)
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string | null;

  @ApiProperty({ description: '8–64 ký tự, ít nhất một chữ cái và một chữ số', example: 'Passw0rd!' })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/)
  password: string;
}
