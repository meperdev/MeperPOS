import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp, configureErrorHandling } from './app-configuration';
import { validateJwtSecretOrExit } from './config/runtime-env';

async function bootstrap() {
  // Fail fast on insecure runtime configuration before wiring anything up.
  validateJwtSecretOrExit(process.env);

  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);
  // Request-ID correlation + canonical { code, message, requestId } envelope
  // + validation factory (issue #120). Kept in app-configuration so the
  // integration specs exercise the exact wiring the server uses.
  configureErrorHandling(app);

  const corsOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const defaultOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : defaultOrigins,
    credentials: true,
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
