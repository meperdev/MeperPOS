import { MovementType, ProductType } from '@prisma/client';
import {
  availableStock,
  type AvailabilitySubject,
  isLowStock,
  normalizeStock,
  resolveInitialStockMovement,
  resolveStockDeltaMovement,
  tracksStock,
  type StockSubject,
} from './product-type.logic';

/**
 * A service is sold labour, and an untracked product is merchandise nobody counts. Both are
 * invisible to stock: never guarded, never decremented, never valued, never alerted on. Every
 * stock decision in the codebase routes through these five functions, so this spec is the single
 * place where the rule is pinned.
 */
describe('product-type.logic — the single stock-decision authority', () => {
  const product = (overrides: Partial<StockSubject> = {}): StockSubject => ({
    type: ProductType.PRODUCT,
    tracksStock: true,
    ...overrides,
  });

  const untracked = (overrides: Partial<StockSubject> = {}): StockSubject => ({
    type: ProductType.PRODUCT,
    tracksStock: false,
    ...overrides,
  });

  const service = (overrides: Partial<StockSubject> = {}): StockSubject => ({
    type: ProductType.SERVICE,
    tracksStock: false,
    ...overrides,
  });

  describe('tracksStock', () => {
    it('tracks stock for merchandise that declares it', () => {
      expect(tracksStock(product())).toBe(true);
    });

    it('never tracks stock for a service', () => {
      expect(tracksStock(service())).toBe(false);
    });

    it('does not track stock for merchandise nobody counts', () => {
      expect(tracksStock(untracked())).toBe(false);
    });

    it('refuses to track a service even when its row claims it does', () => {
      expect(tracksStock(service({ tracksStock: true }))).toBe(false);
    });
  });

  describe('availableStock', () => {
    const row: AvailabilitySubject = {
      type: ProductType.PRODUCT,
      tracksStock: true,
      stock: 10,
      reservedStock: 3,
    };

    it.each([
      { reservedStock: 3, expected: 7 },
      { reservedStock: 0, expected: 10 },
      { reservedStock: 10, expected: 0 },
      { stock: 0, reservedStock: 0, expected: 0 },
      { type: ProductType.SERVICE, tracksStock: false, expected: null },
      { type: ProductType.SERVICE, tracksStock: true, expected: null },
      { tracksStock: false, expected: null },
    ])(
      'derives availability without changing physical stock: %j',
      ({ expected, ...controls }) => {
        const input = { ...row, ...controls };
        const original = { ...input };
        expect(availableStock(input)).toBe(expected);
        expect(input).toEqual(original);
      },
    );

    it.each([
      { stock: -1 },
      { stock: 1.5 },
      { stock: NaN },
      { stock: Infinity },
      { reservedStock: -1 },
      { reservedStock: 1.5 },
      { reservedStock: NaN },
      { reservedStock: Infinity },
      { reservedStock: 11 },
      { type: 'UNKNOWN' },
      { type: null },
      { tracksStock: null },
      { tracksStock: 'true' },
    ])('rejects corrupt real fields without clamping: %j', (controls) => {
      const input = { ...row, ...controls } as AvailabilitySubject;
      expect(() => availableStock(input)).toThrow(
        'Invalid product availability inputs',
      );
    });

    it.each(['type', 'tracksStock', 'stock', 'reservedStock'] as const)(
      'rejects missing %s even for untracked rows',
      (field) => {
        const input: Partial<AvailabilitySubject> = {
          ...row,
          tracksStock: false,
        };
        delete input[field];
        expect(() => availableStock(input as AvailabilitySubject)).toThrow(
          'Invalid product availability inputs',
        );
      },
    );
  });

  describe('normalizeStock', () => {
    it('keeps a tracked product stock untouched', () => {
      expect(normalizeStock(product(), 42)).toBe(42);
    });

    it('keeps a zero-stock product at zero', () => {
      expect(normalizeStock(product(), 0)).toBe(0);
    });

    it('forces a service to zero regardless of the stored stock', () => {
      expect(normalizeStock(service(), 9996)).toBe(0);
    });

    it('forces untracked merchandise to zero', () => {
      expect(normalizeStock(untracked(), 9991)).toBe(0);
    });
  });

  describe('resolveInitialStockMovement', () => {
    it('exposes only PURCHASE or null to opening movement writers', () => {
      const movement: {
        type: typeof MovementType.PURCHASE;
        quantity: number;
      } | null = resolveInitialStockMovement(product(), 10);
      expect(movement).toEqual({ type: MovementType.PURCHASE, quantity: 10 });
    });

    it('records the opening PURCHASE movement for a tracked product', () => {
      expect(resolveInitialStockMovement(product(), 10)).toEqual({
        type: MovementType.PURCHASE,
        quantity: 10,
      });
    });

    it('records no opening movement for a product created with zero stock', () => {
      expect(resolveInitialStockMovement(product(), 0)).toBeNull();
    });

    it('records no opening movement for a service', () => {
      expect(resolveInitialStockMovement(service(), 9996)).toBeNull();
    });

    it('records no opening movement for untracked merchandise', () => {
      expect(resolveInitialStockMovement(untracked(), 9991)).toBeNull();
    });
  });

  describe('isLowStock', () => {
    it('reports a tracked product at zero against a positive minimum', () => {
      expect(isLowStock(product(), 0, 5)).toBe(true);
    });

    it('reports a tracked product exactly at the minimum, which is inclusive', () => {
      expect(isLowStock(product(), 5, 5)).toBe(true);
    });

    it('does not report a tracked product above the minimum', () => {
      expect(isLowStock(product(), 6, 5)).toBe(false);
    });

    it('never reports a service as low on stock', () => {
      expect(isLowStock(service(), 0, 5)).toBe(false);
      expect(isLowStock(service(), 0, 0)).toBe(false);
    });

    it('never reports untracked merchandise as low on stock', () => {
      expect(isLowStock(untracked(), 0, 5)).toBe(false);
    });
  });

  describe('resolveStockDeltaMovement', () => {
    it('exposes only manual adjustment types or null to stock editors', () => {
      const movement:
        | typeof MovementType.ADJUSTMENT_IN
        | typeof MovementType.ADJUSTMENT_OUT
        | null = resolveStockDeltaMovement(product(), 5, 10);
      expect(movement).toBe(MovementType.ADJUSTMENT_IN);
    });

    it('records an ADJUSTMENT_IN when tracked stock rises', () => {
      expect(resolveStockDeltaMovement(product(), 5, 10)).toBe(
        MovementType.ADJUSTMENT_IN,
      );
    });

    it('records an ADJUSTMENT_OUT when tracked stock drops', () => {
      expect(resolveStockDeltaMovement(product(), 10, 5)).toBe(
        MovementType.ADJUSTMENT_OUT,
      );
    });

    it('records no movement when tracked stock is unchanged', () => {
      expect(resolveStockDeltaMovement(product(), 10, 10)).toBeNull();
    });

    it('records no movement when a service stock changes', () => {
      expect(resolveStockDeltaMovement(service(), 10, 0)).toBeNull();
      expect(resolveStockDeltaMovement(service(), 0, 10)).toBeNull();
    });

    it('records no movement when untracked stock changes', () => {
      expect(resolveStockDeltaMovement(untracked(), 9991, 0)).toBeNull();
      expect(resolveStockDeltaMovement(untracked(), 0, 9991)).toBeNull();
    });
  });
});
