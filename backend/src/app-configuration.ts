import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { noStoreMiddleware } from './common/middleware/no-store.middleware';
import { applyProxyTrust } from './common/proxy-trust';
import {
  normalizeValidationMessage,
  PUBLIC_ERROR_CODES,
} from './common/errors/public-error.model';

/**
 * Transport/security wiring shared by the production bootstrap (main.ts) and
 * the integration specs that boot AppModule. Keeping it in one place means a
 * spec asserting security headers exercises the exact middleware the running
 * server uses — removing or weakening helmet here fails the header specs and
 * therefore CI (issue #48, spec 2.R1).
 */
export function configureApp(app: INestApplication): void {
  // Express must trust a NUMBER of proxy hops (default 1, TRUST_PROXY_HOPS)
  // before anything reads req.ip: without it the rate limiter buckets every
  // client behind the Railway edge together and the audit log records the
  // proxy address (spec S4.2). See common/proxy-trust.spec coverage in
  // common/proxy-trust.int.spec.ts.
  applyProxyTrust(app);

  // CSP is disabled because Swagger UI assets conflict with strict policies and this API serves no HTML to end users.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Required for auth cookies: parses Cookie headers into req.cookies.
  app.use(cookieParser());

  // No API response may be stored by a browser or an intermediary (spec S3).
  app.use(noStoreMiddleware);

  app.setGlobalPrefix('api');
}

/**
 * Canonical public error boundary (issue #120), shared by main.ts and the
 * envelope integration specs so the running server and the tests exercise the
 * exact same wiring:
 *  1. request-ID middleware resolves a bounded correlation id before any
 *     pipe/guard/controller runs and echoes it as the `x-request-id` header;
 *  2. the ValidationPipe keeps its safe defaults and a deterministic
 *     single-string validation exception factory;
 *  3. the global HttpExceptionFilter serializes every failure as the
 *     canonical `{ code, message, requestId }` envelope.
 */
export function configureErrorHandling(app: INestApplication): void {
  app.use(requestIdMiddleware);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      // Deterministic, string-safe public validation message (issue #120).
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: PUBLIC_ERROR_CODES.VALIDATION_ERROR,
          message: normalizeValidationMessage(errors),
          error: 'Bad Request',
        }),
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
}
