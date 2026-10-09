import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// Mã lỗi mặc định theo HTTP status, dùng khi exception không tự gắn `code`.
const DEFAULT_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_FAILED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  500: 'INTERNAL_ERROR',
};

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
}

/**
 * Mọi lỗi đều ra cùng một dạng (xem mục 2.1 của tài liệu API):
 * { statusCode, code, message, details?, path, timestamp }
 *
 * Ném lỗi nghiệp vụ như sau:
 *   throw new ConflictException({ code: 'OUT_OF_STOCK', message: '...', details: [...] });
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = DEFAULT_CODES[500];
    let message = 'Lỗi máy chủ';
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      code = DEFAULT_CODES[statusCode] ?? 'ERROR';
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as Record<string, unknown>;
        if (typeof b.code === 'string') code = b.code;
        if (b.details !== undefined) details = b.details;

        if (Array.isArray(b.message)) {
          // lỗi từ ValidationPipe (class-validator): danh sách từng lỗi
          message = 'Dữ liệu không hợp lệ';
          details = details ?? b.message;
        } else if (typeof b.message === 'string') {
          message = b.message;
        } else {
          message = exception.message;
        }
      }
    } else {
      // lỗi không lường trước: ghi log đầy đủ, KHÔNG trả chi tiết cho client
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const payload: ErrorBody = {
      statusCode,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
    };

    res.status(statusCode).json(payload);
  }
}
