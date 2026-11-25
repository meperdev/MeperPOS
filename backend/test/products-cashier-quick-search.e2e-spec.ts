import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProductsController } from '../src/products/products.controller';
import { ProductsService } from '../src/products/products.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { CloudinaryService } from '../src/cloudinary/cloudinary.service';
import { PlanLimitService } from '../src/plan-limits/plan-limits.service';
import { JwtAuthGuard } from '../src/auth/jwt.strategy';

/**
 * E2E — CASHIER-accessible product quick-search on the registered contract
 *
 * Registered-app proof that `GET /products/quick-search` serves CASHIER
 * (and ADMIN/MEMBER) through the module-registered `ProductsController` +
 * `ProductsService`, with Prisma mocked at the provider level. Mirrors the
 * `tax-precedence.e2e-spec.ts` composition convention plus the
 * `PlanLimitService` provider that `ProductsService` now requires.
 *
 * Role matrix: CASHIER/ADMIN/MEMBER → 200 flat product (no success/data
 * envelope) with promotion parity keys; INVENTORY_USER → 403; unauthenticated
 * → 401; no match → 200 with a null body.
 */
describe('CASHIER quick-search on the registered products contract (e2e)', () => {
  let app: INestApplication<App>;

  // ── Mocked dependencies ────────────────────────────────────────────
  const prismaMock = {
    category: { findUnique: jest.fn(), findFirst: jest.fn() },
    product: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    inventoryMovement: { create: jest.fn() },
  };

  const settingsServiceMock = {
    getSettings: jest.fn(),
  };

  const cloudinaryServiceMock = {};

  const planLimitServiceMock = {
    invalidateCache: jest.fn(),
    checkLimit: jest.fn(),
    getLimitStatus: jest.fn(),
    count: jest.fn(),
  };

  // ── Stubbed auth guard — injects a fake principal per request ─────
  // Reads the `auth-principal` header set by `requestAs`; a missing header
  // throws UnauthorizedException so the route answers 401 (a bare `false`
  // return would surface as 403 from the guard pipeline).
  const mockAuthGuard = {
    canActivate: (ctx: any) => {
      const req = ctx.switchToHttp().getRequest();
      const raw = req.headers?.['auth-principal'] as string | undefined;
      if (!raw) {
        throw new UnauthorizedException();
      }
      req.user = JSON.parse(raw);
      return true;
    },
  };

  // ── Fixtures ───────────────────────────────────────────────────────
  const category = {
    id: 'cat-1',
    name: 'Donuts',
    description: null,
    defaultTaxRate: null,
    taxable: false,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buildProduct = (overrides: Record<string, unknown> = {}) => ({
    id: 'prod-1',
    name: 'Promo Donut',
    sku: 'DNT-001',
    barcode: '7701234567890',
    description: null,
    costPrice: 100,
    salePrice: 10000,
    taxable: false,
    taxRate: 0,
    stock: 10,
    minStock: 2,
    imageUrl: null,
    categoryId: 'cat-1',
    active: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    category,
    ...overrides,
  });

  const flatProductKeys = [
    'id',
    'name',
    'sku',
    'barcode',
    'salePrice',
    'stock',
    'taxable',
    'taxRate',
    'effectiveTaxRate',
    'minStock',
    'isLowStock',
    'category',
    'imageUrl',
  ];

  const requestAs = (principal: Record<string, unknown>, code = '7701234567890') =>
    request(app.getHttpServer())
      .get(`/products/quick-search?code=${code}`)
      .set('auth-principal', JSON.stringify(principal));
  // ── Setup ──────────────────────────────────────────────────────────
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SettingsService, useValue: settingsServiceMock },
        { provide: CloudinaryService, useValue: cloudinaryServiceMock },
        { provide: PlanLimitService, useValue: planLimitServiceMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('role matrix on GET /products/quick-search?code=7701234567890', () => {
    const promoProduct = buildProduct({
      salePrice: 19900,
      promotionType: 'PERCENTAGE',
      promotionValue: 15,
    });

    it('lets a CASHIER retrieve the flat promoted product (200, no success/data)', async () => {
      prismaMock.product.findFirst.mockResolvedValue(promoProduct);

      const res = await requestAs({
        sub: 'cashier-1',
        organizationId: 'org-1',
        role: 'CASHIER',
      }).expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          id: 'prod-1',
          name: 'Promo Donut',
          sku: 'DNT-001',
          barcode: '7701234567890',
          salePrice: 19900,
          promotionType: 'PERCENTAGE',
          promotionValue: 15,
          effectiveSalePrice: 16915,
        }),
      );
      expect(res.body.success).toBeUndefined();
      expect(res.body.data).toBeUndefined();
      // Flat payload keeps every prior registered-contract field.
      for (const key of flatProductKeys) {
        expect(res.body).toHaveProperty(key);
      }
    });

    it('lets an ADMIN retrieve the flat promoted product (200)', async () => {
      prismaMock.product.findFirst.mockResolvedValue(promoProduct);

      const res = await requestAs({
        sub: 'admin-1',
        organizationId: 'org-1',
        role: 'ADMIN',
      }).expect(200);

      expect(res.body.effectiveSalePrice).toBe(16915);
      expect(res.body.success).toBeUndefined();
      expect(res.body.data).toBeUndefined();
    });

    it('lets a MEMBER retrieve the flat product (200)', async () => {
      prismaMock.product.findFirst.mockResolvedValue(promoProduct);

      const res = await requestAs({
        sub: 'member-1',
        organizationId: 'org-1',
        role: 'MEMBER',
      }).expect(200);

      expect(res.body.id).toBe('prod-1');
      expect(res.body.success).toBeUndefined();
      expect(res.body.data).toBeUndefined();
    });

    it('denies INVENTORY_USER with 403', async () => {
      prismaMock.product.findFirst.mockResolvedValue(promoProduct);

      await requestAs({
        sub: 'inv-1',
        organizationId: 'org-1',
        role: 'INVENTORY_USER',
      }).expect(403);
    });

    it('denies an unauthenticated request with 401', async () => {
      prismaMock.product.findFirst.mockResolvedValue(promoProduct);

      await request(app.getHttpServer())
        .get('/products/quick-search?code=7701234567890')
        .expect(401);
    });
  });

  describe('no-match and blank-code paths', () => {
    // The registered `quickSearch` returns the flat `Product | null` service
    // contract. When the controller returns `null`, Nest's express adapter
    // serves it via `res.send(String(null))` (no JSON content-type), which
    // supertest's parser reads back as an empty `{}` body — a transport
    // artifact, not the API contract. The real consumers (POS frontend via
    // Axios JSON) receive `null`. What the route MUST guarantee is: 200 and
    // NO `{success,data}` envelope on the no-match path.
    it('returns 200 with no envelope when no product matches', async () => {
      prismaMock.product.findFirst.mockResolvedValue(null);

      const res = await requestAs(
        { sub: 'cashier-1', organizationId: 'org-1', role: 'CASHIER' },
        '0000000000000',
      ).expect(200);

      expect(res.body).not.toHaveProperty('success');
      expect(res.body).not.toHaveProperty('data');
    });

    it('returns 200 with no envelope and does not query for a blank code', async () => {
      const res = await requestAs(
        { sub: 'cashier-1', organizationId: 'org-1', role: 'CASHIER' },
        '%20%20%20',
      ).expect(200);

      expect(res.body).not.toHaveProperty('success');
      expect(res.body).not.toHaveProperty('data');
      expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
    });
  });
});
