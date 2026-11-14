import { ProductType } from '@prisma/client';
import {
  type BackfillProduct,
  type ServiceTarget,
  planServicesBackfill,
  buildServiceConversionStockGuard,
} from './services-backfill.plan';

/**
 * The backfill correction is a production write, so the decision of WHAT to change
 * is isolated in this pure planner and pinned here. The CLI only executes the plan
 * it is given.
 */
describe('service conversion stock guard', () => {
  const live = { stock: 10, reservedStock: 0, version: 7 };

  it('pins the actual conversion predicate to tenant, stock, version and zero reservations', () => {
    expect(buildServiceConversionStockGuard('prod-1', 'org-1', live)).toEqual({
      id: 'prod-1',
      organizationId: 'org-1',
      stock: 10,
      version: 7,
      reservedStock: 0,
    });
  });

  it.each([1, 10, -1, undefined])(
    'refuses a nonzero or missing counter (%s)',
    (reservedStock) => {
      expect(() =>
        buildServiceConversionStockGuard('prod-1', 'org-1', {
          ...live,
          reservedStock: reservedStock as number,
        }),
      ).toThrow('tiene reservas o un contador inválido');
    },
  );

  it.each(['stock', 'version', 'reservedStock', 'organizationId'] as const)(
    'a changed %s no longer matches the pinned predicate',
    (field) => {
      const guard = buildServiceConversionStockGuard('prod-1', 'org-1', live);
      const changed = {
        ...guard,
        [field]: field === 'organizationId' ? 'org-2' : 99,
      };
      expect(
        Object.entries(guard).every(([key, value]) => changed[key] === value),
      ).toBe(false);
    },
  );
});

describe('planServicesBackfill', () => {
  const targets: ServiceTarget[] = [
    { name: 'MANO DE OBRA', sku: 'SERV' },
    { name: 'SCANNER', sku: 'SERVICIO' },
    { name: 'Sincronizacion General', sku: 'MEC-001' },
    { name: 'MANTENIMIENTO', sku: 'SERV 4' },
    { name: 'SERVICIO', sku: '123' },
    { name: 'RETIRO CALCAS', sku: 'SERV 11' },
  ];

  const row = (overrides: Partial<BackfillProduct> = {}): BackfillProduct => ({
    id: 'prod-1',
    name: 'MANO DE OBRA',
    sku: 'SERV',
    stock: 9996,
    type: ProductType.PRODUCT,
    active: true,
    ...overrides,
  });

  const only = () => [row()];

  describe('one target, one match', () => {
    it('plans a zeroing action for a stocked product', () => {
      const plan = planServicesBackfill([targets[0]], only());

      expect(plan.refusals).toEqual([]);
      expect(plan.canApply).toBe(true);
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]).toEqual({
        productId: 'prod-1',
        name: 'MANO DE OBRA',
        sku: 'SERV',
        previousStock: 9996,
        nextStock: 0,
        movementQuantity: -9996,
        alreadyService: false,
        requiresWrite: true,
        requiresMovement: true,
      });
    });

    it('plans a write with no movement when the product holds no stock', () => {
      const plan = planServicesBackfill([targets[0]], [row({ stock: 0 })]);

      expect(plan.actions[0]).toMatchObject({
        previousStock: 0,
        movementQuantity: 0,
        requiresWrite: true,
        requiresMovement: false,
      });
    });

    it('plans nothing to write when the service was already corrected', () => {
      const plan = planServicesBackfill(
        [targets[0]],
        [row({ stock: 0, type: ProductType.SERVICE })],
      );

      expect(plan.actions[0]).toMatchObject({
        alreadyService: true,
        previousStock: 0,
        requiresWrite: false,
        requiresMovement: false,
      });
    });

    it('still plans the zeroing when a corrected service kept a leftover stock', () => {
      const plan = planServicesBackfill(
        [targets[0]],
        [row({ stock: 986, type: ProductType.SERVICE })],
      );

      expect(plan.actions[0]).toMatchObject({
        alreadyService: true,
        previousStock: 986,
        movementQuantity: -986,
        requiresWrite: true,
        requiresMovement: true,
      });
    });

    it('matches a deactivated service too, because leaving it stocked keeps the data incoherent', () => {
      const plan = planServicesBackfill([targets[0]], [row({ active: false })]);

      expect(plan.canApply).toBe(true);
      expect(plan.actions).toHaveLength(1);
    });

    it('matches despite surrounding whitespace in the stored values', () => {
      const plan = planServicesBackfill(
        [targets[0]],
        [row({ name: '  MANO DE OBRA  ', sku: ' SERV ' })],
      );

      expect(plan.canApply).toBe(true);
      expect(plan.actions).toHaveLength(1);
    });
  });

  describe('refusals', () => {
    it('refuses a target that matches no row', () => {
      const plan = planServicesBackfill(
        [targets[0]],
        [row({ name: 'OTRA COSA', sku: 'OTRO' })],
      );

      expect(plan.actions).toEqual([]);
      expect(plan.refusals).toEqual([
        { target: targets[0], reason: 'NOT_FOUND', matches: 0 },
      ]);
      expect(plan.canApply).toBe(false);
    });

    it('refuses a target that matches more than one row instead of guessing', () => {
      const plan = planServicesBackfill(
        [targets[0]],
        [row({ id: 'a' }), row({ id: 'b' })],
      );

      expect(plan.actions).toEqual([]);
      expect(plan.refusals).toEqual([
        { target: targets[0], reason: 'AMBIGUOUS', matches: 2 },
      ]);
      expect(plan.canApply).toBe(false);
    });

    it('will not match on the name alone', () => {
      const plan = planServicesBackfill(
        [targets[0]],
        [row({ sku: 'OTRO-SKU' })],
      );

      expect(plan.refusals[0].reason).toBe('NOT_FOUND');
    });

    it('will not match on the sku alone, even when another row carries it', () => {
      const scanner: ServiceTarget = { name: 'SCANNER', sku: 'SERVICIO' };
      const plan = planServicesBackfill(
        [scanner],
        [row({ id: 'servicio', name: 'SERVICIO', sku: 'SERVICIO' })],
      );

      expect(plan.refusals[0].reason).toBe('NOT_FOUND');
    });

    it('fails closed for the whole plan as soon as one target is refused', () => {
      const plan = planServicesBackfill(
        [targets[0], targets[1]],
        [row({ id: 'ok' })],
      );

      expect(plan.actions).toHaveLength(1);
      expect(plan.refusals).toHaveLength(1);
      expect(plan.canApply).toBe(false);
    });
  });

  describe('the confirmed production list', () => {
    const productionRows: BackfillProduct[] = [
      {
        id: 'p1',
        name: 'MANO DE OBRA',
        sku: 'SERV',
        stock: 9996,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'p2',
        name: 'SCANNER',
        sku: 'SERVICIO',
        stock: 999,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'p3',
        name: 'Sincronizacion General',
        sku: 'MEC-001',
        stock: 996,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'p4',
        name: 'MANTENIMIENTO',
        sku: 'SERV 4',
        stock: 986,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'p5',
        name: 'SERVICIO',
        sku: '123',
        stock: 963,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'p6',
        name: 'RETIRO CALCAS',
        sku: 'SERV 11',
        stock: 8,
        type: ProductType.PRODUCT,
        active: true,
      },
      // Real rows that must NOT be touched by this backfill.
      {
        id: 'x1',
        name: 'LIQUIDO',
        sku: 'SERV 3',
        stock: 9991,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'x2',
        name: 'BATERIA',
        sku: 'SERV 7',
        stock: 999,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'x3',
        name: 'GUAYA',
        sku: '1234',
        stock: 998,
        type: ProductType.PRODUCT,
        active: true,
      },
      {
        id: 'x4',
        name: 'ONRIS',
        sku: 'SERV 6',
        stock: 0,
        type: ProductType.PRODUCT,
        active: true,
      },
    ];

    it('plans exactly the six confirmed services and nothing else', () => {
      const plan = planServicesBackfill(targets, productionRows);

      expect(plan.canApply).toBe(true);
      expect(plan.refusals).toEqual([]);
      expect(plan.actions.map((a) => a.productId)).toEqual([
        'p1',
        'p2',
        'p3',
        'p4',
        'p5',
        'p6',
      ]);
    });

    it('accounts for every target exactly once', () => {
      const plan = planServicesBackfill(targets, productionRows);

      expect(plan.actions.length + plan.refusals.length).toBe(targets.length);
    });

    it('plans the exact stock the report is currently overstating', () => {
      const plan = planServicesBackfill(targets, productionRows);

      const units = plan.actions.reduce(
        (total, action) => total + action.previousStock,
        0,
      );

      expect(units).toBe(13948);
    });
  });

  describe('idempotency', () => {
    it('plans no writes at all once every target is already corrected', () => {
      const corrected = targets.map((target, index) => ({
        id: `p${index}`,
        name: target.name,
        sku: target.sku,
        stock: 0,
        type: ProductType.SERVICE,
        active: true,
      }));

      const plan = planServicesBackfill(targets, corrected);

      expect(plan.canApply).toBe(true);
      expect(plan.actions).toHaveLength(targets.length);
      expect(plan.actions.every((action) => !action.requiresWrite)).toBe(true);
      expect(plan.actions.every((action) => !action.requiresMovement)).toBe(
        true,
      );
    });
  });
});
