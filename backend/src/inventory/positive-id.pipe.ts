import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

@Injectable()
export class PositiveIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) {
      throw new BadRequestException(
        'ID phải là số nguyên dương trong phạm vi PostgreSQL Int.',
      );
    }
    return Number(value);
  }
}
