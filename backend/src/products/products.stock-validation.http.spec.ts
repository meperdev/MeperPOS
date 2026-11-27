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
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { PlanLimitGuard } from '../plan-limits/plan-limits.guard';
import { LocationsService } from '../locations/locations.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * Explorer F28: POST /api/products and PUT /api/products/:id must answer 400
 * for a fractional stock or minStock through the production ValidationPipe,
 * before the service (and therefore the database) is reached. Guards and
 * interceptors are stubbed: this spec pins the body boundary only, with no
 * database.
 */
describe('Products HTTP stock validation (F28)', () => {
  let app: INestApplication;
  const productsService = {
    create: jest.fn().mockResolvedValue({ id: 'p-1' }),
    update: jest.fn().mockResolvedValue({ id: 'p-1' }),
  };
  // The controller authorizes an optional site through the shared location
  // read; these body-boundary cases never send one.
  const locationsService = { findAccessible: jest.fn() };

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

  const validCreate = {
    name: 'Panela',
    sku: 'PAN-1',
    costPrice: 1000,
    salePrice: 2000,
    stock: 10,
    minStock: 2,
    categoryId: '123e4567-e89b-12d3-a456-426614174000',
  };
  const productId = '123e4567-e89b-12d3-a456-426614174001';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: productsService },
        { provide: LocationsService, useValue: locationsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(OrganizationRequiredGuard)
      .useValue(allow)
      .overrideGuard(PlanLimitGuard)
      .useValue(allow)
      .overrideInterceptor(AdminOrganizationInterceptor)
      .useValue(passThrough)
      .overrideInterceptor(AuditInterceptor)
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

  it.each(['stock', 'minStock'])(
    'POST /api/products answers 400 for a fractional %s',
    async (field) => {
      await request(app.getHttpServer())
        .post('/api/products')
        .send({ ...validCreate, [field]: 2.5 })
        .expect(400);

      expect(productsService.create).not.toHaveBeenCalled();
    },
  );

  it.each(['stock', 'minStock'])(
    'PUT /api/products/:id answers 400 for a fractional %s',
    async (field) => {
      await request(app.getHttpServer())
        .put(`/api/products/${productId}`)
        .send({ [field]: 2.5 })
        .expect(400);

      expect(productsService.update).not.toHaveBeenCalled();
    },
  );

  it('accepts integer stock, including zero, on create and update', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .send({ ...validCreate, stock: 0, minStock: 0 })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/api/products/${productId}`)
      .send({ stock: 7, minStock: 0 })
      .expect(200);

    expect(productsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ stock: 0, minStock: 0 }),
      'u-1',
      'org-1',
    );
    expect(productsService.update).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({ stock: 7, minStock: 0 }),
      'u-1',
      'org-1',
    );
  });
});
