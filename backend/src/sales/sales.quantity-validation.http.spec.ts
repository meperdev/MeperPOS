import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp, configureErrorHandling } from '../app-configuration';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

/**
 * `POST /api/sales` must answer 400 for a fractional item quantity through the
 * production ValidationPipe, before the service (and therefore the database) is
 * reached. Guards and interceptors are stubbed: this spec pins the body
 * boundary only, with no database.
 */
describe('Sales HTTP quantity validation', () => {
  let app: INestApplication;
  const salesService = {
    create: jest.fn().mockResolvedValue({ id: 'sale-1' }),
  };

  const allow: CanActivate = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<{ user?: unknown }>();
      req.user = { userId: 'u-1', organizationId: 'org-1', role: 'ADMIN' };
      return true;
    },
  };
  const passThrough: NestInterceptor = {
    intercept: (_context, next) => next.handle(),
  };

  const validSale = {
    items: [{ productId: 'prod-1', quantity: 2 }],
    payments: [{ method: 'CASH', amount: 2000 }],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [{ provide: SalesService, useValue: salesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(OrganizationRequiredGuard)
      .useValue(allow)
      .overrideInterceptor(AdminOrganizationInterceptor)
      .useValue(passThrough)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    configureErrorHandling(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([1.5, 2.7])(
    'POST /api/sales answers 400 for quantity %s',
    async (quantity) => {
      await request(app.getHttpServer())
        .post('/api/sales')
        .send({ ...validSale, items: [{ productId: 'prod-1', quantity }] })
        .expect(400);

      expect(salesService.create).not.toHaveBeenCalled();
    },
  );

  it('passes a valid integer quantity to the service', async () => {
    await request(app.getHttpServer())
      .post('/api/sales')
      .send(validSale)
      .expect(201);

    expect(salesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ productId: 'prod-1', quantity: 2 }],
      }),
      'u-1',
      'org-1',
      expect.objectContaining({ userId: 'u-1', organizationId: 'org-1' }),
    );
  });
});
