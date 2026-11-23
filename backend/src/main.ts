import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp, configureErrorHandling } from './app-configuration';
import {
  resolveAllowedOrigins,
  warnMissingProductionOrigins,
} from './config/allowed-origins';
import { validateJwtSecretOrExit } from './config/runtime-env';

async function bootstrap() {
  // Fail fast on insecure runtime configuration before wiring anything up.
  validateJwtSecretOrExit(process.env);
  // Warns (never exits) when CORS_ORIGIN misses a known production frontend:
  // the symptom is a 403 on that frontend's login, not a crash.
  warnMissingProductionOrigins(process.env);

  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);
  // Request-ID correlation + canonical { code, message, requestId } envelope
  // + validation factory (issue #120). Kept in app-configuration so the
  // integration specs exercise the exact wiring the server uses.
  configureErrorHandling(app);

  // Shared with CookieCsrfGuard (SEC-007): one source of truth for the
  // deployment's allowed origins.
  const corsOrigins = resolveAllowedOrigins(process.env);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  // Swagger is a development tool only; never expose the schema in production.
  const swaggerEnabled = process.env.NODE_ENV !== 'production';

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('MeperPOS API')
      .setDescription(
        'API para gestión integrada de inventario, ventas y clientes',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Server running on http://localhost:${port}`);

  if (swaggerEnabled) {
    console.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
  }
}
void bootstrap();
