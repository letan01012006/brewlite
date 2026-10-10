import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

/** Shared HTTP behavior for the server and end-to-end tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: 'http://localhost:3000',
    exposedHeaders: ['Idempotent-Replayed'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
