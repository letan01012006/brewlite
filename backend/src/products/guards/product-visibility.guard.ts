import {
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../../auth/interfaces/jwt-payload.interface.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';

@Injectable()
export class ProductVisibilityGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();

    // Guards run before DTO transformation. Other query values are validated
    // by QueryProductDto and cannot enable access to inactive products.
    if (request.query.includeInactive !== 'true') return true;

    await super.canActivate(context);
    if (request.user?.role !== 'BARISTA') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Chỉ BARISTA được xem sản phẩm đang tạm dừng bán',
      });
    }
    return true;
  }
}
